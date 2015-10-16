'use strict';

var Faye_Transport     = require('../transport');
var Faye_URI           = require('../../util/uri');
var Promise            = require('bluebird');
var Faye_Transport_XHR = require('./xhr');
var inherits           = require('inherits');
var extend             = require('../../util/extend');

var WindowEventSource = window.EventSource;
var EVENTSOURCE_OPEN = 1;

function Faye_Transport_EventSource(dispatcher, endpoint) {
  Faye_Transport_EventSource.super_.call(this, dispatcher, endpoint);
  var self = this;

  this._connectPromise = new Promise(function(resolve, reject) {
    if (!WindowEventSource) return reject(new Error('EventSource not supported'));

    self._xhr = new Faye_Transport_XHR(dispatcher, endpoint);

    var eventSourceEndpoint = extend({ }, endpoint); // Copy endpoint
    eventSourceEndpoint.pathname += '/' + dispatcher.clientId;

    var socket = new WindowEventSource(Faye_URI.stringify(eventSourceEndpoint));

    socket.onopen = function() {
      self._everConnected = true;
      resolve(socket);
    };

    socket.onerror = function() {
      if (self._everConnected) {
        self._handleError([]);
      }

      if (socket.readyState === EVENTSOURCE_OPEN) {
        socket.close();
      }

      reject(new Error('EventSource connect failed'));
    };

    socket.onmessage = function(event) {
      self._receive(JSON.parse(event.data));
    };

    self._socket = socket;
  });
}

inherits(Faye_Transport_EventSource, Faye_Transport);

extend(Faye_Transport_EventSource.prototype, {
  close: function() {
    if (!this._socket) return;
    this._socket.onopen = this._socket.onerror = this._socket.onmessage = null;
    this._socket.close();
    this._socket = null;
  },

  isUsable: function(callback) {
    this._connectPromise
      .then(function() {
        callback(true);
      }, function() {
        callback(false);
      });
  },

  encode: function(messages) {
    return this._xhr.encode(messages);
  },

  request: function(messages) {
    return this._xhr.request(messages);
  }

});

/* Statics */
Faye_Transport_EventSource.isUsable = function(dispatcher, endpoint, callback) {
  var id = dispatcher.clientId;
  if (!id) return callback(false);

  Faye_Transport_XHR.isUsable(dispatcher, endpoint, function(usable) {
    if (!usable) return callback(false);
    Faye_Transport_EventSource.create(dispatcher, endpoint).isUsable(callback);
  });
};

Faye_Transport_EventSource.create = function(dispatcher, endpoint) {
  var id = dispatcher.clientId;

  var sockets = dispatcher.transports.eventsource;
  if (!sockets) {
    sockets = dispatcher.transports.eventsource = {};
  }

  endpoint = extend({ }, endpoint);
  endpoint.pathname += '/' + (id || '');
  var url = Faye_URI.stringify(endpoint);

  var eventSource = sockets[url];
  if (!eventSource) {
    eventSource = sockets[url] = new Faye_Transport_EventSource(dispatcher, endpoint);
  }

  return eventSource;
};

module.exports = Faye_Transport_EventSource;
