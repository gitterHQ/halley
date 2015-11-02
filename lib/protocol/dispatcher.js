'use strict';

var Scheduler      = require('./scheduler');
var Transport      = require('../transport/transport');
var PublisherMixin = require('../mixins/publisher');
var uri            = require('../util/uri');
var extend         = require('../util/externals').extend;
var debug          = require('debug-proxy')('faye:dispatcher');
var Promise        = require('bluebird');
var globalEvents   = require('../util/global-events');

var MAX_REQUEST_SIZE = 2048;
var DEFAULT_RETRY = 5000;

/**
 * The dispatcher sits between the client and the transport.
 *
 * It's responsible for tracking sending messages to the transport,
 * tracking in-flight messages
 */
function Dispatcher(client, endpoint, options) {
  this._client = client;
  this.endpoint = uri.parse(endpoint);

  this._disabled = options.disabled;
  this._envelopes = {};
  this.retry = options.retry || DEFAULT_RETRY;
  this._scheduler = options.scheduler || Scheduler;
  this._state = 0;
  this._disconnecting = false;

  /* Contains promises of connected transports */
  this._transports = new TransportCache();

  this.wsExtensions = options.websocketExtensions;
  this._allowedTransportTypes = [];
  this.maxRequestSize = MAX_REQUEST_SIZE;

  this.listenTo(globalEvents, 'beforeunload', this.disconnecting);
  this._discoverTransports();
}

Dispatcher.prototype = {

  UP: 1,
  DOWN: 2,

  destroy: function() {
    debug('destroy');

    this.stopListening();
    this.disconnecting();
    this.close();
  },

  /**
   * Called when the client no longer wants the dispatcher to reopen
   * the connection after a disconnect
   */
  disconnecting: function() {
    debug('disconnecting');
    this._disconnecting = true;
  },

  close: function() {
    debug('_close');

    this._cancelPending();

    debug('Dispatcher close requested');
    this._transports.removeAll();

    this._disconnecting = true;
    this._allowedTransportTypes = [];

    if (!this._transport) return;
    var transport = this._transport;
    this._transport = null;

    this._transports.remove(transport);
    transport.close();
  },

  _cancelPending: function() {
    debug('_cancelPending');

    var envelopes = this._envelopes;
    this._envelopes = {};
    Object.keys(envelopes).forEach(function(id) {
      var envelope = envelopes[id];
      envelope.promise.cancel();
    }, this);
  },

  getConnectionTypes: function() {
    return Transport.getConnectionTypes();
  },

  selectTransport: function(allowedTransportTypes) {
    debug('Selecting transport from %j', allowedTransportTypes);
    this._disconnecting = false;
    this._allowedTransportTypes = allowedTransportTypes;
    return this._reselectTransport();
  },

  /**
   * Returns a promise to a usable transport
   */
  _reselectTransport: function() {
    debug('_reselectTransport');
    return this._discoverTransports(this._allowedTransportTypes)
      .bind(this)
      .then(function(transport) {
        debug('Selected %s transport for %s', transport.connectionType, this.endpoint.href);

        this._setTransport(transport);

        // TODO: emit that the connection type has changed
        return transport;
      });
  },

  /**
   * On startup, attempts to check which transports are usable
   * so that we're able to quickly use them once they're selected
   */
  _discoverTransports: function(allowedTransportTypes) {
    debug('_discoverTransports');

    var self = this;

    var disabled = this._disabled;
    var endpoint = this.endpoint;

    var registeredTransports = Transport.getRegisteredTransports()
      .filter(function(transport) {
        var type = transport[0];
        var Klass = transport[1];

        if (allowedTransportTypes && allowedTransportTypes.indexOf(type) < 0) return false;
        if (disabled && disabled.indexOf(type) >= 0) return false;

        try {
          return Klass.isUsable(endpoint);
        } catch (e) {
          debug('isUsable failed for %s: %s', type, e);
          return false;
        }
      });

    var hasNewAsyncTransports;
    /* Create all the transports */
    registeredTransports.forEach(function(transport) {
      var type = transport[0];
      var Klass = transport[1];

      if (this._transports.exists(type)) return;

      try {
        var instance = new Klass(self, endpoint);

        if (this._transports.add(instance)) {
          hasNewAsyncTransports = true;
        }
      } catch (e) {
        debug('Unable to create instance of %s: %s', type, e);
        return;
      }
    }, this);

    var connectionPromises = registeredTransports.map(function(transport) {
      var type = transport[0];
      return this._transports.get(type);
    }, this).filter(function(f) {
      return !!f;
    });

    debug('Racing transports %j', registeredTransports);

    if (hasNewAsyncTransports && connectionPromises.length > 1) {
      // Some connection types may be better once
      // we know that they're able to connect
      // possibly switch to them once
      // the connection is established
      Promise.settle(connectionPromises)
        .bind(this)
        .then(function() {
          if (this._disconnecting) return;
          if (!this._allowedTransportTypes.length) return;

          return Promise.any(connectionPromises);
        })
        .then(function(newTransport) {
          if (!newTransport) return;
          debug('Switching transports: %s', newTransport.connectionType);
          this._setTransport(newTransport);
        })
        .catch(function(err) {
          debug('Unable to select new transport after completion: %s', err);
        });
    }

    // Return the first usable transport
    return Promise.any(connectionPromises);
  },

  /**
   * Returns a promise of the response
   */
  sendMessage: function(message, timeout, options) {
    debug('sendMessage: message=%j, timeout = %s, options=%j', message, timeout, options);
    var id = message.id;
    var envelope = this._envelopes[id];

    // Already inflight
    if (envelope) {
      debug('sendMessage: already in-flight');
      return envelope.promise;
    }

    envelope = this._envelopes[id] = {};

    var scheduler = new this._scheduler(message, {
      timeout: timeout,
      interval: this.retry,
      attempts: options && options.attempts
    });

    var promise = envelope.promise = this._attemptSend(envelope, message, scheduler)
      .bind(this)
      .timeout(options && options.deadline || 60000)
      .then(function(response) {
        scheduler.succeed();
        return response;
      })
      .catch(function(err) {
        scheduler.abort();
        throw err;
      })
      .finally(function() {
        debug('sendMessage complete: message=%j', message);
        delete this._envelopes[id];
      });

    return promise;
  },

  _awaitTransport: function() {
    if (this._transport) return Promise.resolve(this._transport);

    return this._reselectTransport()
      .then(function(transport) {
        if (!transport) throw new Error('No transport');
        return transport;
      });
  },

  _attemptSend: function(envelope, message, scheduler) {
    if (!scheduler.isDeliverable()) {
      return Promise.reject(new Error('No longer deliverable'));
    }

    scheduler.send();
    return this._awaitTransport()
      .bind(this)
      .timeout(scheduler.getTimeout())
      .then(function() {
        // If the response didn't win the race we know that we have a
        // transport
        var responsePromise = new Promise(function(resolve) {
          envelope.resolve = resolve;
        })
        .finally(function() {
          envelope.resolve = null;
        });

        var sendPromise = this._transport.sendMessage(message);

        return Promise.all([sendPromise, responsePromise])
          .spread(function(sendResult, response) {
            return response;
          })
          .timeout(scheduler.getTimeout())
          .catch(Promise.TimeoutError, function(e) {
            // Cancel the send
            sendPromise.cancel();

            throw e;
          });
      })
      .catch(function(e) {
        debug('Error while attempting to send message: %j: %s', message, e);

        // Either the send timed out or no transport was
        // available. Either way, wait for the interval and try again
        return this._awaitRetry(envelope, message, scheduler);
      });

  },

  _awaitRetry: function(envelope, message, scheduler) {
    scheduler.fail();

    if (!scheduler.isDeliverable()) {
      return Promise.reject(new Error('No longer deliverable'));
    }

    // Either no transport is available or a timeout occurred waiting for
    // the transport. Wait a bit, the try again
    return Promise.delay(scheduler.getInterval())
      .bind(this)
      .then(function() {
        return this._attemptSend(envelope, message, scheduler);
      });

  },

  handleResponse: function(reply) {
    debug('handleResponse %j', reply);

    var envelope = this._envelopes[reply.id];

    if (reply.successful !== undefined && envelope) {
      if (envelope.resolve) {
        // This is a response to a message we fired.
        envelope.resolve(reply);
      }
    } else {
      // Distribe this message through channels
      // Don't trigger a message if this is a reply
      // to a request, otherwise it'll pass
      // through the extensions twice
      this.trigger('message', reply);
    }

    if (this._state === this.UP) return;
    this._state = this.UP;
    this._client.trigger('transport:up');
  },

  /**
   * Currently, this only gets called by streaming transports (websocket)
   * and let's the dispatcher know that the connection is unavailable
   * so it needs to switch to an alternative transport
   */
  transportDown: function(transport) {
    var connectionType = transport.connectionType;
    debug('Transport down: %s', connectionType);
    this._transports.remove(transport);

    if (transport !== this._transport) {
      return;
    }

    this._transport = null;

    if (!this._disconnecting) {
      /* Attempt to reconnect immediately */
      this._reselectTransport()
        .catch(function(e) {
          /**
           * Reconnect failed. We'll wait until another sendMessage
           * before retrying
           */
          debug('Unable to reselect transport after down: %s', e);
        })
        .done();
    }
  },

  _setTransport: function(transport) {
    if (transport === this._transport) return;
    // No need to close the existing transport as it may have
    // outstanding

    this._transport = transport;
    this.connectionType = transport.connectionType;
  }
};

// TODO: switch this for a transport pool
function TransportCache() {
  this._transports = {};
  this._loading = {};
}

TransportCache.prototype = {
  exists: function(connectionType) {
    return !!this._transports[connectionType] || !!this._loading[connectionType];
  },

  get: function(connectionType) {
    if (this._transports[connectionType]) return Promise.resolve(this._transports[connectionType]);
    if (this._loading[connectionType]) return this._loading[connectionType];
    return Promise.reject(new Error('No instance'));
  },

  /**
   * Returns true if the new transport is async
   */
  add: function(transport) {
    var connectionType = transport.connectionType;
    this.remove(transport);

    /* Non async */
    if (!transport.connect) {
      this._transports[connectionType] = transport;
      return;
    }

    if (transport.connect) {
      var promise = this._loading[connectionType] = transport.connect()
        .bind(this)
        .then(function() {
          this._transports[connectionType] = transport;
          return transport;
        })
        .finally(function() {
          var loading = this._loading[connectionType];

          if (loading === promise) {
            delete this._loading[connectionType];
          }
        });

      return true;
    }
  },

  remove: function(transport) {
    var connectionType = transport.connectionType;

    if (transport !== this._transports[connectionType]) {
      return;
    }

    delete this._transports[connectionType];

    var loading = this._loading[connectionType];
    if (loading) {
      loading.cancel();
      delete this._loading[connectionType];
    }
  },

  removeAll: function() {
    var transports = this._transports;
    this._transports = {};
    var loading = this._loading;
    this._loading = {};

    Object.keys(transports).forEach(function(connectionType) {
      transports[connectionType].close();
    });

    Object.keys(loading).forEach(function(connectionType) {
      loading[connectionType].cancel();
    });
  }

};

/* Mixins */
extend(Dispatcher.prototype, PublisherMixin);

module.exports = Dispatcher;
