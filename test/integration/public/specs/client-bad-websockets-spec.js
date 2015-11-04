'use strict';

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
  describe('bad-websockets', function() {

    it('should deal with bad corporate proxies', function(done) {
      this.timeout(60000);

      var count = 0;
      var self = this;

      var d = defer();

      return serverControl.stopWebsockets(OUTAGE_TIME)
        .then(function() {
          return self.client.subscribe('/datetime', function() {
            count++;

            if (count === 3) {
              d.resolve();
            }
          });
        })
        .then(function() {
          return d.promise;
        })
        .nodeify(done);


    });


  });

};
