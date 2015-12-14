
'use strict';

var Promise = require('bluebird');

exports.Synchronized = Synchronized;
exports.LazySingleton = LazySingleton;
exports.after = after;
exports.cancelBarrier = cancelBarrier;

/**
 * Returns a promise which will always resolve after the provided
 * promise is no longer pending. Will resolve even if the upstream
 * promise is cancelled.
 */
function after(promise) {
  if (!promise.isPending()) return Promise.resolve();

  return new Promise(function(resolve) {
    promise.finally(function() {
      return resolve();
    });
  });
}

/* Prevent a cancel from propogating upstream */
function cancelBarrier(promise) {
  if (!promise.isPending()) return promise;

  return new Promise(function(resolve, reject) {
    return promise.then(resolve, reject);
  });
}

function LazySingleton(factory) {
  this.value = null;
  this._factory = factory;
}

LazySingleton.prototype = {
  get: function() {
    var value = this.value;
    if (value) {
      return value;
    }

    value = this.value = Promise.try(this._factory);

    return value
      .bind(this)
      .finally(function() {
        if (value !== this.value) return;

        if (!value.isFulfilled()) {
          this.value = null;
        }
      });
  },

  clear: function() {
    this.value = null;
  }
};

function Synchronized() {
  this._keys = {};
}

Synchronized.prototype = {
  sync: function(key, fn) {
    var keys = this._keys;
    var pending = keys[key];

    if (pending) {
      // Append to the end and wait
      pending = keys[key] = after(pending)
        .bind(this)
        .then(function() {
          if (pending === keys[key]) {
            delete keys[key];
          }

          return fn();
        });
    } else {
      // Execute immediately
      pending = keys[key] = Promise.try(fn)
        .finally(function() {
          if (pending === keys[key]) {
            delete keys[key];
          }
        });
    }

    return pending;
  }
};
