'use strict';

var Faye = require('./faye');
Faye.Client = require('./protocol/client');

/* Register protocols */
Faye.Transport = {
  NodeLocal: require('./transport/node/node_local'),
  WebSocket: require('./transport/web_socket'),
  NodeHttp: require('./transport/node/node_http')
};

module.exports = Faye;
