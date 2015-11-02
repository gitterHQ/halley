'use strict';

require('../../../lib/util/externals').use({
  Events: require('backbone-events-standalone'),
  extend: require('lodash/object/extend')
});

var Promise = require('bluebird');
Promise.config({
  warnings: false,
  longStackTraces: true,
  cancellation: true
});

require('./browser-websocket-test');
require('./client-long-polling-test');
require('./client-callback-polling-test');
require('./client-websockets-test');
require('./client-all-transports-test');
// require('./on-before-unload-test');
// require('./subscribe-test');
// require('./reset-test');
// require('./rehandshake-test');
// require('./publish-test');
// require('./bad-connection-test');
// require('./server-restart-test');
