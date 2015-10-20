'use strict';

var inherits      = require('inherits');
var extend        = require('lodash/object/extend');
var WebSocket     = require('faye-websocket');
var BaseWebSocket = require('../base-websocket');

function NodeWebSocket(dispatcher, endpoint) {
  NodeWebSocket.super_.call(this, dispatcher, endpoint);
}
inherits(NodeWebSocket, BaseWebSocket);

extend(NodeWebSocket.prototype, {
  _createWebsocket: function(url) {
    return new WebSocket.Client(url, []);
  },
});


NodeWebSocket.create = BaseWebSocket.create;
NodeWebSocket.isUsable = BaseWebSocket.isUsable;

module.exports = NodeWebSocket;
