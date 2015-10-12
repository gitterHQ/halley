var Faye = require('../../..');

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
        client.reset();
      }
      if (count === 3) {
        done();
      }
    });

    subscription.then(null, done);
  });


});
