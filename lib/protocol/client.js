'use strict';

var Extensions     = require('./extensions');
var PublisherMixin = require('../mixins/publisher');
var BayeuxError    = require('../error');
var Channel        = require('./channel');
var ChannelSet     = require('./channel-set');
var Dispatcher     = require('./dispatcher');
var Subscription   = require('./subscription');
var Promise        = require('bluebird');
var debug          = require('debug-proxy')('faye:client');
var StateMachine   = require('../util/fsm');
var extend         = require('lodash/object/extend');

var MANDATORY_CONNECTION_TYPES = ['long-polling', 'callback-polling', 'in-process'];
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
    UNCONNECTED: {
      connect: "HANDSHAKING",
      reset: "RECONNECTING"
    },
    HANDSHAKING: {
      handshakeSuccess: "CONNECTED",
      rehandshake: "RECONNECTING",
      disconnect: "UNCONNECTED"
    },
    // Handshake failed, try again after interval
    RECONNECTING: {
      interval: "HANDSHAKING",
      disconnect: "UNCONNECTED"
    },
    CONNECTED: {
      disconnect: "DISCONNECTING",
      rehandshake: "RECONNECTING",
      reset: "RESETTING",
      reconnect: "AWAITING_RECONNECT",
      transportDown: "RESELECT_TRANSPORT"
    },
    // Period during the interval between connect requests
    // Sometimes this is almost immediate
    AWAITING_RECONNECT: {
      disconnect: "DISCONNECTING",
      rehandshake: "RECONNECTING",
      reset: "RESETTING",
      reconnect: "CONNECTED"
    },
    RESELECT_TRANSPORT: {
      rehandshake: "RECONNECTING",
      transportReselected: "AWAITING_RECONNECT",
      reset: "RESETTING"
    },
    RESETTING: {
      disconnectSuccess: "HANDSHAKING",
      disconnectFailure: "HANDSHAKING",
      reset: "HANDSHAKING"
    },
    DISCONNECTING: {
      disconnectSuccess: "UNCONNECTED",
      disconnectFailure: "UNCONNECTED",
      reset: "RECONNECTING"
    }
  }
};

/**
 * The Faye Client
 * @fires Client#handshake
 * @fires Client#reset
 */
function Client(endpoint, options) {
  debug('New client created for %s', endpoint);
  if (!options) options = {};

  this._extensions = new Extensions();
  this._endpoint   = endpoint || DEFAULT_ENDPOINT;
  this._channels   = new ChannelSet();
  this._dispatcher = new Dispatcher(this, this._endpoint, options);

  this._messageId = 0;

  this._state = new StateMachine(FSM, this);

  this.listenTo(this._state, 'enter:HANDSHAKING'       , this._onEnterHandshaking);
  this.listenTo(this._state, 'enter:DISCONNECTING'     , this._onEnterDisconnecting);
  this.listenTo(this._state, 'enter:UNCONNECTED'       , this._onEnterUnconnected);
  this.listenTo(this._state, 'enter:RECONNECTING'      , this._onEnterReconnecting);
  this.listenTo(this._state, 'enter:CONNECTED'         , this._onEnterConnected);
  this.listenTo(this._state, 'enter:RESETTING'         , this._onEnterDisconnecting);
  this.listenTo(this._state, 'enter:RESELECT_TRANSPORT', this._onReselectTransport);
  this.listenTo(this._state, 'enter:AWAITING_RECONNECT', this._onEnterAwaitingReconnect);
  this.listenTo(this._state, 'leave:AWAITING_RECONNECT', this._onLeaveAwaitingReconnect);

  // TODO: change advice values to ms
  this._advice = {
    reconnect: RETRY,
    interval:  1000 * (options.interval || INTERVAL),
    timeout:   1000 * (options.timeout  || CONNECTION_TIMEOUT)
  };
  this._dispatcher.timeout = this._advice.timeout;

  this.listenTo(this._dispatcher, 'message', this._receiveMessage);

  // TODO: sort this out
  this.listenTo(this._dispatcher, 'transportDown', this._transportDown);
}

Client.prototype = {
  // addWebsocketExtension: function(extension) {
  //   return this._dispatcher.addWebsocketExtension(extension);
  // },

  // disable: function(feature) {
  //   return this._dispatcher.disable(feature);
  // },

  addExtension: function(extension) {
    this._extensions.add(extension);
  },

  removeExtension: function(extension) {
    this._extensions.remove(extension);
  },

  /**
   * @fires Client#handshake
   */
  _onEnterHandshaking: function() {
    var self = this;
    this.trigger('handshake', this);

    debug('Initiating handshake with %j', this._endpoint);
    return this._dispatcher.selectTransport(MANDATORY_CONNECTION_TYPES)
      .bind(this)
      .then(function() {
        return this._sendMessage({
            channel:                  Channel.HANDSHAKE,
            version:                  BAYEUX_VERSION,
            supportedConnectionTypes: this._dispatcher.getConnectionTypes()
          }, {});
      })
      .then(function(response) {
        if(!self._state.stateIs('HANDSHAKING')) {
          return;
        }

        if (!response.successful) {
          throw BayeuxError.parse(response.error);
        }

        self._dispatcher.clientId  = response.clientId;
        var supportedConnectionTypes = self._supportedTypes = response.supportedConnectionTypes;
        debug('Handshake successful: %s', self._dispatcher.clientId);

        return self._dispatcher.selectTransport(supportedConnectionTypes)
          .then(function() {
            debug('Post handshake reselect transport');
            self._resubscribeAll();
            self._state.transition('handshakeSuccess');
          });

      })
      .catch(function(err) {
        debug('Handshake failed: %s', err, err.stack);
        // TODO: make sure that advice is uphelp
        self._state.transitionIfPossible('rehandshake');
      });
  },

  _onEnterReconnecting: function() {
    var self = this;

    self._handshakeTimer = setTimeout(function() {
      self._state.transitionIfPossible('interval');
    }, this._advice.interval);
  },

  _onLeaveReconnecting: function() {
    clearTimeout(this._handshakeTimer);
    this._handshakeTimer = null;
  },

  connect: function() {
    var self = this;

    return this._state.waitFor({
      fulfilled: 'CONNECTED',
      rejected: 'UNCONNECTED'
    })
    .then(function() {
      return self._sendMessage({
        channel:        Channel.CONNECT,
        clientId:       self._dispatcher.clientId,
        connectionType: self._dispatcher.connectionType
      }, {
        // TODO: consider whether to do this or not
        attempts: 1 // Only try once
      });
    })
    .then(function(response) {
      debug('sendMessage returned %j', response);

      if (response.successful) {
        self._state.transitionIfPossible('reconnect');
        return response;
      }

      throw BayeuxError.parse(response.error);
    })
    .catch(function(err) {
      debug('Connect failed: %s', err && err.message);
      // TODO: make sure that advice is uphelp
      self._state.transitionIfPossible('rehandshake');
    });
  },

  _onEnterAwaitingReconnect: function() {
    var self = this;
    this._intervalTimer = setTimeout(function() {
      self._state.transitionIfPossible('reconnect');
    }, self._advice.interval);
  },

  _onLeaveAwaitingReconnect: function() {
    clearTimeout(this._intervalTimer);
    this._intervalTimer = null;
  },

  disconnect: function() {
    this._state.transitionIfPossible('disconnect');

    return this._state.waitFor({
      fulfilled: 'UNCONNECTED',
      rejected: 'CONNECTED'
    });
  },

  _onEnterDisconnecting: function() {
    debug('Disconnecting %s', this._dispatcher.clientId);
    var self = this;
    return this._sendMessage({
        channel:  Channel.DISCONNECT,
        clientId: this._dispatcher.clientId
      }, { attempts: 1 })
      .then(function(response) {
        // TODO: add timeout
        debug('Disconnect returned  %j', response);

        if (response.successful) {
          self._state.transitionIfPossible('disconnectSuccess');
        } else {
          self._state.transitionIfPossible('disconnectFailure');
        }
      });
  },

  _transportDown: function() {
    this._state.transitionIfPossible('transportDown');
  },

  _onReselectTransport: function() {
    var self = this;
    var types = this._supportedTypes || MANDATORY_CONNECTION_TYPES;
    this._dispatcher.selectTransport(types, function(transport) {
        debug('Transport reselected %s', transport.connectionType);
        self._state.transitionIfPossible('transportReselected');
      });

  },

  _onEnterUnconnected: function() {
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

    this._state.transitionIfPossible('connect');

    return this._state.waitFor({
        fulfilled: 'CONNECTED',
        rejected: 'UNCONNECTED'
      })
      .then(function() {
        return Promise.all(channels.map(function(channel) {
          debug('Client %s attempting to resubscribe to %s', self._dispatcher.clientId, channel);

          return self._sendMessage({
            channel:      Channel.SUBSCRIBE,
            clientId:     self._dispatcher.clientId,
            subscription: channel

          }, {})
          .then(function(response) {
            if (!response.successful) {
              // TODO: better error-handling of this situation
              // We should warn the client that we have been unable to resubscribe
              // to the channel
              debug('Subscription rejected for %s to %s', self._dispatcher.clientId, response.subscription);
            }
          });
        }));
      });

  },

  subscribe: function(channel, onMessage, context) {
    var self = this;

    var deferredSub   = Subscription.createDeferred(this, channel, onMessage, context);
    var defer         = deferredSub.defer;
    var subscription  = deferredSub.subscription;

    var hasSubscribe = this._channels.hasSubscription(channel);

    // If the client is resubscribing to an existing channel
    // there is no need to re-issue to message to the server
    if (hasSubscribe) {
      this._channels.subscribe(channel, onMessage, context);
      defer.resolve(subscription);
      return subscription;
    }

    this._state.transitionIfPossible('connect');

    // Not part of the promise chain yet
    this._state.waitFor({
        fulfilled: 'CONNECTED',
        rejected: 'UNCONNECTED'
      })
      .then(function() {
        debug('Client %s attempting to subscribe to %s', self._dispatcher.clientId, channel);
        self._channels.subscribe(channel, onMessage, context);

        return self._sendMessage({
          channel:      Channel.SUBSCRIBE,
          clientId:     self._dispatcher.clientId,
          subscription: channel

        }, {});
      })
      .then(function(response) {
        if (!response.successful) {
          debug('Subscription rejected for %s to %s', self._dispatcher.clientId, response.subscription);
          defer.reject(BayeuxError.parse(response.error));
          return;
        }

        debug('Subscription acknowledged for %s to %s', self._dispatcher.clientId, response.subscription);

        // Note that it may be tempting to return the subscription in the promise
        // but this causes problems since subscription is a `thenable`
        defer.resolve();
      });

    return subscription;
  },

  unsubscribe: function(channel, callback, context) {
    var self = this;

    var dead = this._channels.unsubscribe(channel, callback, context);
    if (!dead) return; // TODO: return a promise

    this._state.transitionIfPossible('connect');

    return this._state.waitFor({
        fulfilled: 'CONNECTED',
        rejected: 'UNCONNECTED'
      })
      .then(function() {
        debug('Client %s attempting to unsubscribe from %s', self._dispatcher.clientId, channel);

        return self._sendMessage({
          channel:      Channel.UNSUBSCRIBE,
          clientId:     self._dispatcher.clientId,
          subscription: channel

        }, {});
      })
      .then(function(response) {
        if (!response.successful) throw BayeuxError.parse(response.error);

        debug('Unsubscription acknowledged for %s from %s', self._dispatcher.clientId, response.subscription);
      });
  },

  publish: function(channel, data, options) {
    var self = this;

    this._state.transitionIfPossible('connect');

    return this._state.waitFor({
        fulfilled: 'CONNECTED',
        rejected: 'UNCONNECTED'
      })
      .then(function() {
        debug('Client %s queueing published message to %s: %s', self._dispatcher.clientId, channel, data);

        return self._sendMessage({
          channel:  channel,
          data:     data,
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
    this.trigger('reset', this);
    this._state.transitionIfPossible('reset');
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
    if (this._messageId >= Math.pow(2,32)) this._messageId = 0;
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

    if (this._advice.reconnect === HANDSHAKE) {
      this._state.transitionIfPossible('rehandshake');
    }
  },

  _deliverMessage: function(message) {
    if (!message.channel || message.data === undefined) return;
    debug('Client %s calling listeners for %s with %j', this._dispatcher.clientId, message.channel, message.data);
    this._channels.distributeMessage(message);
  },

  _onEnterConnected: function() {
    this.connect();
  },

  getClientId: function() {
    return this._dispatcher.clientId;
  }
};

/* Mixins */
extend(Client.prototype, PublisherMixin);

module.exports = Client;
