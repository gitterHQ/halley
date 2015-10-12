'use strict';

var Faye             = require('../faye');
var Faye_Transport   = require('./transport');
var Faye_Event       = require('../util/browser/event');
var Faye_URI         = require('../util/uri');
var Promise          = require('bluebird');
var Faye_Deferrable  = require('../mixins/deferrable');
var Faye_Set         = require('../util/set');
var Faye_FSM         = require('../util/fsm');
var websocketFactory = require('./websocket-factory');
var debug            = require('debug-proxy')('faye:websocket');
var classExtend      = require('../util/class-extend');

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

var navigatorConnection = Faye.ENV.navigator && (Faye.ENV.navigator.connection || Faye.ENV.navigator.mozConnection || Faye.ENV.navigator.webkitConnection);

var Faye_Transport_WebSocket = classExtend(Faye_Transport, {
  batching:     false,
  initialize: function(dispatcher, endpoint) {
    debug('Initialising websocket transport');

    this._state = new Faye_FSM(FSM);
    this._state.on('enter:CONNECTING', this._onEnterConnecting.bind(this));
    this._state.on('enter:CONNECTED', this._onEnterConnected.bind(this));
    this._state.on('leave:CONNECTED', this._onLeaveConnected.bind(this));
    this._state.on('enter:CLOSED', this._onEnterClosed.bind(this));

    Faye_Transport.prototype.initialize.call(this, dispatcher, endpoint);

    // Connect immediately
    this._state.transitionIfPossible('connect');
  },

  isUsable: function(callback, context) {
    return this.connect()
      .then(function() {
        callback.call(context, true);
      }, function() {
        callback.call(context, false);
      });
  },

  /* Returns a request */
  request: function(messages) {
    var self = this;
    var aborted = false;

    // Add all messages to the pending queue
    if (!this._pending) this._pending = new Faye_Set();
    for (var i = 0, n = messages.length; i < n; i++) this._pending.add(messages[i]);

    self._connectPromise.then(function() {
      if (aborted) return;

      var socket = self._socket;
      if (!socket) return;

      // Todo: deal with a timeout situation...
      if(socket.readyState !== WS_OPEN) {
        return;
      }

      socket.send(Faye.toJSON(messages));
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
      timeout: this._dispatcher.timeout * 1000 / 2
    });
  },

  _onEnterConnecting: function() {
    if (Faye_Transport_WebSocket._unloaded) {
      this._state.transition('socketClosed', new Error('Sockets unloading'));
        return;
    }

    this._createConnectPromise();
  },

  _createConnectPromise: function() {
    var self = this;
    debug('Entered connecting state, creating new WebSocket connection');

    self._connectPromise = new Promise(function(resolve, reject) {

      var url     = Faye_Transport_WebSocket.getSocketUrl(self.endpoint),
          headers = Faye.copyObject(self._dispatcher.headers),
          options = { headers: headers, ca: self._dispatcher.ca },
          socket;

      options.headers.Cookie = self._getCookies();

      socket = self._socket = websocketFactory(url, options);

      if (!socket) {
        throw new Error('Sockets not supported');
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
          }, self._dispatcher.timeout * 1000 / 4);
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

    }).then(function() {
      self._state.transitionIfPossible('socketConnected');
    }, function(err) {
      self._state.transitionIfPossible('socketClosed');
      throw err;
    });

  },

  // _onEnterAwaitingRetry: function() {
  //   var self = this;
  //   setTimeout(function() {
  //     if(self._state.stateIs('AWAITING_RETRY')) {
  //       self._state.transition('connect');
  //     }
  //   }, this._dispatcher.retry * 1000 || 1000);
  // },

  _onEnterConnected: function() {
    debug('WebSocket entering connected state');

    var self = this;

    this.addTimeout('ping', this._dispatcher.timeout / 2, this._ping, this);
    if(!this._onNetworkEventBound) {
      this._onNetworkEventBound = this._onNetworkEvent.bind(this);
    }

    if (navigatorConnection) {
      navigatorConnection.addEventListener('typechange', this._onNetworkEventBound, false);
    }

    if (Faye.ENV.addEventListener) {
      Faye.ENV.addEventListener('online', this._onNetworkEventBound, false);
      Faye.ENV.addEventListener('offline', this._onNetworkEventBound, false);
    }

    this._sleepDetectionLast = Date.now();
    this._sleepDetectionTimer = setInterval(function() {
      var now = Date.now();
      if(self._sleepDetectionLast - now > 60000) {
        self._onNetworkEvent();
      }
      self._sleepDetectionLast = now;
    }, 30000);
  },

  _onLeaveConnected: function() {
    debug('WebSocket leaving connected state');

    this._closeSocket();

    this.removeTimeout('ping');
    this.removeTimeout('pingTimeout');

    if(navigatorConnection) {
      navigatorConnection.removeEventListener('typechange', this._onNetworkEventBound, false);
    }

    if (Faye.ENV.removeEventListener) {
      Faye.ENV.removeEventListener('online', this._onNetworkEventBound, false);
      Faye.ENV.removeEventListener('offline', this._onNetworkEventBound, false);
    }

    clearTimeout(this._sleepDetectionTimer);

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

    this.removeTimeout('pingTimeout');
    this.removeTimeout('ping');
    this.addTimeout('ping', this._dispatcher.timeout / 2, this._ping, this);

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
    this.removeTimeout('ping');

    var socket = this._socket;
    if (!socket) return;

    // Todo: deal with a timeout situation...
    if(socket.readyState !== WS_OPEN) {
      this._state.transitionIfPossible('socketClosed');
      return;
    }

    this.addTimeout('pingTimeout', this._dispatcher.timeout / 4, this._pingTimeout, this);
    socket.send([]);
  },

  _pingTimeout: function() {
    this._state.transitionIfPossible('pingTimeout');
  }

}, {

  PROTOCOLS: {
    'http:':  'ws:',
    'https:': 'wss:'
  },

  create: function(dispatcher, endpoint) {
    var sockets = dispatcher.transports.websocket;
    if(!sockets) {
      sockets = {};
      dispatcher.transports.websocket = sockets;
    }

    if(sockets[endpoint.href]) {
      return sockets[endpoint.href];
    }

    var socket =  new Faye_Transport_WebSocket(dispatcher, endpoint);
    sockets[endpoint.href] = socket;
    return socket;
  },

  getSocketUrl: function(endpoint) {
    endpoint = Faye.copyObject(endpoint);
    endpoint.protocol = this.PROTOCOLS[endpoint.protocol];
    return Faye_URI.stringify(endpoint);
  },

  isUsable: function(dispatcher, endpoint, callback, context) {
    this.create(dispatcher, endpoint).isUsable(callback, context);
  }

},[
  Faye_Deferrable
]);

Faye_Transport.register('websocket', Faye_Transport_WebSocket);

if (Faye_Event && Faye.ENV.onbeforeunload !== undefined)
  Faye_Event.on(Faye.ENV, 'beforeunload', function() {
    Faye_Transport_WebSocket._unloaded = true;
  });

module.exports = Faye_Transport;
