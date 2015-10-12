'use strict';

var Faye = require('./faye');
Faye.Client = require('./protocol/client');

/* Register the transports. Order is important */
Faye.Transport = {
  WebSocket: require('./transport/web_socket'),
  // TODO: re-enable this
  // EventSource: require('./transport/browser/event_source'),
  XHR: require('./transport/browser/xhr'),
  CORS: require('./transport/browser/cors'),
  JSONP: require('./transport/browser/jsonp')
};

module.exports = Faye;
