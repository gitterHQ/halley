'use strict';

var Faye = require('../../..');

describe('client-all-transport', function() {

  describe('direct', function() {

    beforeEach(function() {
      this.client = new Faye.Client('http://localhost:8001/bayeux', {
        timeout: 45
      });
    });

    afterEach(function() {
      this.client.disconnect();
    });

    require('./specs/client-spec')();
    require('./specs/client-bad-websockets-spec')();
  });

  describe('proxied', function() {

    beforeEach(function() {
      this.client = new Faye.Client('http://localhost:8002/bayeux', {
        timeout: 45
      });
    });

    afterEach(function() {
      this.client.disconnect();
    });

    require('./specs/client-proxied-spec')();

  });

});
