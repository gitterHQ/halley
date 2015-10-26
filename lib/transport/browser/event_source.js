'use strict';

// DISABLED for now

var Transport    = require('../transport');
var uri          = require('../../util/uri');
var Promise      = require('bluebird');
var XHRTransport = require('./xhr');
var inherits     = require('inherits');
var extend       = require('lodash/object/extend');

var WindowEventSource = window.EventSource;
var EVENTSOURCE_OPEN = 1;

function EventSourceTransport(dispatcher, endpoint) {
  EventSourceTransport.super_.call(this, dispatcher, endpoint);
  var self = this;

  this._connectPromise = new Promise(function(resolve, reject) {
    if (!WindowEventSource) return reject(new Error('EventSource not supported'));

    self._xhr = new XHRTransport(dispatcher, endpoint);

    var eventSourceEndpoint = extend({ }, endpoint); // Copy endpoint
    eventSourceEndpoint.pathname += '/' + dispatcher.clientId;

    var socket = new WindowEventSource(uri.stringify(eventSourceEndpoint));

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

inherits(EventSourceTransport, Transport);

extend(EventSourceTransport.prototype, {
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
EventSourceTransport.isUsable = function(dispatcher, endpoint, callback) {
  // TODO: make this sync
  var id = dispatcher.clientId;
  if (!id) return callback(false);

  XHRTransport.isUsable(dispatcher, endpoint, function(usable) {
    if (!usable) return callback(false);
    EventSourceTransport.create(dispatcher, endpoint).isUsable(callback);
  });
};

EventSourceTransport.create = function(dispatcher, endpoint) {
  var id = dispatcher.clientId;

  var sockets = dispatcher.transports.eventsource;
  if (!sockets) {
    sockets = dispatcher.transports.eventsource = {};
  }

  endpoint = extend({ }, endpoint);
  endpoint.pathname += '/' + (id || '');
  var url = uri.stringify(endpoint);

  var eventSource = sockets[url];
  if (!eventSource) {
    eventSource = sockets[url] = new EventSourceTransport(dispatcher, endpoint);
  }

  return eventSource;
};

module.exports = EventSourceTransport;
