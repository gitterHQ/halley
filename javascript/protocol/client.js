'use strict';

var Faye              = require('../faye');
var Faye_Extensions   = require('./extensions');
var Faye_Publisher    = require('../mixins/publisher');
var Faye_Error        = require('../error');
var Faye_Channel      = require('./channel');
var Faye_Channel_Set  = require('./channel-set');
var Faye_Dispatcher   = require('./dispatcher');
var Faye_Event        = require('../util/browser/event');
var Faye_Subscription = require('./subscription');
var Faye_URI          = require('../util/uri');
var Promise           = require('bluebird');
var extend            = require('../util/extend');
var debug             = require('debug-proxy')('faye:client');
var Faye_FSM          = require('../util/fsm');
var extend            = require('../util/extend');

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
      handshake: "CONNECTED",
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

function Faye_Client(endpoint, options) {
  debug('New client created for %s', endpoint);
  options = options || {};

  Faye.validateOptions(options, ['interval', 'timeout', 'endpoints', 'proxy', 'retry', 'scheduler', 'websocketExtensions', 'tls', 'ca']);

  this._extensions = new Faye_Extensions();
  this._endpoint   = endpoint || this.DEFAULT_ENDPOINT;
  this._channels   = new Faye_Channel_Set();
  this._dispatcher = new Faye_Dispatcher(this, this._endpoint, options);

  this._messageId = 0;

  this._state = new Faye_FSM(FSM);
  this._state.on('enter:HANDSHAKING', this._onEnterHandshaking.bind(this));
  this._state.on('enter:DISCONNECTING', this._onEnterDisconnecting.bind(this));
  this._state.on('enter:UNCONNECTED', this._onEnterUnconnected.bind(this));
  this._state.on('enter:RECONNECTING', this._onEnterReconnecting.bind(this));
  this._state.on('enter:CONNECTED', this._onEnterConnected.bind(this));

  this._state.on('enter:RESETTING', this._onEnterDisconnecting.bind(this));
  this._state.on('enter:RESELECT_TRANSPORT', this._onReselectTransport.bind(this));
  this._state.on('enter:AWAITING_RECONNECT', this._onEnterAwaitingReconnect.bind(this));
  this._state.on('leave:AWAITING_RECONNECT', this._onLeaveAwaitingReconnect.bind(this));

  this._responseCallbacks = {};

  this._advice = {
    reconnect: this.RETRY,
    interval:  1000 * (options.interval || this.INTERVAL),
    timeout:   1000 * (options.timeout  || this.CONNECTION_TIMEOUT)
  };
  this._dispatcher.timeout = this._advice.timeout / 1000;

  this._dispatcher.bind('message', this._receiveMessage, this);
  this._dispatcher.bind('transportDown', this._transportDown, this);

  if (Faye_Event && Faye.ENV.onbeforeunload !== undefined)
    Faye_Event.on(Faye.ENV, 'beforeunload', function() {
      if (Faye.indexOf(this._dispatcher._disabled, 'autodisconnect') < 0)
        this.disconnect();
    }, this);
}


Faye_Client.prototype = {
  UNCONNECTED:        1,
  CONNECTING:         2,
  CONNECTED:          3,
  DISCONNECTED:       4,

  HANDSHAKE:          'handshake',
  RETRY:              'retry',
  NONE:               'none',

  CONNECTION_TIMEOUT: 60,

  DEFAULT_ENDPOINT:   '/bayeux',
  INTERVAL:           0,

  addWebsocketExtension: function(extension) {
    return this._dispatcher.addWebsocketExtension(extension);
  },

  disable: function(feature) {
    return this._dispatcher.disable(feature);
  },

  setHeader: function(name, value) {
    return this._dispatcher.setHeader(name, value);
  },

  addExtension: function(extension) {
    this._extensions.add(extension);
  },

  removeExtension: function(extension) {
    this._extensions.remove(extension);
  },

  // Request
  // MUST include:  * channel
  //                * version
  //                * supportedConnectionTypes
  // MAY include:   * minimumVersion
  //                * ext
  //                * id
  //
  // Success Response                             Failed Response
  // MUST include:  * channel                     MUST include:  * channel
  //                * version                                    * successful
  //                * supportedConnectionTypes                   * error
  //                * clientId                    MAY include:   * supportedConnectionTypes
  //                * successful                                 * advice
  // MAY include:   * minimumVersion                             * version
  //                * advice                                     * minimumVersion
  //                * ext                                        * ext
  //                * id                                         * id
  //                * authSuccessful
  _onEnterHandshaking: function() {
    var self = this;

    debug('Initiating handshake with %s', Faye_URI.stringify(this._endpoint));
    this._dispatcher.selectTransport(Faye.MANDATORY_CONNECTION_TYPES);

    return this._sendMessage({
        channel:                  Faye_Channel.HANDSHAKE,
        version:                  Faye.BAYEUX_VERSION,
        supportedConnectionTypes: this._dispatcher.getConnectionTypes()

      }, {})
      .then(function(response) {
        if(!self._state.stateIs('HANDSHAKING')) {
          return;
        }

        if (!response.successful) {
          throw Faye_Error.parse(response.error);
        }

        self._dispatcher.clientId  = response.clientId;
        var supportedConnectionTypes = self._supportedTypes = response.supportedConnectionTypes;
        debug('Handshake successful: %s', self._dispatcher.clientId);

        self._dispatcher.selectTransport(supportedConnectionTypes, function() {
          debug('Post handshake reselect transport');
          self._resubscribeAll();
          self._state.transition('handshake');
        });
      })
      .then(null, function(err) {
        debug('Handshake failed: %s', err.message);
        // TODO: make sure that advice is uphelp
        self._state.transitionIfPossible('rehandshake');
      });
  },

  _onEnterReconnecting: function() {
    var self = this;

    self._handshakeTimer = Faye.ENV.setTimeout(function() {
      self._state.transitionIfPossible('interval');
    }, this._advice.interval);
  },

  _onLeaveReconnecting: function() {
    Faye.ENV.clearTimeout(this._handshakeTimer);
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
        channel:        Faye_Channel.CONNECT,
        clientId:       self._dispatcher.clientId,
        connectionType: self._dispatcher.connectionType
      }, {
        // TODO: consider whether to do this or not
        // attempts: 1 // Only try once
      });
    })
    .then(function(response) {
      debug('sendMessage returned %j', response);

      if (response.successful) {
        self._state.transitionIfPossible('reconnect');
        return response;
      }

      throw Faye_Error.parse(response.error);
    })
    .then(null, function(err) {
      debug('Connect failed: %s', err.message);
      // TODO: make sure that advice is uphelp
      self._state.transitionIfPossible('rehandshake');
    });
  },

  _onEnterAwaitingReconnect: function() {
    var self = this;
    this._intervalTimer = Faye.ENV.setTimeout(function() {
      self._state.transitionIfPossible('reconnect');
    }, self._advice.interval);
  },

  _onLeaveAwaitingReconnect: function() {
    Faye.ENV.clearTimeout(this._intervalTimer);
    this._intervalTimer = null;
  },


  // Request                              Response
  // MUST include:  * channel             MUST include:  * channel
  //                * clientId                           * successful
  //                * connectionType                     * clientId
  // MAY include:   * ext                 MAY include:   * error
  //                * id                                 * advice
  //                                                     * ext
  //                                                     * id
  //                                                     * timestamp
  // connect: function(callback, context) {
  //   if (this._advice.reconnect === this.NONE) return;
  //   if (this._state === this.DISCONNECTED) return;
  //
  //   if (this._state === this.UNCONNECTED)
  //     return this.handshake(function() { this.connect(callback, context) }, this);
  //
  //   this.callback(callback, context);
  //   if (this._state !== this.CONNECTED) return;
  //
  //   debug('Calling deferred actions for %s', this._dispatcher.clientId);
  //   this.setDeferredStatus('succeeded');
  //   this.setDeferredStatus('unknown');
  //
  //   if (this._connectRequest) return;
  //   this._connectRequest = true;
  //
  //   debug('Initiating connection for %s', this._dispatcher.clientId);
  //
  //   this._sendMessage({
  //     channel:        Faye_Channel.CONNECT,
  //     clientId:       this._dispatcher.clientId,
  //     connectionType: this._dispatcher.connectionType
  //
  //   }, {}, this._cycleConnection, this);
  // },

  // Request                              Response
  // MUST include:  * channel             MUST include:  * channel
  //                * clientId                           * successful
  // MAY include:   * ext                                * clientId
  //                * id                  MAY include:   * error
  //                                                     * ext
  //                                                     * id
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
        channel:  Faye_Channel.DISCONNECT,
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
    var types = this._supportedTypes || Faye.MANDATORY_CONNECTION_TYPES;
    this._dispatcher.selectTransport(types, function(transport) {
        debug('Transport reselected %s', transport.connectionType);
        self._state.transitionIfPossible('transportReselected');
      });

  },

  _onEnterUnconnected: function() {
    this._dispatcher.clientId = null;
    this._dispatcher.close();
    debug('Clearing channel listeners for %s', this._dispatcher.clientId);
    this._channels = new Faye_Channel_Set();
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
            channel:      Faye_Channel.SUBSCRIBE,
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

  // Request                              Response
  // MUST include:  * channel             MUST include:  * channel
  //                * clientId                           * successful
  //                * subscription                       * clientId
  // MAY include:   * ext                                * subscription
  //                * id                  MAY include:   * error
  //                                                     * advice
  //                                                     * ext
  //                                                     * id
  //                                                     * timestamp
  subscribe: function(channel, callback, context) {
    var self = this;

    var deferredSub   = Faye_Subscription.createDeferred(this, channel, callback, context);
    var defer         = deferredSub.defer;
    var subscription  = deferredSub.subscription;

    var hasSubscribe = this._channels.hasSubscription(channel);

    // If the client is resubscribing to an existing channel
    // there is no need to re-issue to message to the server
    if (hasSubscribe) {
      this._channels.subscribe(channel, callback, context);
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
        self._channels.subscribe(channel, callback, context);

        return self._sendMessage({
          channel:      Faye_Channel.SUBSCRIBE,
          clientId:     self._dispatcher.clientId,
          subscription: channel

        }, {});
      })
      .then(function(response) {
        if (!response.successful) {
          debug('Subscription rejected for %s to %s', self._dispatcher.clientId, response.subscription);
          defer.reject(Faye_Error.parse(response.error));
          return;
        }

        debug('Subscription acknowledged for %s to %s', self._dispatcher.clientId, response.subscription);
        
        // Note that it may be tempting to return the subscription in the promise
        // but this causes problems since subscription is a `thenable`
        defer.resolve();
      });

    return subscription;
  },

  // Request                              Response
  // MUST include:  * channel             MUST include:  * channel
  //                * clientId                           * successful
  //                * subscription                       * clientId
  // MAY include:   * ext                                * subscription
  //                * id                  MAY include:   * error
  //                                                     * advice
  //                                                     * ext
  //                                                     * id
  //                                                     * timestamp
  unsubscribe: function(channel, callback, context) {
    var self = this;

    if (channel instanceof Array) {
      return Faye.map(channel, function(c) {
        return self.unsubscribe(c, callback, context);
      });
    }

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
          channel:      Faye_Channel.UNSUBSCRIBE,
          clientId:     self._dispatcher.clientId,
          subscription: channel

        }, {});
      })
      .then(function(response) {
        if (!response.successful) throw Faye_Error.parse(response.error);

        debug('Unsubscription acknowledged for %s from %s', self._dispatcher.clientId, response.subscription);
      });
  },

  // Request                              Response
  // MUST include:  * channel             MUST include:  * channel
  //                * data                               * successful
  // MAY include:   * clientId            MAY include:   * id
  //                * id                                 * error
  //                * ext                                * ext
  publish: function(channel, data, options) {
    var self = this;

    Faye.validateOptions(options || {}, ['attempts', 'deadline']);

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
        throw Faye_Error.parse(response.error);
      }

      return response;
    });
  },

  reset: function() {
    this._state.transitionIfPossible('reset');
  },

  _sendMessage: function(message, options) {
    debug('sendMessage: %j, options: %j', message, options);
    var self = this;

    message.id = this._generateMessageId();

    var timeout = this._advice.timeout ? 1.2 * this._advice.timeout / 1000 : 1.2 * this._dispatcher.retry;

    return new Promise(function(fulfill/*, reject*/) {
      self._extensions.pipe('outgoing', message, function(message) {
        if (!message) return;
        self._responseCallbacks[message.id] = [fulfill, null];
        self._dispatcher.sendMessage(message, timeout, options || {});
      });
    });
  },

  _generateMessageId: function() {
    this._messageId += 1;
    if (this._messageId >= Math.pow(2,32)) this._messageId = 0;
    return this._messageId.toString(36);
  },

  _receiveMessage: function(message) {
    var id = message.id, callback;

    if (message.successful !== undefined) {
      callback = this._responseCallbacks[id];
      delete this._responseCallbacks[id];
    }
    var self = this;
    this._extensions.pipe('incoming', message, function(message) {
      if (!message) return;
      if (message.advice) self._handleAdvice(message.advice);
      self._deliverMessage(message);

      if (callback) callback[0].call(callback[1], message);
    });
  },

  _handleAdvice: function(advice) {
    extend(this._advice, advice);
    this._dispatcher.timeout = this._advice.timeout / 1000;

    if (this._advice.reconnect === this.HANDSHAKE) {
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
};

/* Mixins */
extend(Faye_Client.prototype, Faye_Publisher);

module.exports = Faye_Client;
