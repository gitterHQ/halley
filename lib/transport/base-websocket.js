'use strict';

var Transport    = require('./transport');
var uri          = require('../util/uri');
var Promise      = require('bluebird');
var Events       = require('../util/externals').Events;
var debug        = require('debug')('halley:websocket');
var inherits     = require('inherits');
var extend        = require('../util/externals').extend;
var globalEvents = require('../util/global-events');

var MAX_PING_INTERVAL = 50000; // 50 seconds
var MAX_PING_RESPONSE_INTERVAL = 15000; // 15 seconds
var WS_CONNECTING  = 0;
var WS_OPEN = 1;
var WS_CLOSING = 2;
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

  this._pingTimer      = null;
  this._connectPromise = this._createConnectPromise();
}
inherits(WebSocketTransport, Transport);

extend(WebSocketTransport.prototype, {
  /* Abstract _createWebsocket: function(url) { } */

  /**
   * Connects and returns a promise that resolves when the connection is
   * established
   */
  connect: function() {
    return this._connectPromise || Promise.reject(new Error('Socket disconnected'));
  },

  close: function() {
    /* Only perform close once */
    if (!this._connectPromise) return;

    this._connectPromise = null;
    this._dispatcher.transportDown(this);

    clearTimeout(this._pingTimer);

    globalEvents.off('network', this._pingNow, this);
    globalEvents.off('sleep', this._pingNow, this);

    var socket = this._socket;
    if (socket) {
      debug('Closing websocket');

      this._socket = null;

      var state = socket.readyState;
      socket.onerror = socket.onclose = socket.onmessage = null;

      if(state === WS_OPEN || state === WS_CONNECTING) {
        socket.close();
      }
    }
  },

  /* Returns a request */
  request: function(messages) {
    return this.connect()
      .bind(this)
      .then(function() {
        var socket = this._socket;
        if (!socket || socket.readyState !== WS_OPEN) {
          throw new Error('Websocket unavailable');
        }

        socket.send(JSON.stringify(messages));
      });
  },

  /**
   * Returns a promise of a connected socket
   */
  _createConnectPromise: Promise.method(function() {
    debug('Entered connecting state, creating new WebSocket connection');

    var url = getSocketUrl(this.endpoint);
    var socket = this._socket = this._createWebsocket(url);

    if (!socket) {
      throw new Error('Sockets not supported');
    }

    return this._resolveOnConnect(socket)
      .bind(this)
      .then(function(socket) {

        // Connect success, setup listeners
        this._pingTimer = setTimeout(this._pingInterval.bind(this), this._getPingInterval());

        globalEvents.on('network', this._pingNow, this);
        globalEvents.on('sleep', this._pingNow, this);
        return socket;
      })
      .catch(function(e) {
        this.close();
        throw e;
      });
  }),


  /**
   * Resolves once the socket has established a connection to the server
   * @return {Promise} Promise with the connected socket
   */
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

  _onmessage: function(e) {
    var replies = JSON.parse(e.data);
    if (!replies) return;

    this.trigger('message');

    replies = [].concat(replies);

    this._receive(replies);
  },

  _getPingInterval: function() {
    // If the interval exceeds a minute theres a good chance an ELB or
    // intermediate proxy will shut the connection down, so we set
    // the interval to 50 seconds max
    return Math.min(this._dispatcher.timeout / 2, MAX_PING_INTERVAL);
  },

  _getPingTimeout: function() {
    // Put an upper limit on the ping response time so that
    // we can take action and try recreate the transport
    return Math.min(this._dispatcher.timeout / 4, MAX_PING_RESPONSE_INTERVAL);
  },

  _ping: function() {
    debug('ping');

    return this.connect()
      .bind(this)
      .then(function(socket) {
        // Todo: deal with a timeout situation...
        if(socket.readyState !== WS_OPEN) {
          throw new Error('Socket not open');
        }

        var self = this;
        var resolveFn;
        return new Promise(function(resolve) {
            resolveFn = resolve;
            self.once('message', resolveFn);
            socket.send("[]");
          })
          .timeout(this._getPingTimeout(), 'Ping timeout')
          .finally(function() {
            self.off('message', resolveFn);
          });
      });
  },

  /**
   * If we have reason to believe that the connection may be flaky, for
   * example, the computer has been asleep for a while, we send a ping
   * immediately (don't batch with other ping replies)
   */
  _pingNow: function() {
    this._ping()
      .bind(this)
      .catch(function(e) {
        debug('Ping failure: closing socket: %s', e);
        this.close();
      });
  },

  _pingInterval: function() {
    this._ping()
      .bind(this)
      .then(function() {
        this._pingTimer = setTimeout(this._pingInterval.bind(this), this._getPingInterval());
      })
      .catch(function(e) {
        debug('Ping failure: closing socket: %s', e);
        this.close();
      });
    }
});

/* Mixins */
extend(WebSocketTransport.prototype, Events);

module.exports = WebSocketTransport;
