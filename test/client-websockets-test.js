'use strict';

var Halley = require('..');

describe('client-websocket', function() {
  describe('direct', function() {
    beforeEach(function() {
      this.client = new Halley.Client(this.urlDirect, {
        retry: this.clientOptions.retry,
        timeout: this.clientOptions.timeout,
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
      this.client = new Halley.Client(this.urlProxied, {
        retry: this.clientOptions.retry,
        timeout: this.clientOptions.timeout,

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
