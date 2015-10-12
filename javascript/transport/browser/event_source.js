'use strict';

var Faye               = require('../../faye');
var Faye_Transport     = require('../transport');
var Faye_URI           = require('../../util/uri');
var Faye_Deferrable    = require('../../mixins/deferrable');
var Faye_Transport_XHR = require('./xhr');
var inherits           = require('inherits');
var extend             = require('../../util/extend');

var WindowEventSource = window.EventSource;

function Faye_Transport_EventSource(dispatcher, endpoint) {
  Faye_Transport_EventSource.super_.call(this, dispatcher, endpoint);

  if (!WindowEventSource) return this.setDeferredStatus('failed');

  this._xhr = new Faye_Transport_XHR(dispatcher, endpoint);

  endpoint = Faye.copyObject(endpoint);
  endpoint.pathname += '/' + dispatcher.clientId;

  var socket = new WindowEventSource(Faye_URI.stringify(endpoint)),
      self   = this;

  socket.onopen = function() {
    self._everConnected = true;
    self.setDeferredStatus('succeeded');
  };

  socket.onerror = function() {
    if (self._everConnected) {
      self._handleError([]);
    } else {
      self.setDeferredStatus('failed');
      socket.close();
    }
  };

  socket.onmessage = function(event) {
    self._receive(JSON.parse(event.data));
  };

  this._socket = socket;
}
inherits(Faye_Transport_EventSource, Faye_Transport);

extend(Faye_Transport_EventSource.prototype, {
  close: function() {
    if (!this._socket) return;
    this._socket.onopen = this._socket.onerror = this._socket.onmessage = null;
    this._socket.close();
    delete this._socket;
  },

  isUsable: function(callback, context) {
    this.callback(function() { callback.call(context, true); });
    this.errback(function() { callback.call(context, false); });
  },

  encode: function(messages) {
    return this._xhr.encode(messages);
  },

  request: function(messages) {
    return this._xhr.request(messages);
  }

});

/* Statics */
extend(Faye_Transport_EventSource, {
  isUsable: function(dispatcher, endpoint, callback, context) {
    var id = dispatcher.clientId;
    if (!id) return callback.call(context, false);

    Faye_Transport_XHR.isUsable(dispatcher, endpoint, function(usable) {
      if (!usable) return callback.call(context, false);
      this.create(dispatcher, endpoint).isUsable(callback, context);
    }, this);
  },

  create: function(dispatcher, endpoint) {
    var sockets = dispatcher.transports.eventsource = dispatcher.transports.eventsource || {},
        id      = dispatcher.clientId;

    endpoint = Faye.copyObject(endpoint);
    endpoint.pathname += '/' + (id || '');
    var url = Faye_URI.stringify(endpoint);

    sockets[url] = sockets[url] || new this(dispatcher, endpoint);
    return sockets[url];
  }
});

/* Mixins */
extend(Faye_Transport_EventSource.prototype, Faye_Deferrable);

Faye_Transport.register('eventsource', Faye_Transport_EventSource);

module.exports = Faye_Transport_EventSource;
