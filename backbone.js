'use strict';

var Promise = require('bluebird');
Promise.config({
  cancellation: true
});

require('./lib/util/externals').use({
  Events: require('backbone').Events,
  extend: require('underscore').extend
});

var Faye = { };
Faye.Client = require('./lib/protocol/client');

var Transport = require('./lib/transport/transport');

/* Register the transports. Order is important */
Transport.register('websocket'       , require('./lib/transport/browser/browser-websocket'));
Transport.register('long-polling'    , require('./lib/transport/browser/xhr'));
Transport.register('callback-polling', require('./lib/transport/browser/jsonp'));

module.exports = Faye;
