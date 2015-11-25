'use strict';

var Scheduler      = require('./scheduler');
var Transport      = require('../transport/transport');
var Channel        = require('./channel');
var PublisherMixin = require('../mixins/publisher');
var TransportPool  = require('./transport-pool');
var uri            = require('../util/uri');
var extend         = require('../util/externals').extend;
var debug          = require('debug')('halley:dispatcher');
var Promise        = require('bluebird');
var globalEvents   = require('../util/global-events');

var HANDSHAKE = 'handshake';
var RETRY = 'retry';
var NONE = 'none'; // TODO: handle none


var BAYEUX_VERSION = '1.0';

var MAX_REQUEST_SIZE = 2048;

/**
 * The dispatcher sits between the client and the transport.
 *
 * It's responsible for tracking sending messages to the transport,
 * tracking in-flight messages
 */
function Dispatcher(endpoint, advice, options) {
  this._advice = advice;
  this._envelopes = {};
  this._scheduler = options.scheduler || Scheduler;
  this._state = 0;
  this._pool = new TransportPool(this, uri.parse(endpoint), advice, options.disabled, Transport.getRegisteredTransports());
  this.maxRequestSize = MAX_REQUEST_SIZE;

  this.listenTo(globalEvents, 'beforeunload', this.disconnecting);
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
    this._pool.closing();
  },

  close: function() {
    debug('_close');

    this._cancelPending();

    debug('Dispatcher close requested');
    this._pool.close();
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

  selectTransport: function(allowedTransportTypes, cleanup) {
    return this._pool.setAllowed(allowedTransportTypes, cleanup);
  },

  /**
   * Returns a promise of the response
   */
  sendMessage: function(message, timeout, options) {
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
      interval: this._advice.retry,
      attempts: options && options.attempts
    });

    var promise = envelope.promise = this._attemptSend(envelope, message, scheduler)
      .bind(this);

    if (options && options.deadline) {
      promise = promise.timeout(options && options.deadline, 'Timeout on deadline');
    }

    promise = promise.then(function(response) {
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

  _attemptSend: function(envelope, message, scheduler) {
    if (!scheduler.isDeliverable()) {
      return Promise.reject(new Error('No longer deliverable'));
    }
    var isConnectMessage = message.channel === Channel.CONNECT;

    scheduler.send();
    return this._pool.get()
      .bind(this)
      .timeout(scheduler.getTimeout(), 'Timeout awaiting transport')
      .then(function(transport) {
        message = this._enrich(message, transport);
        debug('attemptSend: %j', message);

        var sendPromise = transport.sendMessage(message)
          .bind(this)
          .then(function() {
            // Note that if the send has other listeners
            // for example on batched transports, we need to
            // chain the promise in order to prevent other
            // listeners from being cancelled.
            // In other words, the send will only
            // cancel if all the subscribers cancel it
            if (isConnectMessage) {
              if (this._state !== this.UP) {
                this._state = this.UP;
                this.trigger('transport:up');

                // If we've disable websockets due to a network
                // outage, try re-enable them now
                this._pool.reevaluate();
              }
            }

            return null;
          });

        // If the response didn't win the race we know that we have a
        // transport
        return new Promise(function(resolve, reject) {
          envelope.resolve = resolve;

          // For connect messages, reject the message on transportDown
          envelope.reject = isConnectMessage ? reject : null;
        })
        .timeout(scheduler.getTimeout(), 'Timeout awaiting message response')
        .catch(Promise.TimeoutError, function(err) {
          // Cancel the send
          sendPromise.cancel();

          throw err;
        })
        .then(function(response) {
          if (response.successful === false && response.advice && response.advice.reconnect === HANDSHAKE) {
            // This is not standard, and may need a bit of reconsideration
            // but if the client sends a message to the server and the server responds with
            // an error and tells the client it needs to rehandshake,
            // reschedule the send after the send after the handshake has occurred.
            throw new Error('Message send failed with advice reconnect:handshake, will reschedule send');
          }
          return response;
        })
        .finally(function() {
          envelope.resolve = null;
          envelope.reject = null;
        });
      })
      .catch(function(e) {
        if (isConnectMessage) {
          if (this._state !== this.DOWN) {
            this._state = this.DOWN;
            this.trigger('transport:down');
          }
        }

        debug('Error while attempting to send message: %j: %s', message, e && e.stack || e);

        scheduler.fail();

        if (!scheduler.isDeliverable()) {
          throw e;
        }
        // Either the send timed out or no transport was
        // available. Either way, wait for the interval and try again
        return this._awaitRetry(envelope, message, scheduler);
      });

  },

  /**
   * Adds required fields into the message
   */
  _enrich: function(message, transport) {
    if (message.channel === Channel.CONNECT) {
      message.connectionType = transport.connectionType;
    }

    if (message.channel === Channel.HANDSHAKE) {
      message.version = BAYEUX_VERSION;
      message.supportedConnectionTypes = this.getConnectionTypes()
    } else {
      if (!this.clientId) {
        // Theres probably a nicer way of doing this. If the connection
        // is in the process of being re-established, throw an error
        // for non-handshake messages which will cause them to be rescheduled
        // in future, hopefully once the client is CONNECTED again
        throw new Error('client is not yet established');
      }
      message.clientId = this.clientId;
    }

    return message;
  },

  /**
   * Send has failed. Retry after interval
   */
  _awaitRetry: function(envelope, message, scheduler) {
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

    if (reply.advice) this._handleAdvice(reply.advice);

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
  },

  /**
   * Currently, this only gets called by streaming transports (websocket)
   * and let's the dispatcher know that the connection is unavailable
   * so it needs to switch to an alternative transport
   */
  transportDown: function(transport) {
    var envelopes = this._envelopes;
    Object.keys(envelopes).forEach(function(id) {
      var envelope = envelopes[id];
      if (envelope.reject) envelope.reject(new Error('Transport down'));
    });
    this._pool.down(transport);
  },

  /**
   * Update advice
   */
  _handleAdvice: function(newAdvice) {
    var advice = this._advice;

    var adviceUpdated = false;
    ['timeout', 'interval'].forEach(function(key) {
      if (newAdvice[key] && newAdvice[key] !== advice[key]) {
        adviceUpdated = true;
        advice[key] = newAdvice[key];
      }
    });

    if (adviceUpdated) {
      debug('Advice updated to %j using %j', advice, newAdvice);
    }

    switch(newAdvice.reconnect) {
      case HANDSHAKE:
        this.trigger('reconnect:handshake');
        break;

      case NONE:
        this.trigger('reconnect:none');
        break;
    }

  },

};

/* Mixins */
extend(Dispatcher.prototype, PublisherMixin);

module.exports = Dispatcher;
