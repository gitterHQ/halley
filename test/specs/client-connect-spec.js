'use strict';

var assert = require('assert');
var Promise = require('bluebird');

module.exports = function() {
  describe('client-connect', function() {

    it('should not timeout on empty connect messages', function() {
      var client = this.client;
      var connectionWentDown = false;
      client.on('connection:down', function() {
        connectionWentDown = true;
      });

      return client.connect()
        .then(function() {
          return Promise.delay(client._advice.timeout + 1000);
        })
        .then(function() {
          assert(!connectionWentDown);
        });
    });

  });

};
