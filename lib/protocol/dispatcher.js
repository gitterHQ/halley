'use strict';

var Scheduler      = require('./scheduler');
var Transport      = require('../transport/transport');
var PublisherMixin = require('../mixins/publisher');
var uri            = require('../util/uri');
var Envelope       = require('./envelope');
var extend         = require('lodash/object/extend');
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
  this._client     = client;
  this.endpoint    = uri.parse(endpoint);
  this._alternates = options.endpoints || {};

  this._disabled    = options.disabled;
  this._envelopes   = {};
  this.retry        = options.retry || DEFAULT_RETRY;
  this._scheduler   = options.scheduler || Scheduler;
  this._state       = 0;
  this._disconnecting = false;
  this._transports  = {};
  this.wsExtensions = options.websocketExtensions;
  this._allowedTransportTypes = [];

  for (var type in this._alternates)
    this._alternates[type] = uri.parse(this._alternates[type]);

  this.maxRequestSize = MAX_REQUEST_SIZE;

  this.listenTo(globalEvents, 'beforeunload', this.disconnecting);
  this._discoverTransports();
}

Dispatcher.prototype = {

  UP:   1,
  DOWN: 2,

  destroy: function() {
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

  endpointFor: function(connectionType) {
    return this._alternates[connectionType] || this.endpoint;
  },

  close: function() {
    this._cancelPending();

    debug('Dispatcher close requested');
    var transports = this._transports;

    this._disconnecting = true;
    this._allowedTransportTypes = [];
    this._transports = {};

    this._closeTransport();

    // Close all transports
    Object.keys(transports).forEach(function(connectionType) {
      var transport = transports[connectionType];
      if (transport) {
        transport.close();
      }
    });

  },

  _cancelPending: function() {
    var envelopes = this._envelopes;
    this._envelopes = {};
    Object.keys(envelopes).forEach(function(id) {
      var envelope = envelopes[id];
      envelope.reject(new Error('Dispatcher closed'));
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

  _reselectTransport: function() {
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
        } catch(e) {
          debug('isUsable failed for %s: %s', type, e);
          return false;
        }
      });

    debug('Racing transports %j', registeredTransports);

    var hasAsync = false;
    var connectionPromises = registeredTransports.map(function(transport) {
      var type = transport[0];
      var Klass = transport[1];

      if (self._transports[type]) {
        // TODO: check that the connection is still valid
        return self._transports[type];
      }

      var instance;
      try {
        instance = new Klass(self, endpoint);
      } catch(e) {
        debug('Unable to create instance of %s: %s', type, e);
        // TODO: possibly disable this endpoint
        return Promise.reject(e);
      }

      if (instance.connect) {
        hasAsync = true;
        return instance.connect()
          .then(function() {
            self._transports[type] = instance;
            return instance;
          })
          .catch(function(e) {
            // TODO: handle this situation better.
            // Add the handler to the list of disabled?
            console.log('UNABLE TO USE ', type, e);
          })
      } else {
        self._transports[type] = instance;
        return instance;
      }
    });

    if (hasAsync) {
      // Some connection types may be better once
      // we know that they're able to connect
      // possibly switch to them once
      // the connection is established
      Promise.settle(connectionPromises)
        .then(function() {
          if (self._disconnecting) return;
          if (!self._allowedTransportTypes.length) return;
          return self._reselectTransport();
        })
        .catch(function(err) {
          debug('Unable to select new transport: %s', err);
        });
    }


    // Return the first usable transport
    return Promise.any(connectionPromises);

  },

  sendMessage: function(message, timeout, options) {
    options = options || {};

    var self = this;
    var id = message.id;
    var attempts = options.attempts;
    var envelope = this._envelopes[id];

    if (!envelope) {
      var scheduler = new this._scheduler(message, { timeout: timeout, interval: this.retry, attempts: attempts });
      envelope = this._envelopes[id] = new Envelope(message, scheduler, { deadline: options.deadline });

      // Remove the envelope on resolve or reject
      envelope.promise.finally(function removeEnvelope() {
        delete self._envelopes[id];
      });
    }

    this._sendEnvelope(envelope);
    return envelope.promise;
  },

  _sendEnvelope: function(envelope) {
    if (!this._transport) {
      // TODO: We have no transport!
      debugger;
      return;
    }

    var self = this;

    function onTimeout() {
      debug('Envelope timeout %j', envelope);
      self.handleError(envelope.message);
    }

    function onSend() {
      return self._transport.sendMessage(envelope.message);
    }

    envelope.scheduleSend(onSend, onTimeout);
  },

  handleResponse: function(reply) {
    debug('handleResponse %j', reply);

    var envelope = this._envelopes[reply.id];

    if (reply.successful !== undefined && envelope) {
      // This is a response to a message we fired.
      envelope.resolve(reply);
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

  handleError: function(message) {
    debug('handleError %j', message);
    var envelope = this._envelopes[message.id];

    if (!envelope) return;

    var self = this;

    envelope.failScheduleRetry(function() {
      self._sendEnvelope(envelope);
    });

    if (this._state === this.DOWN) return;
    this._state = this.DOWN;
    this._client.trigger('transport:down');
  },

  transportDown: function(transport) {
    var connectionType = transport.connectionType;
    debug('Transport down: %s', connectionType);

    if(this._transports[connectionType] === transport) {
      delete this._transports[connectionType];
      // TODO: check if this type is still usable....
    }

    if (transport !== this._transport) {
      return;
    }

    this._transport = null;

    if (!this._disconnecting) {
      this._reselectTransport()
        .done();
    }
  },

  _setTransport: function(transport) {
    if (transport === this._transport) return;
    this._closeTransport();

    this._transport = transport;
    this.connectionType = transport.connectionType;
  },

  _closeTransport: function() {
    if (this._transport) this._transport.close();
  },


  ping: function() {
    if (!this._transport) {
      return Promise.reject('Transport not available');
    }

    return this._transport.ping();
  }
};

/* Mixins */
extend(Dispatcher.prototype, PublisherMixin);

module.exports = Dispatcher;
