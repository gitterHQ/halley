var Faye = require('../../..');

describe('publish', function() {
  this.timeout(60000);
  var client;

  beforeEach(function() {
    client = new Faye.Client('http://localhost:8001/bayeux', { timeout: 45 });
  });

  afterEach(function() {
    client.disconnect();
  });

  it('should handle publishes', function(done) {
    var publishOccurred = false;

    var subscription = client.subscribe('/datetime', function(message) {
        if (!publishOccurred) return;
        console.log(message);
        done();
      })
      .then(function() {
        publishOccurred = true;
        return client.publish('/channel', { data: 1 });
      })
      .catch(done);

  });

  it('should fail when a publish does not work', function(done) {
    var publishOccurred = false;

    return client.publish('/devnull', { data: 1 }, { attempts: 1 })
      .then(function() {
        done(new Error('Expected failure'));
      }, function(err) {
        done();
      });

  });


});
