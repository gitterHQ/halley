'use strict';

var Halley = require('../../..');
var globalEvents = require('../../../lib/util/global-events');

describe('onbeforeunload', function() {
  var client;

  beforeEach(function() {
    client = new Halley.Client('http://localhost:8001/bayeux', { timeout: 45 });
  });

  afterEach(function() {
    client.disconnect();
  });

  it('should respond to beforeunload correctly', function(done) {
    var count = 0;
    var subscription = client.subscribe('/datetime', function(message) {
      count++;

      if (count === 3) {
        client.on('disconnect', done);
        globalEvents.trigger('beforeunload');
      }
    });

    subscription.catch(function() {
      done(err);
    });

  });

});
