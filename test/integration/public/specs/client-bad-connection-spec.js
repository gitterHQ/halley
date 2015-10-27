'use strict';

var assert = require('assert');
var fetch = require('../../fetch');

var OUTAGE_TIME = 5000;

module.exports = function() {
  describe('bad-connection', function() {

    it('should deal with dropped packets', function(done) {
      this.timeout(60000);

      var count = 0;
      var postOutageCount = 0;
      var outageTime;
      var outageGraceTime;

      this.client.subscribe('/datetime', function() {
        count++;

        if (count === 1) {
          return fetch('/network-outage?timeout=' + OUTAGE_TIME, {
            method: 'post',
            body: ""
          })
          .then(function() {
            outageTime = Date.now();
            outageGraceTime = Date.now() + 1000;
            console.log('Outage');
          })
          .catch(done);
        }

        if (!outageTime) return;
        if (outageGraceTime >= Date.now()) return;

        console.log('Receiving messages again');

        postOutageCount++;

        if (postOutageCount >= 3) {
          console.log('OUTAGE TIME IS ', Date.now() - outageTime);
          assert(Date.now() - outageTime >= (OUTAGE_TIME * 0.8));
          done();
        }
      });
    });


  });

};
