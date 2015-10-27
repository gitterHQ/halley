'use strict';

module.exports = function() {

  describe('publish', function() {

    it('should handle publishes', function(done) {
      var publishOccurred = false;
      var client = this.client;

      client.subscribe('/datetime', function(message) {
          if (!publishOccurred) return;
          done();
        })
        .then(function() {
          publishOccurred = true;
          return client.publish('/channel', { data: 1 });
        })
        .catch(done);

    });

    it('should fail when a publish does not work', function(done) {
      this.timeout(60000);
      
      return this.client.publish('/devnull', { data: 1 }, { attempts: 1 })
        .then(function() {
          done(new Error('Expected failure'));
        }, function() {
          done();
        });

    });


  });

};
