'use strict';

var Transport    = require('./transport');
var uri          = require('../util/uri');
var Promise      = require('bluebird');
var Set          = require('../util/set');
var StateMachine = require('../util/fsm');
var globalEvents = require('../util/global-events');
var Events       = require('backbone-events-standalone');
var debug        = require('debug-proxy')('faye:websocket');
var inherits     = require('inherits');
var extend       = require('../util/extend');

/* @const */
var WS_CONNECTING  = 0;

/* @const */
var WS_OPEN = 1;

/* @const */
var WS_CLOSING = 2;

/* @const */
var WS_CLOSED  = 3;

var FSM = {
  name: "websocket",
  initial: "NEVER_CONNECTED",
  transitions: {
    NEVER_CONNECTED: {
      connect: "CONNECTING"
    },
    CONNECTING: {
      socketClosed: "CLOSED",
      socketConnected: "CONNECTED",
      close: "CLOSED"
    },
    CONNECTED: {
      pingTimeout: "CLOSED",
      socketClosed: "CLOSED",
      close: "CLOSED"
    },
    CLOSED: {
    },
  }
};

var PROTOCOLS = {
  'http:':  'ws:',
  'https:': 'wss:'
};

function getSocketUrl(endpoint) {
  endpoint = extend({ }, endpoint);
  endpoint.protocol = PROTOCOLS[endpoint.protocol];
  return uri.stringify(endpoint);
}

var _unloaded = false;

function WebSocketTransport(dispatcher, endpoint) {
  debug('Initialising websocket transport');

  this._state = new StateMachine(FSM);

  this.listenTo(this._state, 'enter:CONNECTING', this._onEnterConnecting);
  this.listenTo(this._state, 'enter:CONNECTED', this._onEnterConnected);
  this.listenTo(this._state, 'leave:CONNECTED', this._onLeaveConnected);
  this.listenTo(this._state, 'enter:CLOSED', this._onEnterClosed);

  WebSocketTransport.super_.call(this, dispatcher, endpoint);
  // Connect immediately
  this._state.transitionIfPossible('connect');

}
inherits(WebSocketTransport, Transport);

extend(WebSocketTransport.prototype, {
  batching:     false,

  isUsable: function(callback) {
    return this.connect()
      .then(function() {
        callback(true);
      }, function() {
        callback(false);
      });
  },

  /* Returns a request */
  request: function(messages) {
    var self = this;
    var aborted = false;

    // Add all messages to the pending queue
    if (!this._pending) this._pending = new Set();
    for (var i = 0, n = messages.length; i < n; i++) this._pending.add(messages[i]);

    self._connectPromise.then(function() {
      if (aborted) return;

      var socket = self._socket;
      if (!socket) return;

      // Todo: deal with a timeout situation...
      if(socket.readyState !== WS_OPEN) {
        return;
      }

      socket.send(JSON.stringify(messages));
    });

    /* Returns a request */
    return {
      abort: function() {
        /* If the message has not already been sent, abort the send */
        aborted = true;
      }
    };
  },

  // Connects and returns a promise that resolves when the connection is
  // established
  connect: function() {
    return this._state.waitFor({
      fulfilled: 'CONNECTED',
      rejected: 'CLOSED',
      timeout: this._dispatcher.timeout / 2
    });
  },

  _createWebsocket: function(/*url*/) {
    throw new Error('Abstract');
  },

  _onEnterConnecting: function() {
    var self = this;

    if (_unloaded) {
      this._state.transition('socketClosed', new Error('Sockets unloading'));
      return;
    }

    debug('Entered connecting state, creating new WebSocket connection');

    self._connectPromise = new Promise(function(resolve, reject) {

      var url = getSocketUrl(self.endpoint);
      var socket = self._socket = self._createWebsocket(url);

      if (!socket) {
        return reject(new Error('Sockets not supported'));
      }

      var connectTimeout;
      socket.onopen = function() {
        clearTimeout(connectTimeout);
        resolve();
      };

      switch (socket.readyState) {
        case WS_OPEN:
          resolve();
          break;

        case WS_CONNECTING:
          // Timeout if the connection doesn't become established
          connectTimeout = setTimeout(function() {
            reject(new Error('Timeout on connection'));
          }, self._dispatcher.timeout / 4);
          break;

        case WS_CLOSING:
        case WS_CLOSED:
          reject(new Error('Socket connection failed'));
          return;
      }

      socket.onmessage = function(e) {
        debug('Received message: %s', e.data);
        self._onmessage(e);
      };

      socket.onerror = function() {
        debug('WebSocket error');
        socket.onclose = socket.onerror = socket.onmessage = null;

        reject(new Error("Connection failed"));
        self._state.transitionIfPossible('socketClosed');
      };

      socket.onclose = function() {
        debug('Websocket closed');
        socket.onclose = socket.onerror = socket.onmessage = null;

        reject(new Error("Connection failed"));
        self._state.transitionIfPossible('socketClosed');
      };

    });

    // Don't chain
    self._connectPromise.then(function() {
      self._state.transitionIfPossible('socketConnected');
    }, function(/*err*/) {
      self._state.transitionIfPossible('socketClosed');
    });

  },

  _onEnterConnected: function() {
    debug('WebSocket entering connected state');

    this.timeouts.add('ping', this._dispatcher.timeout / 2, this._ping);

    globalEvents.on('network', this._onNetworkEvent, this);
    globalEvents.on('sleep', this._onNetworkEvent, this);
  },

  _onLeaveConnected: function() {
    debug('WebSocket leaving connected state');

    this._closeSocket();

    this.timeouts.remove('ping');
    this.timeouts.remove('pingTimeout');

    globalEvents.off('network', this._onNetworkEvent, this);
    globalEvents.off('sleep', this._onNetworkEvent, this);

    this._rejectPending();
  },

  _onEnterClosed: function() {
    debug('Websocket entering closed state');
    var dispatcher = this._dispatcher;
    var endpoint = this.endpoint;

    var sockets = dispatcher.transports.websocket;
    if (sockets) {
      delete sockets[endpoint.href];
    }

    dispatcher.transportDown(this);
  },

  close: function() {
    this._state.transitionIfPossible('close');
  },

  _rejectPending: function() {
    var pending = this._pending ? this._pending.toArray() : null;
    delete this._pending;

    if (pending && pending.length) {
      this._handleError(pending);
    }
  },

  _onNetworkEvent: function() {
    this._ping();
  },

  _onmessage: function(e) {
    // Don't ignore messages from orphans
    var replies = JSON.parse(e.data);
    if (!replies) return;

    replies = [].concat(replies);

    this.timeouts.remove('pingTimeout');
    this.timeouts.remove('ping');
    this.timeouts.add('ping', this._dispatcher.timeout / 2, this._ping);

    if(this._pending) {
      for (var i = 0, n = replies.length; i < n; i++) {
        if (replies[i].successful !== undefined) {
          this._pending.remove(replies[i]);
        }
      }
    }

    this._receive(replies);
  },

  _closeSocket: function() {
    if(!this._socket) return;

    debug('Marking underlying websocket as failed');

    var socket = this._socket;
    this._socket = null;

    var state = socket.readyState;
    socket.onerror = socket.onclose = socket.onmessage = null;

    if(state === WS_OPEN || state === WS_CONNECTING) {
      socket.close();
    }
  },

  _ping: function() {
    this.timeouts.remove('ping');

    var socket = this._socket;
    if (!socket) return;

    // Todo: deal with a timeout situation...
    if(socket.readyState !== WS_OPEN) {
      this._state.transitionIfPossible('socketClosed');
      return;
    }

    this.timeouts.add('pingTimeout', this._dispatcher.timeout / 4, this._pingTimeout);
    socket.send([]);
  },

  _pingTimeout: function() {
    this._state.transitionIfPossible('pingTimeout');
  }

});

/* Mixins */
extend(WebSocketTransport.prototype, Events);

/* Statics */
WebSocketTransport.create = function(dispatcher, endpoint) {
  var sockets = dispatcher.transports.websocket;
  if(!sockets) {
    sockets = {};
    dispatcher.transports.websocket = sockets;
  }

  if(sockets[endpoint.href]) {
    return sockets[endpoint.href];
  }

  var socket =  new this(dispatcher, endpoint);
  sockets[endpoint.href] = socket;
  return socket;
};

WebSocketTransport.isUsable = function(dispatcher, endpoint, callback) {
  this.create(dispatcher, endpoint).isUsable(callback);
};

globalEvents.on('beforeunload', function() {
  _unloaded = true;
});

module.exports = WebSocketTransport;
