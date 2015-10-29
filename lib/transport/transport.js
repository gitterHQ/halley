'use strict';

var debug    = require('debug-proxy')('faye:transport');

var registeredTransports = [];

function Transport(dispatcher, endpoint) {
  this._dispatcher = dispatcher;
  this.endpoint    = endpoint;
}

Transport.prototype = {
  close: function() {
  },

  /* Abstract encode: function(messages) { } */

  /* Returns a promise of a request */
  sendMessage: function(message) {
    return this.request([message]);
  },

  _receive: function(replies) {
    if (!replies) return;
    replies = [].concat(replies);

    debug('Client %s received from %j via %s: %j',
               this._dispatcher.clientId, this.endpoint, this.connectionType, replies);

    for (var i = 0, n = replies.length; i < n; i++) {
      this._dispatcher.handleResponse(replies[i]);
    }
  },

  _handleError: function(messages) {
    messages = [].concat(messages);

    debug('Client %s failed to send to %j via %s: %j',
               this._dispatcher.clientId, this.endpoint, this.connectionType, messages);

    for (var i = 0, n = messages.length; i < n; i++) {
      this._dispatcher.handleError(messages[i]);
    }
  },

};

/* Statics */
Transport.getRegisteredTransports = function() {
  return registeredTransports;
};

Transport.register = function(type, klass) {
  registeredTransports.push([type, klass]);
  klass.prototype.connectionType = type;
};

Transport.getConnectionTypes = function() {
  return registeredTransports.map(function(t) { return t[0]; });
};

module.exports = Transport;
