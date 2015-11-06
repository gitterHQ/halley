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

  before(function(done) {
    /* Give server time to startup */
    this.timeout(20000);
    serverControl.restoreAll().nodeify(done);
  });

  beforeEach(function() {
    this.urlDirect = 'http://localhost:8001/bayeux';
    this.urlProxied = 'http://localhost:8002/bayeux';

    this.clientOptions = {
      retry: 500,
      timeout: 500
    };
  });

  afterEach(function(done) {
    serverControl.restoreAll().nodeify(done);
  });

  require('./node-websocket-test');
  require('./client-long-polling-test');
  require('./client-websockets-test');
  require('./client-all-transports-test');
});


describe('node unit tests', function() {
  require('./extensions-test');
  require('./transport-pool-test');
});
