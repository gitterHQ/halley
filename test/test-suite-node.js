'use strict';

require('../lib/util/externals').use({
  Events: require('backbone-events-standalone'),
  extend: require('lodash/object/extend')
});

var Promise = require('bluebird');
Promise.config({
  warnings: false,
  longStackTraces: false,
  cancellation: true
});

var BayeuxWithProxyServer = require('./helpers/bayeux-with-proxy-server');

describe('node-test-suite', function() {

  before(function(done) {
    var self = this;
    this.server = new BayeuxWithProxyServer();

    this.serverControl = this.server;

    this.server.start(function(err, ports) {
      if (err) return done(err);
      self.ports = ports;
      done();
    });
  });

  after(function(done) {
    this.server.stop(done);
  });

  describe('integration tests', function() {
    this.timeout(10000);

    before(function(done) {
      /* Give server time to startup */
      this.timeout(20000);
      this.serverControl.restoreAll().nodeify(done);
    });

    beforeEach(function() {
      this.urlDirect = 'http://localhost:' + this.ports.bayeuxPort + '/bayeux';
      this.urlProxied = 'http://localhost:' + this.ports.proxyPort  + '/bayeux';

      this.clientOptions = {
        retry: 500,
        timeout: 500
      };
    });

    afterEach(function(done) {
      this.serverControl.restoreAll().nodeify(done);
    });

    require('./node-websocket-test');
    require('./client-long-polling-test');
    require('./client-websockets-test');
    require('./client-all-transports-test');
  });


  describe('unit tests', function() {
    require('./extensions-test');
    require('./transport-pool-test');
  });


});
