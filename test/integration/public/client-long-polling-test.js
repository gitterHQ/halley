'use strict';

var Faye = require('../../..');

describe('client-long-polling', function() {

  describe('direct', function() {

    beforeEach(function() {
      this.client = new Faye.Client('http://localhost:8001/bayeux', {
        timeout: 45,
        connectionTypes: ['long-polling']
      });
    });

    afterEach(function() {
      this.client.disconnect();
    });

    require('./specs/client-spec')();

  });

  describe('proxied', function() {

    beforeEach(function() {
      this.client = new Faye.Client('http://localhost:8002/bayeux', {
        timeout: 45,
        connectionTypes: ['long-polling']
      });
    });

    afterEach(function() {
      this.client.disconnect();
    });

    require('./specs/client-proxied-spec')();

  });

});
