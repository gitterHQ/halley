'use strict';

var Extensions = require('./extensions');
var PublisherMixin = require('../mixins/publisher');
var BayeuxError = require('../error');
var Channel = require('./channel');
var ChannelSet = require('./channel-set');
var Dispatcher = require('./dispatcher');
var Subscription = require('./subscription');
var Promise = require('bluebird');
var debug = require('debug-proxy')('faye:client');
var StateMachineMixin = require('../mixins/statemachine-mixin');
var extend = require('lodash/object/extend');
var globalEvents = require('../util/global-events');

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
      reset: "RESET_WAIT",
    },
    // The client is undergoing reset
    // RESET_WAIT is handled by the same handler as disconnect, so must
    // support the same transitions (with different states)
    RESET_WAIT: {
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

  this.initStateMachine(FSM);

  this.listenTo(globalEvents, 'beforeunload', this._onBeforeUnload);

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
    this.transitionState('connect', { optional: true });
  },

  /**
   * @fires Client#handshake:request
   * @fires Client#handshake:fail
   * @fires Client#handshake:success
   */
  _onEnterHANDSHAKING: function() {
    var self = this;
    self._dispatcher.clientId = null;
    this.trigger('handshake:request');

    debug('Initiating handshake with %s', this._endpoint.href);
    return this._dispatcher.selectTransport(this._initialConnectionTypes)
      .bind(this)
      .then(function() {
        return this._sendMessage({
            channel:                  Channel.HANDSHAKE,
            version:                  BAYEUX_VERSION,
            supportedConnectionTypes: this._dispatcher.getConnectionTypes()
          }, {});
      })
      .catch(function(err) {
        debug('Handshake failed: %s',  err.stack);
        return null;
      })
      .then(function(response) {
        /* We're no longer in the handshake state, ignore */
        if (!self.stateIs('HANDSHAKING')) {
          return;
        }

        if (!response || !response.successful) {
          this.trigger('handshake:fail');
          // TODO: make sure that advice is uphelp
          self.transitionState('rehandshake', { optional: true });
          return;
        }

        self._dispatcher.clientId = response.clientId;
        var supportedConnectionTypes = self._supportedTypes = response.supportedConnectionTypes;
        debug('Handshake successful: %s', self._dispatcher.clientId);
        this.trigger('handshake:success');

        return self._dispatcher.selectTransport(supportedConnectionTypes)
          .then(function() {
            debug('Post handshake reselect transport');
            self._resubscribeAll();
            self.transitionState('handshakeSuccess');
          });
      })
      .catch(function(err) {
        debug('Handshake failed: %s', err);
      });
  },

  _onEnterHANDSHAKE_WAIT: function() {
    var self = this;

    self._handshakeTimer = setTimeout(function() {
      self._handshakeTimer = null;
      self.transitionState('timeout', { optional: true });
    }, this._advice.interval);
  },

  _onLeaveHANDSHAKE_WAIT: function() {
    if (!this._handshakeTimer) return;

    clearTimeout(this._handshakeTimer);
    this._handshakeTimer = null;
  },

  connect: function() {
    this.transitionState('reconnect', { optional: true });
  },
  //
  // _onEnterAwaitingReconnect: function() {
  //   var self = this;
  //   this._intervalTimer = setTimeout(function() {
  //     self.transitionState('reconnect', { optional: true });
  //   }, self._advice.interval);
  // },
  //
  // _onLeaveAwaitingReconnect: function() {
  //   clearTimeout(this._intervalTimer);
  //   this._intervalTimer = null;
  // },

  disconnect: function() {
    this.transitionState('disconnect', { optional: true });

    return this.waitForState({
        fulfilled: 'UNCONNECTED',
        rejected: 'CONNECTED'
      });
  },

  _onEnterRESET_WAIT: function() {
    debug('Resetting %s', this._dispatcher.clientId);
    this._onEnterDISCONNECTING();
  },

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

    return this.waitForState({
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
      });

  },

  subscribe: function(channel, onMessage, context) {
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

    // Not part of the promise chain yet
    this.waitForState({
        fulfilled: 'CONNECTED',
        rejected: 'UNCONNECTED'
      })
      .then(function() {
        debug('Client %s attempting to subscribe to %s', self._dispatcher
          .clientId, channel);
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
        defer.reject();

        defer.reject(err);
      });

    return subscription;
  },

  unsubscribe: function(channel, callback, context) {
    var self = this;

    var dead = this._channels.unsubscribe(channel, callback, context);
    if (!dead) return; // TODO: return a promise

    this.transitionState('connect', { optional: true });

    return this.waitForState({
        fulfilled: 'CONNECTED',
        rejected: 'UNCONNECTED'
      })
      .then(function() {
        debug('Client %s attempting to unsubscribe from %s', self._dispatcher
          .clientId, channel);

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

  publish: function(channel, data, options) {
    var self = this;

    this.transitionState('connect', { optional: true });

    return this.waitForState({
        fulfilled: 'CONNECTED',
        rejected: 'UNCONNECTED'
      })
      .then(function() {
        debug('Client %s queueing published message to %s: %s', self._dispatcher
          .clientId, channel, data);

        return self._sendMessage({
          channel: channel,
          data: data,
          clientId: self._dispatcher.clientId

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
   * @fires Client#reset
   */
  reset: function() {
    this.trigger('reset');
    this.transitionState('reset', { optional: true });
  },

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
        // .then(function(reply) {
        //   // Also pass the message to any channels
        //   // because replies don't fire the `message` event
        //   self._deliverMessage(reply);
        //   return reply;
        // });
      });

  },

  _generateMessageId: function() {
    this._messageId += 1;
    if (this._messageId >= Math.pow(2, 32)) this._messageId = 0;
    return this._messageId.toString(36);
  },

  _transformIncomingMessage: function(message) {
    var self = this;

    return this._extensions.pipe('incoming', message)
      .then(function(message) {
        if (message && message.advice) self._handleAdvice(message.advice);
        return message;
      });
  },

  /* Event handler for a channel message */
  _receiveMessage: function(message) {
    var self = this;

    this._transformIncomingMessage(message)
      .then(function(message) {
        if (!message) return;
        self._deliverMessage(message);
      })
      .done();
  },

  _handleAdvice: function(advice) {
    extend(this._advice, advice);
    this._dispatcher.timeout = this._advice.timeout; // TODO: switch to ms
    debug('Client advice update: %j', this._advice);
    if (this._advice.reconnect === HANDSHAKE) {
      this.transitionState('rehandshake', { optional: true });
    }
  },

  _deliverMessage: function(message) {
    if (!message.channel || message.data === undefined) return;
    debug('Client %s calling listeners for %s with %j', this._dispatcher.clientId,
      message.channel, message.data);
    this._channels.distributeMessage(message);
  },

  _onEnterCONNECTED: function() {
    this._sendConnect();
  },

  _sendConnect: function() {
    var self = this;

    if (this._connect) {
      debug('Cancelling pending connect request');
      this._connect.cancel();
      this._connect = null;
    }

    this._connect = self._sendMessage({
        channel: Channel.CONNECT,
        clientId: self._dispatcher.clientId,
        connectionType: self._dispatcher.connectionType
      }, {
        // TODO: consider whether to do this or not
        attempts: 1 // Only try once
      })
      .then(function(response) {
        debug('sendMessage returned %j', response);
        self._connect = null;

        if (!response.successful) {
          throw BayeuxError.parse(response.error);
        }
        //   self.transitionState('reconnect', { optional: true });
        //   return response;
        // }
        //
        // throw BayeuxError.parse(response.error);
      })
      .catch(function(err) {
        // debugger;
        debug('Connect failed: %s', err && err.message);
        // self.transitionState('reconnect', { optional: true });
        // throw err;
        // TODO: make sure that advice is uphelp
        // self.transitionState('rehandshake', { optional: true });
      })
      .finally(function() {
        self._connect = null;

        if (!self.stateIs('CONNECTED')) {
          return;
        }

        self._connect = Promise.delay(self._advice.interval)
          .cancellable()
          .then(function() {
            if (!self.stateIs('CONNECTED')) {
              return;
            }
            self._connect = null;
            console.log('RE -issuing connect....')

            /* No need to chain */
            self._sendConnect();
          })
          .catch(function(err) {
            debug('Connect interval delay failure: %s', err);
          });
      });
  },

  _onLeaveCONNECTED: function() {
    if (this._connect) {
      debug('Cancelling pending connect request');
      this._connect.cancel();
      this._connect = null;
    }
  },

  getClientId: function() {
    return this._dispatcher.clientId;
  },

  _onBeforeUnload: function() {
    this.transitionState('disconnect', { optional: true });
  }
};

/* Mixins */
extend(Client.prototype, PublisherMixin);
extend(Client.prototype, StateMachineMixin);

module.exports = Client;
