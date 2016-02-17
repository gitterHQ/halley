
'use strict';

var Promise = require('bluebird');

exports.Synchronized  = Synchronized;
exports.LazySingleton = LazySingleton;
exports.cancelBarrier = cancelBarrier;
exports.after         = after;
exports.Throttle      = Throttle;
exports.Batcher       = Batcher;
exports.Sequencer     = Sequencer;

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

  peek: function() {
    return this.value;
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
  },

  reset: function() {
    var keys = this._keys;
    this._keys = {};
    Object.keys(keys).forEach(function(key) {
      var pending = keys[key];
      pending.cancel();
    });
  }
};

function Throttle(fn, delay) {
  this._fn = fn;
  this._delay = delay;
  this._next = null;
  this._fireNow = null;
}

Throttle.prototype = {
  fire: function(forceImmediate) {
    if (this._next) {
      if (forceImmediate) {
        this._fireNow();
      }

      // Return a fork of the promise
      return this._next.tap(function() { });
    }

    var triggerPromise = new Promise(function(resolve) {
      this._fireNow = resolve;
    }.bind(this));

    var promise = this._next = Promise.any([triggerPromise, Promise.delay(this._delay)])
      .bind(this)
      .finally(function() {
        if (this._next === promise) {
          this._next = null;
          this._fireNow = null;
        }
      })
      .then(function() {
        return this._fn();
      });

    // Return a fork of the promise
    return promise.tap(function() {});
  }
};

function Batcher(fn, delay) {
  this._throttle = new Throttle(this._dequeue.bind(this), delay);
  this._fn = Promise.method(fn);
  this._pending = [];
}

Batcher.prototype = {
  add: function(value, forceImmediate) {
    var defer = { value: undefined, promise: undefined };

    var resolve, reject;
    var promise = new Promise(function(res, rej) {
      resolve = res;
      reject = rej;
    });

    defer.value = value;
    defer.promise = promise;

    this._pending.push(defer);

    this._throttle.fire(forceImmediate)
      .then(resolve, reject);

    return promise;
  },

  next: function(forceImmediate) {
    return this._throttle.fire(forceImmediate);
  },

  _dequeue: function() {
    var pending = this._pending;
    this._pending = [];

    var values = pending.filter(function(defer) {
      return !defer.promise.isCancelled();
    }).map(function(defer) {
      return defer.value;
    });

    if (!values.length) return;

    return this._fn(values);
  }
};

function Sequencer() {
  this._chain = null;
}

Sequencer.prototype = {
  chain: function(fn) {
    var next;
    if (!this._chain) {
      next = this._chain = Promise.try(fn);
    } else {
      next = this._chain = after(this._chain).then(fn);
    }

    return next.bind(this).finally(function() {
      if (next === this._chain) {
        this._chain = null;
      }
    });
  }
};
