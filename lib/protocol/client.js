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

var MANDATORY_CONNECTION_TYPES = ['long-polling', 'callback-polling',
  'in-process'
];
var BAYEUX_VERSION = '1.0';
var DEFAULT_ENDPOINT = '/bayeux';

var HANDSHAKE = 'handshake';
var RETRY = 'retry';
var NONE = 'none'; // TODO: handle none

var NETWORK_DELAY_FACTOR = 1.2;

var CONNECTION_TIMEOUT = 60;
var INTERVAL = 0;

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
      rehandshake: "HANDSHAKE_WAIT",
      disconnect: "UNCONNECTED"
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
      disconnectFailure: "HANDSHAKING",
      reset: "HANDSHAKING"
    },
    // The client is disconnecting
    DISCONNECTING: {
      disconnectSuccess: "UNCONNECTED",
      disconnectFailure: "UNCONNECTED",
      reset: "HANDSHAKING"
    }
  }
};

/**
 * The Faye Client
 */
function Client(endpoint, options) {
  debug('New client created for %s', endpoint);
  if (!options) options = {};

  this._extensions = new Extensions();
  this._endpoint = endpoint || DEFAULT_ENDPOINT;
  this._channels = new ChannelSet();
  this._dispatcher = options.dispatcher || new Dispatcher(this, this._endpoint, options);
  this._initialConnectionTypes = options.connectionTypes || MANDATORY_CONNECTION_TYPES;
  this._messageId = 0;

  /**
   * How many times have we failed handshaking
   */
  this._failedHandshakeCount = 0;

  this.initStateMachine(FSM);

  // Fire a disconnect when the user navigates away
  this.listenTo(globalEvents, 'beforeunload', this.disconnect);

  // TODO: change advice values to ms
  this._advice = {
    reconnect: RETRY,
    interval: 1000 * (options.interval || INTERVAL),
    timeout: 1000 * (options.timeout || CONNECTION_TIMEOUT)
  };
  this._dispatcher.timeout = this._advice.timeout;

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
    this.transitionState('connect', { optional: true });
  },

  connect: function() {
    debug('connect');
    this.transitionState('reconnect', { optional: true });
  },

  disconnect: function() {
    debug('disconnect');
    this.transitionState('disconnect', { optional: true });

    return this.waitForState({
        fulfilled: 'UNCONNECTED',
        rejected: 'CONNECTED'
      });
  },

  /**
   * Subscribe to a channel
   * @return Subscription object
   */
  subscribe: function(channel, onMessage, context) {
    debug('subscribe: channel=%s', channel);
    var self = this;

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

    this.transitionState('connect', { optional: true });

    this.waitForState({
        fulfilled: 'CONNECTED',
        rejected: 'UNCONNECTED'
      })
      .then(function() {
        self._channels.subscribe(channel, onMessage, context);

        return self._sendMessage({
          channel: Channel.SUBSCRIBE,
          clientId: self._dispatcher.clientId,
          subscription: channel

        }, {});
      })
      .then(function(response) {
        if (!response.successful) {
          throw BayeuxError.parse(response.error);
        }

        debug('Subscription acknowledged for %s to %s', self._dispatcher.clientId,
          response.subscription);

        // Note that it may be tempting to return the subscription in the promise
        // but this causes problems since subscription is a `thenable`
        defer.resolve();
      })
      .catch(function(err) {
        debug('Subscription rejected for %s to %s', err.stack);
        defer.reject(err);
      });

    return subscription;
  },

  /**
   * Unsubscribe from a channel
   * @return {Promise}
   */
  unsubscribe: function(channel, callback, context) {
    var self = this;

    var dead = this._channels.unsubscribe(channel, callback, context);
    if (!dead) return Promise.resolve();

    this.transitionState('connect', { optional: true });

    return this.waitForState({
        fulfilled: 'CONNECTED',
        rejected: 'UNCONNECTED'
      })
      .then(function() {
        return self._sendMessage({
          channel: Channel.UNSUBSCRIBE,
          clientId: self._dispatcher.clientId,
          subscription: channel

        }, {});
      })
      .then(function(response) {
        if (!response.successful) throw BayeuxError.parse(response.error);

        debug('Unsubscription acknowledged for %s from %s', self._dispatcher
          .clientId, response.subscription);
      });
  },

  /**
   * Publish a message
   * @return {Promise} A promise of the response
   */
  publish: function(channel, data, options) {
    this.transitionState('connect', { optional: true });

    return this.waitForState({
        fulfilled: 'CONNECTED',
        rejected: 'UNCONNECTED'
      })
      .bind(this)
      .then(function() {
        return this._sendMessage({
          channel: channel,
          data: data,
          clientId: this._dispatcher.clientId

        }, options);
      })
      .then(function(response) {
        if (!response.successful) {
          throw BayeuxError.parse(response.error);
        }

        return response;
      });
  },

  /**
   * Resets the client and resubscribes to existing channels
   * This can be used when the client is in an inconsistent state
   * @fires Client#reset
   */
  reset: function() {
    this.trigger('reset');
    this.transitionState('reset', { optional: true });
  },

  /**
   * Returns the clientId or null
   */
  getClientId: function() {
    return this._dispatcher.clientId;
  },

  /**
   * The client must issue a handshake with the server

   * @fires Client#handshake:request
   * @fires Client#handshake:fail
   * @fires Client#handshake:success
   */
  _onEnterHANDSHAKING: function() {
    this._dispatcher.clientId = null;
    this.trigger('handshake:request');

    this._dispatcher.selectTransport(this._initialConnectionTypes)
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
      .catch(function(err) {
        debug('Handshake failed: %s',  err.stack);
        return null;
      })
      .then(function(response) {
        /* We're no longer in the handshake state, ignore */
        if (!this.stateIs('HANDSHAKING')) {
          return;
        }

        if (!response || !response.successful) {
          this.trigger('handshake:fail');
          // TODO: make sure that advice is uphelp
          this.transitionState('rehandshake', { optional: true });
          return;
        }

        this._dispatcher.clientId = response.clientId;
        var supportedConnectionTypes = this._supportedTypes = response.supportedConnectionTypes;
        debug('Handshake successful: %s', this._dispatcher.clientId);
        this.trigger('handshake:success');

        return this._dispatcher.selectTransport(supportedConnectionTypes)
          .bind(this)
          .then(function() {
            this._resubscribeAll();
            this.transitionState('handshakeSuccess');
            return null;
          });
      })
      .catch(function(err) {
        debug('Handshake failed: %s', err);
      })
      .done();
  },

  /**
   * Handshake has failed. Waits `interval` ms then
   * attempts another handshake
   */
  _onEnterHANDSHAKE_WAIT: function() {
    var self = this;
    this._failedHandshakeCount++;

    // Interval
    var intervalValue = this._advice.interval;
    if (this._failedHandshakeCount > HANDSHAKE_FAILURE_THRESHOLD && intervalValue < HANDSHAKE_FAILURE_MIN_INTERVAL) {
      intervalValue = HANDSHAKE_FAILURE_MIN_INTERVAL;
    }

    self._handshakeTimer = setTimeout(function() {
      self._handshakeTimer = null;
      self.transitionState('timeout', { optional: true });
    }, intervalValue);
  },

  /**
   * Cancel the `interval` timer
   */
  _onLeaveHANDSHAKE_WAIT: function() {
    if (!this._handshakeTimer) return;

    clearTimeout(this._handshakeTimer);
    this._handshakeTimer = null;
  },

  /**
   * The client has connected. It needs to send out regular connect
   * messages.
   */
  _onEnterCONNECTED: function() {
    /* Handshake success, reset count */
    this._failedHandshakeCount = 0;

    this._sendConnect();
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
    this._onEnterDISCONNECTING();
  },

  /**
   * The client is disconnecting, or resetting.
   */
  _onEnterDISCONNECTING: function() {
    debug('Disconnecting %s', this._dispatcher.clientId);
    var self = this;

    /** Tell the dispatcher not to reconnect after a transport disconnect */
    self._dispatcher.disconnecting();

    this._sendMessage({
        channel: Channel.DISCONNECT,
        clientId: this._dispatcher.clientId
      }, {
        attempts: 1
      })
      .bind(this)
      .then(function(response) {
        return response.successful;
      })
      .catch(function() {
        return false;
      })
      .then(function(success) {
        this._dispatcher.close();

        this.trigger('disconnect');
        this.transitionState(success ? 'disconnectSuccess' : 'disconnectFailure', { optional: true });
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
  _resubscribeAll: function() {
    var self = this;
    var channels = this._channels.getKeys();
    if (!channels || !channels.length) return;

    this.transitionState('connect', { optional: true });

    this.waitForState({
        fulfilled: 'CONNECTED',
        rejected: 'UNCONNECTED'
      })
      .then(function() {
        return Promise.all(channels.map(function(channel) {
          debug('Client %s attempting to resubscribe to %s', self._dispatcher
            .clientId, channel);

          return self._sendMessage({
              channel: Channel.SUBSCRIBE,
              clientId: self._dispatcher.clientId,
              subscription: channel

            }, {})
            .then(function(response) {
              if (!response.successful) {
                // TODO: better error-handling of this situation
                // We should warn the client that we have been unable to resubscribe
                // to the channel
                debug('Subscription rejected for %s to %s', self._dispatcher
                  .clientId, response.subscription);
              }
            });
        }));
      })
      .catch(function(err) {
        debug('_subscribeAll failed: %s', err);
      });

  },

  /**
   * Send a request message to the server, to which a reply should
   * be received.
   *
   * @return Promise of response
   */
  _sendMessage: function(message, options) {
    debug('sendMessage: %j, options: %j', message, options);
    var self = this;

    message.id = this._generateMessageId();
    var timeout = this._advice.timeout ?
      NETWORK_DELAY_FACTOR * this._advice.timeout :
      NETWORK_DELAY_FACTOR * this._dispatcher.retry;

    return self._extensions.pipe('outgoing', message)
      .then(function(message) {
        if (!message) return;

        return self._dispatcher.sendMessage(message, timeout, options || {})
          .then(function(reply) {
            return self._transformIncomingMessage(reply);
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
    extend(this._advice, advice);
    this._dispatcher.timeout = this._advice.timeout; // TODO: switch to ms

    debug('Client advice update: %j', this._advice);
    if (this._advice.reconnect === HANDSHAKE) {
      this.transitionState('rehandshake', { optional: true });
    }

    // TODO: deal with `none` reconnect advice
  },

  /**
   * Periodically fire a connect message with `interval` ms between sends
   * Ensures that multiple connect messages are not fired simultaneously
   */
  _sendConnect: function() {
    if (this._connect) {
      debug('Cancelling pending connect request');
      this._connect.cancel();
      this._connect = null;
    }

    // This should only ever be fired in CONNECTED state, so no need
    // to wait for the correct state

    var connect = this._connect = this._sendMessage({
        channel: Channel.CONNECT,
        clientId: this._dispatcher.clientId,
        connectionType: this._dispatcher.connectionType
      }, {
        attempts: 1 // Note: only try once
      })
      .bind(this)
      .then(function(response) {
        debug('sendMessage returned %j', response);
        this._connect = null;

        if (!response.successful) {
          throw BayeuxError.parse(response.error);
        }
      })
      .catch(function(err) {
        debug('Connect failed: %s', err && err.message);
      })
      .finally(function() {
        this._connect = null;

        // If we're no longer connected don't re-issue the
        // connect again
        if (!this.stateIs('CONNECTED')) {
          return;
        }

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
          })
          .done();

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
