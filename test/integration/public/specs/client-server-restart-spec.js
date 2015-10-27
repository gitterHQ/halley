'use strict';

var assert = require('assert');
var fetch = require('../../fetch');

module.exports = function() {
  describe('server-restart', function() {
    this.timeout(6000);

    it('should deal with a server restart', function(done) {
      var client = this.client;
      var count = 0;
      var postOutageCount = 0;
      var outageTime;
      var clientId;

      client.subscribe('/datetime', function(message) {
        count++;

        if (count === 3) {
          clientId = client.getClientId();
          return fetch('/restart', {
            method: 'post',
            body: ""
          })
          .then(function() {
            outageTime = Date.now();
          })
          .catch(done);
        }

        if (!outageTime) return;

        postOutageCount++;

        if (postOutageCount >= 3) {
          // A disconnect should not re-initialise the client
          assert.strictEqual(clientId, client.getClientId());
          done();
        }
      });
    });

  });
};
