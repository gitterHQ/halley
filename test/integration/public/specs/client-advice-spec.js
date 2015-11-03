'use strict';

var assert = require('assert');
var Promise = require('bluebird');

function defer() {
  var d = {};

  d.promise = new Promise(function(resolve, reject) {
    d.resolve = resolve;
    d.reject = reject;
  });

  return d;
}

module.exports = function() {
  describe('advice', function() {

    it('should handle advice retry', function(done) {
      var publishOccurred = false;
      var client = this.client;

      var d = defer();

      client.subscribe('/datetime', function() {
          if (!publishOccurred) return;
          d.resolve();
        })
        .then(function() {
          return client.publish('/advice-retry', { data: 1 });
        })
        .then(function() {
          publishOccurred = true;
        })
        .then(function() {
          return d.promise;
        })
        .nodeify(done);
    });

    /**
     * Tests to ensure that after receiving a handshake advice
     */
    it('should handle advice handshake', function(done) {
      this.timeout(6000);
      var client = this.client;
      var originalClientId;
      var rehandshook = false;
      var d = defer();

      client.subscribe('/datetime', function() {
          if (!rehandshook) return;
          d.resolve();
        })
        .then(function() {
          originalClientId = client.getClientId();

          client.once('handshake:success', function() {
            rehandshook = true;
          });

          return client.publish('/advice-handshake', { data: 1 });
        })
        .then(function() {
          return d.promise;
        })
        .then(function() {          
          assert(client.getClientId());
          assert.notEqual(client.getClientId(), originalClientId);
        })
        .nodeify(done);
    });

  });

};
