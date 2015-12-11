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
          subscribe.cancel();
        })
        .delay(10)
        .then(function() {
          assert(!this.client._channels.hasSubscription('/datetime'));
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
          subscribe1.cancel();
          return subscribe2;
        })
        .delay(10)
        .then(function(s2) {
          assert(!s2._cancelled);

          assert(this.client._channels.hasSubscription('/datetime'));
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

  });

};
