'use strict';

var promiseUtil = require('../lib/util/promise-util');
var assert = require('assert');
var Promise = require('bluebird');

describe('promise-util', function() {
  describe('Synchronized', function() {

    beforeEach(function() {
      this.sync = new promiseUtil.Synchronized();
    });

    it('should synchronize access with a single item', function() {
      return this.sync.sync('1', function() {
          return 'a';
        })
        .bind(this)
        .then(function(result) {
          assert.deepEqual(this.sync._keys, {});
          assert.strictEqual(result, 'a');
        });
    });

    it('should propogate rejections', function() {
      return this.sync.sync('1', function() {
          throw new Error('Crash');
        })
        .bind(this)
        .then(function() {
          assert.ok('Expected failure');
        }, function(err) {
          assert.strictEqual(err.message, 'Crash');
        });
    });

    it('should propogate on queued items', function() {
      this.sync.sync('1', function() { return Promise.delay(1).return('a'); });
      return this.sync.sync('1', function() {
          return Promise.reject(new Error('Queued error'));
        })
        .bind(this)
        .then(function() {
          assert.ok(false, 'Expected exception');
        }, function(err) {
          assert.strictEqual(err.message, 'Queued error');
        })
        .then(function() {
          assert.deepEqual(this.sync._keys, {});
        });
    });

    it('should synchronize access with multiple items', function() {
      var count = 0;
      return Promise.all([
          this.sync.sync('1', function() { assert.strictEqual(count++, 0); return Promise.delay(2).return('a'); }),
          this.sync.sync('1', function() { assert.strictEqual(count++, 1); return 'b'; })
        ])
        .bind(this)
        .then(function(result) {
          assert.strictEqual(count, 2);
          assert.deepEqual(this.sync._keys, {});
          assert.deepEqual(result, ['a', 'b']);
        });
    });

    it('upstream rejections should be isolated', function() {
      var count = 0;

      this.sync.sync('1', function() {
        return Promise.reject(new Error('Random'));
      }).catch(function(err) {
        assert(err.message, 'Random');
        count++;
      });

      return this.sync.sync('1', function() { return 'b'; })
        .bind(this)
        .then(function(result) {
          assert.strictEqual(count, 1);

          assert.deepEqual(this.sync._keys, {});
          assert.deepEqual(result, 'b');
        });
    });

    it('upstream cancellations should be isolated', function() {
      var p1 = this.sync.sync('1', function() { return Promise.delay(3).return('a'); });
      var p2 = this.sync.sync('1', function() { return 'b'; });
      return Promise.delay(1)
        .bind(this)
        .then(function() {
          p1.cancel();
          return p2;
        })
        .then(function(result) {
          assert.deepEqual(result, 'b');
          assert.deepEqual(this.sync._keys, {});
        });
    });

  });

  describe('cancelBarrier', function() {

    it('should propogate resolve', function() {
      return promiseUtil.cancelBarrier(Promise.resolve('a'))
        .then(function(result) {
          assert.strictEqual(result, 'a');
        });
    });

    it('should propogate reject', function() {
      var e = new Error();
      return promiseUtil.cancelBarrier(Promise.reject(e))
        .then(function() {
          assert.ok(false);
        }, function(err) {
          assert.strictEqual(err, e);
        });
    });

    it('should prevent cancellations from propogating past the barrier', function() {
      var count = 0;
      var resolve;
      var p1 = new Promise(function(res, rej, onCancel) {
        resolve = res;
        onCancel(function() {
          count++;
        });
      });

      var p2 = promiseUtil.cancelBarrier(p1)
        .then(function(x) {
          return x;
        });

      p2.cancel();
      resolve('a');
      return p1
        .then(function(result) {
          assert.strictEqual(result, 'a');
        });
    });

  });

  describe('after', function() {

    it('should execute after resolve', function() {
      return promiseUtil.after(Promise.resolve('a'));
    });

    it('should execute after reject', function() {
      var e = new Error();
      return promiseUtil.after(Promise.reject(e));
    });

    it('should propogate when the source promise is cancelled', function() {
      var count = 0;
      var resolve;
      var p1 = new Promise(function(res, rej, onCancel) {
        resolve = res;
        onCancel(function() {
          count++;
        });
      });

      var p2 = promiseUtil.after(p1)
        .then(function() {
          assert.strictEqual(count, 1);
        });

      p1.cancel();

      return p2;
    });


    it('should execute in sequence', function() {
      var count = 0;
      var p1 = Promise.resolve('a');
      var p2 = promiseUtil.after(p1).then(function() { assert.strictEqual(count, 0); count++; });
      var p3 = promiseUtil.after(p2).then(function() { assert.strictEqual(count, 1); count++;  });
      var p4 = promiseUtil.after(p3).then(function() { assert.strictEqual(count, 2); count++; });
      return p4.then(function() {
        assert.strictEqual(count, 3);
      });
    });
  });


});
