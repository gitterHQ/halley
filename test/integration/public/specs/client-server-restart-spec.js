'use strict';

var assert = require('assert');
var fetch = require('../../fetch');
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
  describe('server-restart', function() {
    this.timeout(6000);

    it('should deal with a server restart', function(done) {
      var client = this.client;
      var count = 0;
      var postOutageCount = 0;
      var outageTime;
      var clientId;
      var d = defer();

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
          .catch(function(err) {
            d.reject(err);
          });
        }

        if (!outageTime) return;

        postOutageCount++;

        if (postOutageCount >= 3) {
          d.resolve();
        }
      }).promise.then(function() {
        return d.promise;
      })
      .then(function() {
        // A disconnect should not re-initialise the client
        assert.strictEqual(clientId, client.getClientId());
      })
      .nodeify(done);
    });

  });
};
