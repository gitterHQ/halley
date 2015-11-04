'use strict';

var Halley = require('../../..');

describe('client-websocket', function() {
  describe('direct', function() {
    beforeEach(function() {
      this.client = new Halley.Client('http://localhost:8001/bayeux', {
        retry: 500,
        timeout: 500,
        connectionTypes: ['websocket'],
        disabled: ['long-polling', 'callback-polling']
      });
    });

    afterEach(function() {
      this.client.disconnect();
    });

    require('./specs/client-spec')();
  });

  describe('proxied', function() {
    beforeEach(function() {
      this.client = new Halley.Client('http://localhost:8002/bayeux', {
        retry: 500,
        timeout: 500,
        connectionTypes: ['websocket'],
        disabled: ['long-polling', 'callback-polling']
      });
    });

    afterEach(function() {
      this.client.disconnect();
    });

    require('./specs/client-proxied-spec')();
  });


});
