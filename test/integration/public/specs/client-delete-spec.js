'use strict';

var fetch = require('../../fetch');
var assert = require('assert');

module.exports = function() {
  describe('client-delete', function() {
    this.timeout(60000);

    /**
     * This test ensures that the client is able to recover from a situation
     * where the server unexpectedly deletes the client and the client
     * no longer exists on the server
     */
    it('should recover from an unexpected disconnect', function(done) {
      var client = this.client;
      var count = 0;
      var deleteOccurred = false;
      var originalClientId;

      client.subscribe('/datetime', function() {
        if (!deleteOccurred) return;
        count++;
        if (count === 3) {
          assert.notEqual(originalClientId, client.getClientId());
          done();
        }
      }).then(function() {
        originalClientId = client.getClientId();
        assert(originalClientId);

        return fetch('/delete/' + client.getClientId(), {
          method: 'post',
          body: ""
        })
        .then(function() {
          deleteOccurred = true;
        });
      })
      .catch(done);
    });


  });
}
