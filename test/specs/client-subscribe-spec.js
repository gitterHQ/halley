'use strict';

var assert = require('assert');
var Promise = require('bluebird');

module.exports = function() {
  describe('subscriptions', function() {

    it('should subscribe to a channel and receive messages', function(done) {
      var defer = {};
      defer.promise = new Promise(function(resolve, reject) {
        defer.resolve = resolve;
        defer.reject = reject;
      });

      var subscription = this.client.subscribe('/datetime', function() {
        defer.resolve();
      });

      return Promise.all([subscription.promise, defer.promise])
        .nodeify(done);
    });

    it('should cancel a subscription correctly', function(done) {
      var count = 0;
      var subscription = this.client.subscribe('/datetime', function() {
        count++;
        if (count === 2) {
          subscription.cancel()
            .then(function() {
              done();
            })
            .catch(done);
        }

        assert(count <= 2);
      });

      subscription.catch(done);
    });


    it('should handle subscriptions that are cancelled before establishment', function(done) {
      var count = 0;
      var subscription = this.client.subscribe('/datetime', function() {
          // assert.ok(false);
          count++;
        });

      subscription.promise
        .finally(function() {
          try {
            assert(subscription.promise.isCancelled());
            done();
          } catch(e) {
            done(e);
          }
        })
        .nodeify(done);

      // Cancel immediately
      subscription.cancel();
    });

    it('should handle subscription failure correctly', function(done) {
      var subscription = this.client.subscribe('/banned', function() {
        done(new Error('Expected a failure'));
      });

      subscription.then(function() {
        done(new Error('Expected a failure'));
      }, function() {
        done();
      });
    });

  });

};
