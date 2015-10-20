var Faye = require('../../..');
var assert = require('assert');

describe('reset', function() {
  var client;

  beforeEach(function() {
    client = new Faye.Client('http://localhost:8001/bayeux', { timeout: 45 });
  });

  afterEach(function() {
    client.disconnect();
  });

  it('a reset should proceed normally', function(done) {
    var count = 0;
    var subscription = client.subscribe('/datetime', function(message) {
      count++;
      if (count === 1) {
        originalClientId = client.getClientId();
        assert(originalClientId);
        client.reset();
        return;
      }

      // Wait for two messages to arrive after the reset to avoid
      // the possiblity of a race condition in which a message
      // arrives at the same time as the reset
      if (count === 3) {
        assert(client.getClientId());
        assert(client.getClientId() !== originalClientId);
        done();
      }
    });

    subscription.catch(done);
  });


});
