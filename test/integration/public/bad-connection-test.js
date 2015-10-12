var Faye = require('../../..');

describe('bad-connection', function() {
  this.timeout(60000);
  var client;

  beforeEach(function() {
    client = new Faye.Client('http://localhost:8002/bayeux', { timeout: 45 });
  });

  afterEach(function() {
    client.disconnect();
  });

  it('should deal with a network outage', function(done) {
    var count = 0;
    var outageOccurred = false;

    var subscription = client.subscribe('/datetime', function(message) {
      console.log('MESSAGE', message);
      if (!outageOccurred) {
        outageOccurred = true;
        var subscription = client.publish('/simulate-network-outage', { data: 1 })
          .then(function() {
          }, done);

        return;
      }

      count++;
      if (count >= 3) {
        done();
      }
    });

    // subscription.then(function() {
    // }, done);
  });


});
