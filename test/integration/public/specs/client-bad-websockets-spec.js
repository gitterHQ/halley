'use strict';

var fetch = require('../../fetch');

var OUTAGE_TIME = 5000;

module.exports = function() {
  describe('bad-websockets', function() {

    it('should deal with bad corporate proxies', function(done) {
      this.timeout(60000);

      var count = 0;
      var self = this;

      function cleanup(err) {
        fetch('/restore-websockets', {
          method: 'post',
          body: ""
        });
        done(err);
      }


      return fetch('/stop-websockets?timeout=' + OUTAGE_TIME, {
        method: 'post',
        body: ""
      })
      .then(function() {
        return self.client.subscribe('/datetime', function() {
          count++;

          if (count === 3) {
            cleanup();
          }
        });
      })
      .catch(cleanup);


    });


  });

};
