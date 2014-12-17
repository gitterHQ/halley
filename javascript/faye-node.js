'use strict';

/* Register protocols */
require('./transport/node_local');
require('./transport/web_socket');
require('./transport/node_http');


var Faye = require('./faye');
// Optional dependencies
Faye.WebSocket = require('./transport/web_socket');

module.exports = {
  NodeAdapter: require('./adapters/node_adapter'),
  Client: require('./protocol/client')
};
