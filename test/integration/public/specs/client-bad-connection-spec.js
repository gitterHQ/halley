'use strict';

var assert = require('assert');
var serverControl = require('../server-control');
var Promise = require('bluebird');

function defer() {
  var d = {};

  d.promise = new Promise(function(resolve, reject) {
    d.resolve = resolve;
    d.reject = reject;
  });

  return d;
}
var OUTAGE_TIME = 5000;

module.exports = function() {
  describe('bad-connection', function() {

    it('should deal with dropped packets', function(done) {
      var count = 0;
      var postOutageCount = 0;
      var outageTime;
      var outageGraceTime;

      var d = defer();
      this.client.subscribe('/datetime', function() {
        count++;

        if (count === 1) {
          return serverControl.networkOutage(OUTAGE_TIME)
          .then(function() {
            outageTime = Date.now();
            outageGraceTime = Date.now() + 1000;
          })
          .catch(function(err) {
            d.reject(err);
          });
        }

        if (!outageTime) return;
        if (outageGraceTime >= Date.now()) return;

        postOutageCount++;

        if (postOutageCount >= 3) {
          assert(Date.now() - outageTime >= (OUTAGE_TIME * 0.8));
          d.resolve();
        }
      }).promise
      .then(function() {
        return d.promise;
      })
      .nodeify(done);
    });


  });

};
