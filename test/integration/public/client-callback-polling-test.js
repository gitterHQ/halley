'use strict';

var Faye = require('../../..');

describe('client-callback-polling', function() {

  describe('direct', function() {
    beforeEach(function() {
      this.client = new Faye.Client('http://localhost:8001/bayeux', {
        retry: 500,
        timeout: 500,
        connectionTypes: ['callback-polling'],
        disabled: ['websocket', 'long-polling']
      });
    });

    afterEach(function() {
      this.client.disconnect();
    });

    require('./specs/client-spec')();
  });

  describe('direct', function() {
    beforeEach(function() {
      this.client = new Faye.Client('http://localhost:8002/bayeux', {
        retry: 500,
        timeout: 500,
        connectionTypes: ['callback-polling'],
        disabled: ['websocket', 'long-polling']
      });
    });

    afterEach(function() {
      this.client.disconnect();
    });

    require('./specs/client-proxied-spec')();

  });

});
