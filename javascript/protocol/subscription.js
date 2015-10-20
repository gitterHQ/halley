'use strict';

var Promise         = require('bluebird');
var extend          = require('../util/extend');

function Subscription(client, channels, callback, context) {
  this._client    = client;
  this._channels  = channels;
  this._callback  = callback;
  this._context   = context;
  this._cancelled = false;

  var self = this;
  this.promise = new Promise(function(resolve, reject) {
    self._resolve = resolve;
    self._reject = reject;
  });
}

Subscription.prototype = {
  cancel: function() {
    if (this._cancelled) return;
    this._client.unsubscribe(this._channels, this._callback, this._context);
    this._cancelled = true;
  },

  /* Alias for `cancel` */
  unsubscribe: function() {
    this.cancel();
  },

  /**
   * Make subscription a `thenable`
   */
  then: function(onResolve, onReject) {
    return this.promise.then(onResolve, onReject)
  },

  /**
   * Make subscription a `catchable`
   */
  catch: function(onReject) {
    return this.promise.catch(onReject)
  },

};

/* Statics */
extend(Subscription, {
  /* Allow the client to create a subscription with access to the promise */
  createDeferred: function(client, channels, callback, context) {
    var subscription = new Subscription(client, channels, callback, context);

    return {
      subscription: subscription,
      defer: {
        resolve: subscription._resolve,
        reject: subscription._reject,
      }
    };
  }
});

module.exports = Subscription;
