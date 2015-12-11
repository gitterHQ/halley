'use strict';

var Promise = require('bluebird');

function Subscription(client, channel, callback, context) {
  this._client    = client;
  this._channel   = channel;
  this._callback  = callback;
  this._context   = context;
  this._cancelled = false;
}

Subscription.prototype = {
  unsubscribe: Promise.method(function() {
    if (this._cancelled) return;
    this._cancelled = true;

    return this._client.unsubscribe(this._channel, this._callback, this._context);
  }),

};

module.exports = Subscription;
