'use strict';

var assert = require('assert');

module.exports = function() {
  describe('reset', function() {
    this.timeout(10000);

    it('a reset should proceed normally', function(done) {
      var client = this.client;
      var originalClientId;
      var rehandshook = false;
      var count = 0;
      var postResetCount = 0;

      var subscription = client.subscribe('/datetime', function() {
        count++;
        if (count === 1) {
          originalClientId = client.getClientId();
          assert(originalClientId);
          client.reset();

          client.once('handshake:success', function() {
            rehandshook = true;
          });

          return;
        }

        if (rehandshook) {
          postResetCount++;

          // Wait for two messages to arrive after the reset to avoid
          // the possiblity of a race condition in which a message
          // arrives at the same time as the reset
          if (postResetCount > 3) {
            assert(client.getClientId());
            assert(client.getClientId() !== originalClientId);
            done();
          }
        }
      });

      subscription.catch(done);
    });


  });

};
