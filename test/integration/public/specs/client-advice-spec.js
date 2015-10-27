'use strict';

var assert = require('assert');

module.exports = function() {
  describe('advice', function() {

    it('should handle advice retry', function(done) {
      var publishOccurred = false;
      var client = this.client;

      client.subscribe('/datetime', function() {
          if (!publishOccurred) return;
          done();
        })
        .then(function() {
          return client.publish('/advice-retry', { data: 1 });
        })
        .then(function() {
          publishOccurred = true;
        })
        .catch(done);
    });

    /**
     * Tests to ensure that after receiving a handshake advice
     */
    it('should handle advice handshake', function(done) {
      this.timeout(6000);
      var client = this.client;
      var originalClientId;
      var rehandshook = false;

      client.subscribe('/datetime', function() {
          if (!rehandshook) return;

          assert(client.getClientId());
          assert.notEqual(client.getClientId(), originalClientId);

          done();
        })
        .then(function() {
          originalClientId = client.getClientId();

          client.once('handshake:success', function() {
            rehandshook = true;
          });

          return client.publish('/advice-handshake', { data: 1 });
        })
        .catch(done);
    });

  });

};
