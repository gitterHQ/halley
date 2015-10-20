var Faye = require('../../..');
var assert = require('assert');

describe('subscriptions', function() {
  var client;

  beforeEach(function() {
    client = new Faye.Client('http://localhost:8001/bayeux', { timeout: 45 });
  });

  afterEach(function() {
    client.disconnect();
  });

  it('should subscribe to a channel and receive messages', function(done) {
    var count = 0;
    var subscription = client.subscribe('/datetime', function(message) {
      if (++count >= 1) {
        return done();
      }
    });

    subscription.catch(done);
  });

  it('should cancel a subscription correctly', function(done) {
    var count = 0;
    var subscription = client.subscribe('/datetime', function(message) {
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

  it('should handle subscription failure correctly', function(done) {
    var count = 0;
    var subscription = client.subscribe('/banned', function(message) {
      done(new Error('Expected a failure'));
    });

    subscription.then(function() {
      done(new Error('Expected a failure'));
    }, function(err) {
      done();
    });
  });

});
