'use strict';

var Promise = require('bluebird');
var extend  = require('../util/externals').extend;


function Subscription(client, channel, callback, context) {
  this._client    = client;
  this._channel   = channel;
  this._callback  = callback;
  this._context   = context;
  this._established = false;
  this._cancelled = false;

  var self = this;
  this.promise = new Promise(function(resolve, reject) {
      self._resolve = resolve;
      self._reject = reject;
    })
    .then(function() {
      self._established = true;
    })
    .catch(function(err) {
      self._cancelled = true;
      throw err;
    });
}

Subscription.prototype = {
  cancel: Promise.method(function() {
    if (this._cancelled) return;
    this._cancelled = true;

    // If the subscription has not yet been established
    // Reject the promise now
    this.promise.cancel();

    if (!this._established) return;

    return this._client.unsubscribe(this._channel, this._callback, this._context);
  }),

  /* Alias for `cancel` */
  unsubscribe: function() {
    return this.cancel();
  },

  /**
   * Make subscription a `thenable`
   */
  then: function(onResolve, onReject) {
    return this.promise.then(onResolve, onReject);
  },

  /**
   * Make subscription a `catchable`
   */
  catch: function(onReject) {
    return this.promise.catch(onReject);
  },

};

/* Statics */
extend(Subscription, {
  /* Allow the client to create a subscription with access to the promise */
  createDeferred: function(client, channel, callback, context) {
    var subscription = new Subscription(client, channel, callback, context);

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
