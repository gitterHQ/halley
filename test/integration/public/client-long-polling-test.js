'use strict';

var Faye = require('../../..');

describe('client-long-polling', function() {

  describe('direct', function() {

    beforeEach(function() {
      this.client = new Faye.Client('http://localhost:8001/bayeux', {
        retry: 1,
        connectionTypes: ['long-polling'],
        disabled: ['websocket', 'callback-polling']
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
        retry: 1,
        connectionTypes: ['long-polling'],
        disabled: ['websocket', 'callback-polling']
      });
    });

    afterEach(function() {
      this.client.disconnect();
    });

    require('./specs/client-proxied-spec')();

  });

});
