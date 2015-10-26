var Faye = require('../../..');
var fetch = require('../fetch');
var assert = require('assert');

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
    var originalClientId;

    var subscription = client.subscribe('/datetime', function(message) {
      if (!deleteOccurred) return;
      count++;
      if (count >= 3) {
        assert.notEqual(originalClientId, client.getClientId());
        done();
      }
    }).then(function() {
      originalClientId = client.getClientId();
      assert(originalClientId);

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
