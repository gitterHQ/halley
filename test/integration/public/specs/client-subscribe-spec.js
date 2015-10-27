'use strict';

var assert = require('assert');

module.exports = function() {
  describe('subscriptions', function() {
    this.timeout(500000);
    
    it('should subscribe to a channel and receive messages', function(done) {
      var count = 0;
      var subscription = this.client.subscribe('/datetime', function() {
        if (++count >= 1) {
          return done();
        }
      });

      subscription.catch(done);
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

      subscription.then(function() {
          assert.ok(false);
        }, function(err) {
          assert.strictEqual(count, 0);
          done();
        });

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
