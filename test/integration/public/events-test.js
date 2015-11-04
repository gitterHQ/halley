'use strict';

var Halley = require('../../..');
var assert = require('assert');

describe('client events', function() {
  var client;
  var eventQueue = [];

  beforeEach(function() {
    client = new Halley.Client('http://localhost:8001/bayeux', { timeout: 45 });
    client.on('handshake:success', function() {
      eventQueue.push('handshake:success');
    });
  });

  afterEach(function() {
    client.disconnect();
    client.off('handshake');
  });

  it('should emit events', function(done) {
    var count = 0;
    var subscription = client.subscribe('/datetime', function(message) {
      count++;

      if (count >= 3) {
        assert.deepEqual(eventQueue, ['handshake']);
        done();
      }
    });

    subscription.catch(function() {
      done(err);
    });

  });

});
