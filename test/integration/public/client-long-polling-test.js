'use strict';

var Faye = require('../../..');

describe('client-long-polling', function() {

  describe('direct', function() {

    beforeEach(function() {
      this.client = new Faye.Client(this.urlDirect, {
        retry: this.clientOptions.retry,
        timeout: this.clientOptions.timeout,
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
      this.client = new Faye.Client(this.urlProxied, {
        retry: this.clientOptions.retry,
        timeout: this.clientOptions.timeout,
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
