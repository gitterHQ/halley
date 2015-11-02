'use strict';

var Promise = require('bluebird');
Promise.config({
  cancellation: true
});

require('./lib/util/externals').use({
  Events: require('backbone-events-standalone'),
  extend: require('lodash/object/extend')
});

var Faye = { };
var Transport = require('./lib/transport/transport');
Faye.Client = require('./lib/protocol/client');

Transport.register('websocket'   , require('./lib/transport/node/node-websocket'));
Transport.register('long-polling', require('./lib/transport/node/node_http'));

module.exports = Faye;
