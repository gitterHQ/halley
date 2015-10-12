'use strict';

var Promise = require('bluebird');
var deprecate = require('util-deprecate');

/** TODO: remove this */
var Faye_Deferrable = {
  then: deprecate(function(callback, errback) {
    var self = this;
    if (!this._promise)
      this._promise = new Promise(function(fulfill, reject) {
        self._fulfill = fulfill;
        self._reject  = reject;
      });

    if (arguments.length === 0)
      return this._promise;
    else
      return this._promise.then(callback, errback);
  }, 'Faye_Deferrable.then() is deprecated'),

  callback: deprecate(function(callback, context) {
    return this.then(function(value) { callback.call(context, value); });
  }, 'Faye_Deferrable.callback() is deprecated'),

  errback: deprecate(function(callback, context) {
    return this.then(null, function(reason) { callback.call(context, reason); });
  }, 'Faye_Deferrable.errback() is deprecated'),

  setDeferredStatus: deprecate(function(status, value) {
    this.then();

    if (status === 'succeeded')
      this._fulfill(value);
    else if (status === 'failed')
      this._reject(value);
    else
      delete this._promise;
  }, 'Faye_Deferrable.setDeferredStatus() is deprecated')
};

module.exports = Faye_Deferrable;
