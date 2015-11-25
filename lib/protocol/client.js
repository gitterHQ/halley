'use strict';

var Extensions        = require('./extensions');
var PublisherMixin    = require('../mixins/publisher');
var BayeuxError       = require('../error');
var Channel           = require('./channel');
var ChannelSet        = require('./channel-set');
var Dispatcher        = require('./dispatcher');
var Subscription      = require('./subscription');
var Promise           = require('bluebird');
var debug             = require('debug')('halley:client');
var StateMachineMixin = require('../mixins/statemachine-mixin');
var extend            = require('../util/externals').extend;
var globalEvents      = require('../util/global-events');

var MANDATORY_CONNECTION_TYPES = ['long-polling'];
var BAYEUX_VERSION = '1.0';
var DEFAULT_ENDPOINT = '/bayeux';

var HANDSHAKE = 'handshake';
var RETRY = 'retry';
var NONE = 'none'; // TODO: handle none

var NETWORK_DELAY_FACTOR = 1.2;

var CONNECTION_TIMEOUT = 15000;
var INTERVAL = 0;

var DEFAULT_RETRY = 1000;

/**
 * After three successive failures, make sure we're not trying to quickly
 */
var HANDSHAKE_FAILURE_THRESHOLD = 3;
var HANDSHAKE_FAILURE_MIN_INTERVAL = 1000;

/**
 * TODO: make the states/transitions look more like the official client states
 * http://docs.cometd.org/reference/bayeux_operation.html#d0e9971
 */
var FSM = {
  name: "client",
  initial: "UNCONNECTED",
  transitions: {
    // The client is not yet connected
    UNCONNECTED: {
      connect: "HANDSHAKING",
      reset: "HANDSHAKING"
    },
    // The client is undergoing the handshake process
    HANDSHAKING: {
      handshakeSuccess: "CONNECTED",
      rehandshake: "HANDSHAKE_WAIT", // TODO:remove
      disconnect: "UNCONNECTED",
      error: "HANDSHAKE_WAIT"
    },
    // Handshake failed, try again after interval
    HANDSHAKE_WAIT: {
      timeout: "HANDSHAKING",
      disconnect: "UNCONNECTED"
    },
    // The client is connected
    CONNECTED: {
      disconnect: "DISCONNECTING",
      rehandshake: "HANDSHAKE_WAIT",
      reset: "RESETTING",
    },
    // The client is undergoing reset
    // RESETTING is handled by the same handler as disconnect, so must
    // support the same transitions (with different states)
    RESETTING: {
      disconnectSuccess: "HANDSHAKING",
      reset: "HANDSHAKING",
      error: "HANDSHAKING"
    },
    // The client is disconnecting
    DISCONNECTING: {
      disconnectSuccess: "UNCONNECTED",
      reset: "HANDSHAKING",
      error: "UNCONNECTED"
    }
  }
};

function validateBayeuxResponse(response) {
  if (!response) {
    throw new Error('No response received');
  }

  if (!response.successful) {
    throw BayeuxError.parse(response.error);
  }

  return response;
}

/**
 * The Faye Client
 */
function Client(endpoint, options) {
  debug('New client created for %s', endpoint);
  if (!options) options = {};

  this._advice = {
    reconnect: RETRY,
    interval: options.interval || INTERVAL,
    timeout: options.timeout || CONNECTION_TIMEOUT,
    retry: options.retry || DEFAULT_RETRY
  };
  debug('Initial advice: %j', this._advice);

  this._extensions = new Extensions();
  this._endpoint = endpoint || DEFAULT_ENDPOINT;
  this._channels = new ChannelSet();
  this._dispatcher = options.dispatcher || new Dispatcher(this._endpoint, this._advice, options);
  this._initialConnectionTypes = options.connectionTypes || MANDATORY_CONNECTION_TYPES;
  this._messageId = 0;

  /**
   * How many times have we failed handshaking
   */
  this._failedHandshakeCount = 0;

  this.initStateMachine(FSM);

  // Fire a disconnect when the user navigates away
  this.listenTo(globalEvents, 'beforeunload', this.disconnect);

  this.listenTo(this._dispatcher, 'message', this._receiveMessage);
}

Client.prototype = {
  addExtension: function(extension) {
    this._extensions.add(extension);
  },

  removeExtension: function(extension) {
    this._extensions.remove(extension);
  },

  handshake: function() {
    debug('handshake');
    return this.transitionState('connect', { optional: true });
  },

  connect: function() {
    debug('connect');
    return this.transitionState('reconnect', { optional: true });
  },

  disconnect: function() {
    debug('disconnect');
    return this.transitionState('disconnect', { optional: true });
  },

  /**
   * Subscribe to a channel
   * @return Subscription object
   */
  subscribe: function(channel, onMessage, context) {
    debug('subscribe: channel=%s', channel);

    var deferredSub = Subscription.createDeferred(this, channel, onMessage, context);
    var defer = deferredSub.defer;
    var subscription = deferredSub.subscription;

    var hasSubscribe = this._channels.hasSubscription(channel);

    // If the client is resubscribing to an existing channel
    // there is no need to re-issue to message to the server
    if (hasSubscribe) {
      this._channels.subscribe(channel, onMessage, context);
      defer.resolve(subscription);
      return subscription;
    }

    this._waitConnect()
      .bind(this)
      .then(function() {
        this._channels.subscribe(channel, onMessage, context);

        return this._sendMessage({
          channel: Channel.SUBSCRIBE,
          clientId: this._dispatcher.clientId,
          subscription: channel

        }, {});
      })
      .then(function(response) {
        validateBayeuxResponse(response);

        debug('Subscription acknowledged for %s to %s', this._dispatcher.clientId,
          response.subscription);

        // Note that it may be tempting to return the subscription in the promise
        // but this causes problems since subscription is a `thenable`
        defer.resolve();
      })
      .catch(function(err) {
        debug('Subscription rejected for %s to %s', err.stack);
        defer.reject(err);
      })
      .done();

    return subscription;
  },

  /**
   * Unsubscribe from a channel
   * @return {Promise}
   */
  unsubscribe: function(channel, callback, context) {
    var dead = this._channels.unsubscribe(channel, callback, context);
    if (!dead) return Promise.resolve();

    return this._waitConnect()
      .bind(this)
      .then(function() {
        return this._sendMessage({
          channel: Channel.UNSUBSCRIBE,
          clientId: this._dispatcher.clientId,
          subscription: channel

        }, {});
      })
      .then(validateBayeuxResponse);
  },

  /**
   * Publish a message
   * @return {Promise} A promise of the response
   */
  publish: function(channel, data, options) {
    return this._waitConnect()
      .bind(this)
      .then(function() {
        return this._sendMessage({
          channel: channel,
          data: data,
          clientId: this._dispatcher.clientId

        }, options);
      })
      .then(validateBayeuxResponse);
  },

  /**
   * Resets the client and resubscribes to existing channels
   * This can be used when the client is in an inconsistent state
   * @fires Client#reset
   */
  reset: function() {
    this.trigger('reset');
    return this.transitionState('reset', { optional: true });
  },

  /**
   * Returns the clientId or null
   */
  getClientId: function() {
    return this._dispatcher.clientId;
  },

  /**
   * Wait for the client to connect
   * @return Promise
   */
  _waitConnect: Promise.method(function() {
    if (this.stateIs('CONNECTED')) return;

    return this.transitionState('connect', { optional: true });
  }),

  /**
   * The client must issue a handshake with the server

   * @fires Client#handshake:request
   * @fires Client#handshake:fail
   * @fires Client#handshake:success
   */
  _onEnterHANDSHAKING: function() {
    this._dispatcher.clientId = null;
    this.trigger('handshake:request');

    return this._dispatcher.selectTransport(this._initialConnectionTypes)
      .bind(this)
      .then(function() {
        return this._sendMessage({
            channel:                  Channel.HANDSHAKE,
            version:                  BAYEUX_VERSION,
            supportedConnectionTypes: this._dispatcher.getConnectionTypes()
          }, {
            attempts: 1 // Note: only try once
          });
      })
      .then(function(response) {
        validateBayeuxResponse(response);

        this._dispatcher.clientId = response.clientId;
        var supportedConnectionTypes = this._supportedTypes = response.supportedConnectionTypes;
        debug('Handshake successful: %s', this._dispatcher.clientId);
        this.trigger('handshake:success');

        return this._dispatcher.selectTransport(supportedConnectionTypes, true);
      })
      .return('handshakeSuccess');
  },

  /**
   * Handshake has failed. Waits `interval` ms then
   * attempts another handshake
   */
  _onEnterHANDSHAKE_WAIT: function() {
    this._failedHandshakeCount++;

    // Interval
    var intervalValue = this._advice.interval;
    if (this._failedHandshakeCount > HANDSHAKE_FAILURE_THRESHOLD && intervalValue < HANDSHAKE_FAILURE_MIN_INTERVAL) {
      intervalValue = HANDSHAKE_FAILURE_MIN_INTERVAL;
    }

    return Promise.delay(intervalValue)
      .return('timeout');
  },

  /**
   * The client has connected. It needs to send out regular connect
   * messages.
   */
  _onEnterCONNECTED: function() {
    /* Handshake success, reset count */
    this._failedHandshakeCount = 0;

    this._sendConnect();

    this._resubscribeAll() // Not chained
      .catch(function(err) {
        debug('resubscribe all failed on connect: %s', err);
      })
      .done();

    return Promise.resolve();
  },

  /**
   * Stop sending connect messages
   */
  _onLeaveCONNECTED: function() {
    if (this._connect) {
      debug('Cancelling pending connect request');
      this._connect.cancel();
      this._connect = null;
    }
  },

  /**
   * The client will attempt a disconnect and will
   * transition back to the HANDSHAKING state
   */
  _onEnterRESETTING: function() {
    debug('Resetting %s', this._dispatcher.clientId);
    return this._onEnterDISCONNECTING();
  },

  /**
   * The client is disconnecting, or resetting.
   */
  _onEnterDISCONNECTING: function() {
    debug('Disconnecting %s', this._dispatcher.clientId);

    /** Tell the dispatcher not to reconnect after a transport disconnect */
    this._dispatcher.disconnecting();

    return this._sendMessage({
        channel: Channel.DISCONNECT,
        clientId: this._dispatcher.clientId
      }, {
        attempts: 1
      })
      .bind(this)
      .then(validateBayeuxResponse)
      .return('disconnectSuccess')
      .finally(function() {
        this._dispatcher.close();

        this.trigger('disconnect');
      });
  },

  /**
   * The client is no longer connected.
   */
  _onEnterUNCONNECTED: function() {
    this._dispatcher.clientId = null;
    this._dispatcher.close();
    debug('Clearing channel listeners for %s', this._dispatcher.clientId);
    this._channels = new ChannelSet();
  },

  /**
   * Use to resubscribe all previously subscribed channels
   * after re-handshaking
   */
  _resubscribeAll: Promise.method(function() {
    var self = this;
    var channels = this._channels.getKeys();
    if (!channels || !channels.length) return;

    return Promise.all(channels.map(function(channel) {
        debug('Client %s attempting to resubscribe to %s', self._dispatcher
          .clientId, channel);

        return self._sendMessage({
            channel: Channel.SUBSCRIBE,
            clientId: self._dispatcher.clientId,
            subscription: channel

          }, {})
          .then(validateBayeuxResponse);
      }));

  }),

  /**
   * Send a request message to the server, to which a reply should
   * be received.
   *
   * @return Promise of response
   */
  _sendMessage: function(message, options) {
    debug('sendMessage: %j, options: %j', message, options);

    message.id = this._generateMessageId();

    var timeout = this._advice.timeout ?
      NETWORK_DELAY_FACTOR * this._advice.timeout :
      NETWORK_DELAY_FACTOR * this._advice.retry;

    return this._extensions.pipe('outgoing', message)
      .bind(this)
      .then(function(message) {
        if (!message) return;

        return this._dispatcher.sendMessage(message, timeout, options)
          .bind(this)
          .then(function(response) {
            return this._transformIncomingMessage(response);
          });
      });

  },

  /**
   * Event handler for when a message has been received through a channel
   * as opposed to as the result of a request.
   */
  _receiveMessage: function(message) {
    this._transformIncomingMessage(message)
      .bind(this)
      .then(function(message) {
        if (!message) return;

        if (!message || !message.channel || message.data === undefined) return;
        this._channels.distributeMessage(message);
        return null;
      })
      .done();
  },

  /**
   * Generate a unique messageid
   */
  _generateMessageId: function() {
    this._messageId += 1;
    if (this._messageId >= Math.pow(2, 32)) this._messageId = 0;
    return this._messageId.toString(36);
  },

  /**
   * Pipe messages through incoming extensions and update advice
   */
  _transformIncomingMessage: function(message) {
    return this._extensions.pipe('incoming', message)
      .bind(this)
      .then(function(message) {
        if (message && message.advice) this._handleAdvice(message.advice);
        return message;
      });
  },

  /**
   * Update advice
   */
  _handleAdvice: function(advice) {
    var _advice = this._advice;

    var adviceUpdated = false;
    ['timeout', 'reconnect', 'interval'].forEach(function(key) {
      if (advice[key] && advice[key] !== _advice[key]) {
        adviceUpdated = true;
        _advice[key] = advice[key];
      }
    });

    if (adviceUpdated) {
      debug('Advice updated to %j using %j', _advice, advice);
    }

    // Presumably after the handshake, the advice will
    // once again be updated so that we don't keep
    // re-handshaking
    if (_advice.reconnect === HANDSHAKE) {
      this.transitionState('rehandshake', { optional: true });
    }

    // TODO: deal with `none` reconnect advice
  },

  /**
   * Periodically fire a connect message with `interval` ms between sends
   * Ensures that multiple connect messages are not fired simultaneously.
   *
   * From the docs:
   * From the docs:
   * The client MUST maintain only a single outstanding connect message.
   * If the server does not have a current outstanding connect and a connect
   * is not received within a configured timeout, then the server
   * SHOULD act as if a disconnect message has been received.
   */
  _sendConnect: function() {
    if (this._connect) {
      debug('Cancelling pending connect request');
      this._connect.cancel();
      this._connect = null;
    }

    var connect = this._connect = this._sendMessage({
        channel: Channel.CONNECT,
        clientId: this._dispatcher.clientId,
        // Note: connectionType will be set in dispatcher
      })
      .bind(this)
      .then(validateBayeuxResponse)
      .catch(function(err) {
        debug('Connect failed: %s', err && err.stack || err);
      })
      .finally(function() {
        this._connect = null;

        // If we're no longer connected so don't re-issue the
        // connect again
        if (!this.stateIs('CONNECTED')) {
          return null;
        }

        debug('Will connect after interval: %sms', this._advice.interval);
        connect = this._connect = Promise.delay(this._advice.interval)
          .bind(this)
          .then(function() {
            this._connect = null;

            // No longer connected after the interval, don't re-issue
            if (!this.stateIs('CONNECTED')) {
              return;
            }

            /* Do not chain this */
            this._sendConnect();

            // Return an empty promise to stop
            // bluebird from raising warnings
            return Promise.resolve();
          });

        // Return an empty promise to stop
        // bluebird from raising warnings
        return Promise.resolve();
      });
  }

};

/* Mixins */
extend(Client.prototype, PublisherMixin);
extend(Client.prototype, StateMachineMixin);

module.exports = Client;
