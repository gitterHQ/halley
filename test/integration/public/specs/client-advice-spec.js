'use strict';

var assert = require('assert');

module.exports = function() {
  describe('advice', function() {

    it('should handle advice retry', function(done) {
      var publishOccurred = false;
      var client = this.client;

      client.subscribe('/datetime', function() {
          if (!publishOccurred) return;
          done();
        })
        .then(function() {
          return client.publish('/advice-retry', { data: 1 });
        })
        .then(function() {
          publishOccurred = true;
        })
        .catch(done);
    });

    it('should handle advice handshake', function(done) {
      var publishOccurred = false;
      var client = this.client;

      client.subscribe('/datetime', function() {
          if (!publishOccurred) return;
          done();
        })
        .then(function() {
          return client.publish('/advice-handshake', { data: 1 });
        })
        .then(function() {
          publishOccurred = true;
        })
        .catch(done);
    });

  });

};
