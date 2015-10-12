/* jshint node:true */
'use strict';

var WebSocket = require('faye-websocket');

module.exports = function(url, options) {
  return new WebSocket.Client(url, [], options);
};
