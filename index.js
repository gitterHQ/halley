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
var Transport = require('./transport/transport');
Faye.Client = require('./protocol/client');

Transport.register('websocket'   , require('./transport/node/node-websocket'));
Transport.register('long-polling', require('./transport/node/node_http'));

module.exports = Faye;
