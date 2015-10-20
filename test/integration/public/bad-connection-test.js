var Faye = require('../../..');
var assert = require('assert');
require('whatwg-fetch');

describe('bad-connection', function() {
  this.timeout(800000);
  var client;

  beforeEach(function() {
    client = new Faye.Client('http://localhost:8002/bayeux', { timeout: 45 });
  });

  afterEach(function() {
    client.disconnect();
  });

  it('should deal with a tcp disconnect', function(done) {
    var count = 0;
    var postOutageCount = 0;
    var outageTime;
    var clientId;

    var subscription = client.subscribe('/datetime', function(message) {
      count++;

      if (count === 3) {
        clientId = client.getClientId();
        return fetch('/disconnect', {
          method: 'post',
          body: ""
        })
        .then(function() {
          outageTime = Date.now();
          outageOccurred = true;
          console.log('All clients disconnected');
        })
        .catch(done);
      }

      if (!outageTime) return;

      console.log('Receiving messages again');

      postOutageCount++;

      if (postOutageCount >= 3) {
        // A disconnect should not re-initialise the client
        assert.strictEqual(clientId, client.getClientId());
        done();
      }
    });
  });

  it('should deal with a network outage', function(done) {
    var count = 0;
    var postOutageCount = 0;
    var outageTime;

    var subscription = client.subscribe('/datetime', function(message) {
      count++;

      if (count === 1) {
        return fetch('/network-outage?timeout=5000', {
          method: 'post',
          body: ""
        })
        .then(function() {
          outageTime = Date.now();
          outageOccurred = true;
          console.log('Outage');
        })
        .catch(done);
      }

      if (!outageTime) return;

      console.log('Receiving messages again');

      postOutageCount++;

      if (postOutageCount >= 3) {
        assert(Date.now() - outageTime >= 5000);
        done();
      }
    });
  });


});
