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
var BAYEUX_VERSION = '1.0';

var STATE_UP = 1;
var STATE_DOWN = 2;

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

  this.listenTo(globalEvents, 'beforeunload', this.disconnecting);
}

Dispatcher.prototype = {

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
    var envelopes = this._envelopes;
    this._envelopes = {};
    var envelopeKeys = Object.keys(envelopes);

    debug('_cancelPending %s envelopes', envelopeKeys.length);
    envelopeKeys.forEach(function(id) {
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
  sendMessage: function(message, options) {
    var id = message.id;
    var envelope = this._envelopes[id];
    var advice = this._advice;

    // Already inflight
    if (envelope) {
      debug('sendMessage: already in-flight');
      return envelope.promise;
    }

    envelope = this._envelopes[id] = {
      resolve: null,
      promise: null
    };

    var isConnectMessage = message.channel === Channel.CONNECT;

    var timeout;
    if (options && options.timeout) {
      timeout = options.timeout;
    } else {
      timeout = isConnectMessage ? advice.timeout : advice.getMaxNetworkDelay();
    }

    var scheduler = new this._scheduler(message, {
      timeout: timeout,
      interval: advice.retry,
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

    scheduler.send();

    var responsePromise = new Promise(function(resolve/*, reject, onCancel*/) {
      envelope.resolve = resolve;
    });

    var start = Date.now();
    var timeout = scheduler.getTimeout();

    // 1. Obtain transport
    return this._pool.get()
      .bind(this)
      .then(function(transport) {
        // 2. Send the message using the given transport
        message = this._enrich(message, transport);
        debug('attemptSend: %j', message);

        return transport.sendMessage(message)
          .timeout(this._advice.getEstablishTimeout(), 'Timeout on message send');
      })
      .catch(function(e) {
        this._triggerDown();
        throw e;
      })
      .then(function() {
        this._triggerUp();

        var remaining = timeout - (Date.now() - start);

        // 3. Wait for the response from the transport
        return responsePromise.timeout(remaining, 'Timeout on message response');
      })
      .then(function(response) {
        // 4. Parse the response

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
      })
      .catch(function(e) {
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
      message.supportedConnectionTypes = this.getConnectionTypes();
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
    if (reply.advice) this._advice.update(reply.advice);
    var id = reply.id;
    var envelope = id && this._envelopes[id];

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

  _triggerDown: function() {
    if (this._state === STATE_DOWN) return;
    debug('Dispatcher is DOWN');

    this._state = STATE_DOWN;
    this.trigger('transport:down');
  },

  _triggerUp: function() {
    if (this._state === STATE_UP) return;
    debug('Dispatcher is UP');

    this._state = STATE_UP;
    this.trigger('transport:up');

    // If we've disable websockets due to a network
    // outage, try re-enable them now
    this._pool.reevaluate();
  },

  /**
   * Called by transports on connection error
   */
  transportDown: function(transport) {
    // If this transport is the current,
    // report the connection as down
    if (transport === this._pool.current()) {
      this._triggerDown();
    }

    this._pool.down(transport);
  },

  isTransportUp: function() {
    return this._state === STATE_UP;
  }
};

/* Mixins */
extend(Dispatcher.prototype, PublisherMixin);

module.exports = Dispatcher;
