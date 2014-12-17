'use strict';

/* Register protocols */
require('./transport/node_local');
require('./transport/web_socket');
require('./transport/node_http');

module.exports = {
  NodeAdapter: require('./adapters/node_adapter'),
  Client: require('./protocol/client')
};
