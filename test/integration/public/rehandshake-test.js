var Faye = require('../../..');
var fetch = require('../fetch');

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
    }).then(function() {
      return fetch('/delete/' + client.getClientId(), {
        method: 'post',
        body: ""
      })
      .then(function() {
        console.log('delete successful');
        deleteOccurred = true;
      });
    })
    .catch(done);
  });


});
