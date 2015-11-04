'use strict';

var Halley = require('../../..');

describe('client-all-transport', function() {

  describe('direct', function() {

    beforeEach(function() {
      this.client = new Halley.Client('http://localhost:8001/bayeux', {
        retry: 500,
        timeout: 500
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
      this.client = new Halley.Client('http://localhost:8002/bayeux', {
        retry: 500,
        timeout: 500
      });
    });

    afterEach(function() {
      this.client.disconnect();
    });

    require('./specs/client-proxied-spec')();

  });

});
