var Faye = require('../../..');
var assert = require('assert');
var fetch = require('../fetch');

describe('server-outage', function() {
  this.timeout(800000);
  var client;

  beforeEach(function() {
    client = new Faye.Client('http://localhost:8002/bayeux', { timeout: 45 });
  });

  afterEach(function() {
    client.disconnect();
  });

  it('should deal with a server restart', function(done) {
    var count = 0;
    var postOutageCount = 0;
    var outageTime;
    var clientId;

    var subscription = client.subscribe('/datetime', function(message) {
      count++;

      if (count === 3) {
        clientId = client.getClientId();
        console.log('Initiating restart');
        return fetch('/restart', {
          method: 'post',
          body: ""
        })
        .then(function() {
          outageTime = Date.now();
          outageOccurred = true;
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



});
