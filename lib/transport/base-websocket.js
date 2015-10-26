'use strict';

var Transport    = require('./transport');
var uri          = require('../util/uri');
var Promise      = require('bluebird');
var Events       = require('backbone-events-standalone');
var debug        = require('debug-proxy')('faye:websocket');
var inherits     = require('inherits');
var extend       = require('lodash/object/extend');

/* @const */
var WS_CONNECTING  = 0;

/* @const */
var WS_OPEN = 1;

/* @const */
var WS_CLOSING = 2;

/* @const */
var WS_CLOSED  = 3;

var PROTOCOLS = {
  'http:':  'ws:',
  'https:': 'wss:'
};

function getSocketUrl(endpoint) {
  endpoint = extend({ }, endpoint);
  endpoint.protocol = PROTOCOLS[endpoint.protocol];
  return uri.stringify(endpoint);
}

function WebSocketTransport(dispatcher, endpoint) {
  WebSocketTransport.super_.call(this, dispatcher, endpoint);
  this._pending = {};
  this._connectPromise = this._createConnectPromise();
}
inherits(WebSocketTransport, Transport);

extend(WebSocketTransport.prototype, {
  batching:     false,

  // Connects and returns a promise that resolves when the connection is
  // established
  connect: function() {
    return this._connectPromise || Promise.reject(new Error('Socket disconnected'));
  },

  close: function() {
    this._connectPromise = null;
    this._rejectPending();
    this._dispatcher.transportDown(this);

    var socket = this._socket;
    if (socket) {
      debug('Marking underlying websocket as failed');

      this._socket = null;

      var state = socket.readyState;
      socket.onerror = socket.onclose = socket.onmessage = null;

      if(state === WS_OPEN || state === WS_CONNECTING) {
        socket.close();
      }
    }
  },

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
    var pending = this._pending;
    messages.forEach(function(message) {
      pending[message.id] = messages;
    });

    this.connect()
      .then(function() {
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

  /* Abstract _createWebsocket: function(url) { } */

  _createConnectPromise: Promise.method(function() {
    debug('Entered connecting state, creating new WebSocket connection');

    var url = getSocketUrl(this.endpoint);
    var socket = this._socket = this._createWebsocket(url);

    if (!socket) {
      throw new Error('Sockets not supported');
    }

    return this._resolveOnConnect(socket)
      .bind(this)
      .catch(function(e) {
        this.close();
        throw e;
      });
  }),

  _resolveOnConnect: function(socket) {
    var self = this;
    return new Promise(function(resolve, reject) {
      switch (socket.readyState) {
        case WS_OPEN:
          resolve(socket);
          break;

        case WS_CONNECTING:
          break;

        case WS_CLOSING:
        case WS_CLOSED:
          reject(new Error('Socket connection failed'));
          return;
      }

      socket.onopen = function() {
        resolve(socket);
      };

      socket.onmessage = function(e) {
        debug('Received message: %s', e.data);
        self._onmessage(e);
      };

      socket.onerror = function() {
        debug('WebSocket error');
        self.close();
        reject(new Error("Connection failed"));
      };

      socket.onclose = function(e) {
        debug('Websocket closed');
        self.close();
        reject(new Error("Connection failed: code=" + e.code + ": " + e.reason));
      };
    });

  },

  // _onEnterConnected: function() {
  //   debug('WebSocket entering connected state');
  //
  //   this.timeouts.add('ping', this._dispatcher.timeout / 2, this._ping);
  //
  //   globalEvents.on('network', this._onNetworkEvent, this);
  //   globalEvents.on('sleep', this._onNetworkEvent, this);
  // },

  // _onLeaveConnected: function() {
  //   debug('WebSocket leaving connected state');
  //
  //   this._closeSocket();
  //
  //   this.timeouts.remove('ping');
  //   this.timeouts.remove('pingTimeout');
  //
  //   globalEvents.off('network', this._onNetworkEvent, this);
  //   globalEvents.off('sleep', this._onNetworkEvent, this);
  // },

  // _onEnterClosed: function() {
  //   debug('Websocket entering closed state');
  // },

  _rejectPending: function() {
    var pending = this._pending;
    this._pending = {};

    var pendingItems = Object.keys(pending).map(function(key) { return pending[key]; });

    if (pendingItems.length) {
      this._handleError(pendingItems);
    }
  },

  // _onNetworkEvent: function() {
  //   this._ping();
  // },

  _onmessage: function(e) {
    // Don't ignore messages from orphans
    var replies = JSON.parse(e.data);
    if (!replies) return;

    replies = [].concat(replies);

    if (this._outstandingPingResolve) {
      this._outstandingPingResolve();
      this._outstandingPingResolve = null;
    }

    // this.timeouts.remove('pingTimeout');
    // this.timeouts.remove('ping');
    // this.timeouts.add('ping', this._dispatcher.timeout / 2, this._ping);
    var pending = this._pending;
    replies.forEach(function(reply) {
      if (reply.id && reply.successful !== undefined) {
        delete pending[reply.id];
      }
    });

    this._receive(replies);
  },


  // _ping: function() {
  //   this.timeouts.remove('ping');
  //
  //   var socket = this._socket;
  //   if (!socket) return;
  //
  //   // Todo: deal with a timeout situation...
  //   if(socket.readyState !== WS_OPEN) {
  //     this._state.transitionIfPossible('socketClosed');
  //     return;
  //   }
  //
  //   this.timeouts.add('pingTimeout', this._dispatcher.timeout / 4, this._pingTimeout);
  //   socket.send([]);
  // },
  //
  // _pingTimeout: function() {
  //   this._state.transitionIfPossible('pingTimeout');
  // },

  ping: function() {
    var self = this;

    return this.connect()
      .bind(this)
      .then(function() {
        var socket = this._socket;
        if (!socket) throw new Error('No socket');

        // Todo: deal with a timeout situation...
        if(socket.readyState !== WS_OPEN) {
          throw new Error('Socket not open');
        }

        if (!this.outstandingPing) {
          this._outstandingPing = new Promise(function(resolve) {
            self._outstandingPingResolve = resolve;
          });
        }

        socket.send("[]");

        return this._outstandingPing;
      });

  }

});

/* Mixins */
extend(WebSocketTransport.prototype, Events);

/* Statics */
WebSocketTransport.isUsable = function(dispatcher, endpoint, callback) {
  this.create(dispatcher, endpoint).isUsable(callback);
};

module.exports = WebSocketTransport;
