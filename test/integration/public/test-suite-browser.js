'use strict';

require('../../../lib/util/externals').use({
  Events: require('backbone-events-standalone'),
  extend: require('lodash/object/extend')
});

var Promise = require('bluebird');
Promise.config({
  warnings: true,
  longStackTraces: true,
  cancellation: true
});

var serverControl = require('./server-control');

describe('browser integration tests', function() {
  this.timeout(10000);
  
  afterEach(function(done) {
    serverControl.restoreAll().nodeify(done);
  });

  before(function(done) {
    serverControl.restoreAll().nodeify(done);
  });

  require('./browser-websocket-test');
  require('./client-long-polling-test');
  require('./client-callback-polling-test');
  require('./client-websockets-test');
  require('./client-all-transports-test');
  // require('./on-before-unload-test');
  // require('./subscribe-test');
  //

});

describe('browser unit tests', function() {
  require('./extensions-test');
});
