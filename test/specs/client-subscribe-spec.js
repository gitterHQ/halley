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
  describe('client-subscribe', function() {

    it('should subscribe to a channel and receive messages', function() {
      var d = defer();

      var subscription = this.client.subscribe('/datetime', function() {
        d.resolve();
      });

      return Promise.all([subscription, d.promise]);
    });

    it('should unsubscribe a subscription correctly', function() {
      var count = 0;
      var d = defer();

      var subscribe = this.client.subscribe('/datetime', function() {
        count++;
        if (count === 2) {
          d.resolve();
        }
      });

      return Promise.join(subscribe, d.promise, function(subscription) {
          return subscription.unsubscribe();
        })
        .bind(this)
        .then(function() {
          assert.deepEqual(this.client.listChannels(), []);
        });
    });

    it('should handle subscriptions that are cancelled before establishment, single', function() {
      var subscribe = this.client.subscribe('/datetime', function() {
          assert.ok(false);
        });

      return this.client.connect()
        .bind(this)
        .then(function() {
          // The subscribe will be inflight right now
          assert(subscribe.isPending());
          subscribe.cancel();
        })
        .delay(10)
        .then(function() {
          assert.deepEqual(this.client.listChannels(), []);
        });
    });

    it('should handle subscriptions that are cancelled before establishment, double', function() {
      var subscribe1 = this.client.subscribe('/datetime', function() {
          assert.ok(false);
        });

      var d = defer();

      var subscribe2 = this.client.subscribe('/datetime', d.resolve);

      return this.client.connect()
        .bind(this)
        .then(function() {

          // The subscribe will be inflight right now
          assert(subscribe1.isPending());
          subscribe1.cancel();
        })
        .then(function() {
          assert(!subscribe2.isCancelled());
          return subscribe2;
        })
        .then(function() {
          assert.deepEqual(this.client.listChannels(), ['/datetime']);
          return d.promise;
        });
    });

    it('should handle subscriptions that are cancelled before establishment, then resubscribed', function() {
      var subscription = this.client.subscribe('/datetime', function() { });

      var promise = this.client.connect()
        .bind(this)
        .then(function() {
          subscription.cancel();
        })
        .then(function() {
          var d = defer();
          return Promise.all([this.client.subscribe('/datetime', d.resolve), d.promise]);
        })
        .then(function() {
          assert.deepEqual(this.client.listChannels(), ['/datetime']);
        });

      // Cancel immediately
      subscription.cancel();

      return promise;
    });

    it('should handle subscription failure correctly', function() {
      return this.client.subscribe('/banned', function() {
          assert(false);
        })
        .then(function() { assert(false); }, function() { });
    });

    it('should deal with subscriptions that fail with unknown client', function() {
      return this.client.connect()
        .bind(this)
        .then(function() {
          return this.serverControl.deleteSocket(this.client.getClientId());
        })
        .then(function() {
          var d = defer();

          var subscribe = this.client.subscribe('/datetime', d.resolve);

          return Promise.all([subscribe, d.promise]);
        });

    });

    it('cancelling one subscription during handshake should not affect another', function() {
      var subscribe1 = this.client.subscribe('/datetime', function() { });
      var subscribe2 = this.client.subscribe('/datetime', function() { });

      return Promise.delay(1)
        .bind(this)
        .then(function() {
          assert(subscribe1.isPending());
          subscribe1.cancel();
          return subscribe2;
        })
        .then(function(subscription2) {
          assert.deepEqual(this.client.listChannels(), ['/datetime']);
          return subscription2.unsubscribe();
        })
        .then(function() {
          assert.deepEqual(this.client.listChannels(), []);
        });
    });


    describe('extended tests #slow', function() {

      it('should handle multiple subscribe/unsubscribes', function() {
        var i = 0;
        var client = this.client;
        return (function next() {
            if (++i > 15) return;

            var subscribe = client.subscribe('/datetime', function() { });

            return (i % 2 === 0 ? subscribe : Promise.delay(1))
              .then(function() {
                if (subscribe.isFulfilled()) {
                  assert.deepEqual(client.listChannels(), ['/datetime']);
                  return subscribe.value().unsubscribe();
                } else {
                  subscribe.cancel();
                }
              })
              .delay(100)
              .then(function() {
                assert.deepEqual(client.listChannels(), []);
              })
              .then(next);
          })()
          .then(function() {
            assert.deepEqual(client.listChannels(), []);
          });
      });
    });

  });

};
