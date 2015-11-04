'use strict';

var Promise = require('bluebird');
var assert = require('assert');

function defer() {
  var d = {};

  d.promise = new Promise(function(resolve, reject) {
    d.resolve = resolve;
    d.reject = reject;
  });

  return d;
}

module.exports = function() {

  describe('publish', function() {

    it('should handle publishes', function(done) {
      var publishOccurred = false;
      var client = this.client;
      var d = defer();

      client.subscribe('/datetime', function() {
          if (!publishOccurred) return;
          d.resolve();
        })
        .then(function() {
          publishOccurred = true;
          return client.publish('/channel', { data: 1 });
        })
        .then(function() {
          return d.promise;
        })
        .nodeify(done);

    });

    it('should fail when a publish does not work', function(done) {
      return this.client.publish('/devnull', { data: 1 }, { attempts: 1 })
        .then(function() {
          throw new Error('Expected failure');
        }, function() {
          // Swallow the error
        })
        .nodeify(done);

    });

    it('should handle a large number of publish messages', function(done) {
      var count = 0;
      var self = this;
      return (function next() {
        count++;
        if (count >= 10) return;

        return self.client.publish('/channel', { data: count })
          .then(function() {
            return next();
          });
      })().nodeify(done);
    });

    it('should handle a parallel publishes', function(done) {
      var count = 0;
      var self = this;
      return (function next() {
        count++;
        if (count >= 20) return;

        return Promise.all([
            self.client.publish('/channel', { data: count }),
            self.client.publish('/channel', { data: count }),
            self.client.publish('/channel', { data: count }),
          ])
          .then(function() {
            return next();
          });
      })().nodeify(done);
    });

    it('should handle the cancellation of one publish without affecting another', function(done) {
      var p1 = this.client.publish('/channel', { data: 1 })
        .then(function() {
          throw new Error('Expected error');
        });

      var p2 = this.client.publish('/channel', { data: 2 });
      p1.cancel();

      return p2.then(function(v) {
          assert(v.successful);
          assert(p1.isCancelled());
          assert(p2.isFulfilled());
        })
        .nodeify(done);

    });


  });

};
