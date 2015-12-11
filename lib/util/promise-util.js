
'use strict';

var Promise = require('bluebird');

exports.Synchronized = Synchronized;
exports.Singleton = Singleton;
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

function Singleton(factory) {
  this._instance = null;
  this._factory = factory;
}

Singleton.prototype = {
  get: function() {
    var i = this._instance;
    if (i) {
      if (i.isFulfilled() || this._instance.isPending()) {
        return i;
      }

      // Remove
      i = this._instance = null;
    }

    i = this._instance = Promise.try(this._factory);

    return i.bind(this)
      .finally(function() {
        if (i !== this._instance) return;

        if (!i.isFulfilled()) {
          this._instance = null;
        }
      });

  },
  clear: function() {
    this._instance = null;
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
