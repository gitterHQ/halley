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
  this.timeout(30000);

  before(function(done) {
    serverControl.restoreAll().nodeify(done);
  });

  beforeEach(function() {
    this.urlDirect = 'http://localhost:8001/bayeux';
    this.urlProxied = 'http://localhost:8002/bayeux';

    this.clientOptions = {
      retry: 5000,
      timeout: 5000
    };
  });

  afterEach(function(done) {
    serverControl.restoreAll().nodeify(done);
  });


  require('./browser-websocket-test');
  require('./client-long-polling-test');
  require('./client-websockets-test');
  require('./client-all-transports-test');
});

describe('browser unit tests', function() {
  require('./extensions-test');
});
