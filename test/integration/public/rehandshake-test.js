var Faye = require('../../..');

describe('rehandshake', function() {
  this.timeout(60000);
  var client;

  beforeEach(function() {
    client = new Faye.Client('http://localhost:8001/bayeux', { timeout: 45 });
  });

  afterEach(function() {
    client.disconnect();
  });

  it('should recover from an unexpected disconnect', function(done) {
    var count = 0;
    var deleteOccurred = false;

    var subscription = client.subscribe('/datetime', function(message) {
      if (!deleteOccurred) return;
      count++;
      if (count >= 3) {
        done();
      }
    });

    subscription.then(function() {

      var subscription = client.publish('/delete-client-10ms', { data: 1 })
        .then(function() {
          deleteOccurred = true;
        });
    }, done);
  });


});
