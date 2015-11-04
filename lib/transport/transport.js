'use strict';

var debug    = require('debug')('halley:transport');

var registeredTransports = [];

function Transport(dispatcher, endpoint) {
  this._dispatcher = dispatcher;
  this.endpoint    = endpoint;
}

Transport.prototype = {
  close: function() {
  },

  /* Abstract encode: function(messages) { } */
  /* Abstract request: function(messages) { } */

  /* Returns a promise of a request */
  sendMessage: function(message) {
    return this.request([message]);
  },

  _receive: function(replies) {
    if (!replies) return;
    replies = [].concat(replies);

    debug('Client %s received via %s: %j', this._dispatcher.clientId, this.connectionType, replies);

    for (var i = 0, n = replies.length; i < n; i++) {
      this._dispatcher.handleResponse(replies[i]);
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
