/* jshint browser:true */
'use strict';

module.exports = function(url, options) {
  if (window.MozWebSocket) {
    return new window.MozWebSocket(url);
  }

  if (window.WebSocket) {
    return new window.WebSocket(url);
  }
};
