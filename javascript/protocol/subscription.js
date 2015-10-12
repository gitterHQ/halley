'use strict';

var Faye_Deferrable = require('../mixins/deferrable');
var extend          = require('../util/extend');

function Faye_Subscription(client, channels, callback, context) {
  this._client    = client;
  this._channels  = channels;
  this._callback  = callback;
  this._context     = context;
  this._cancelled = false;
}

Faye_Subscription.prototype = {
  cancel: function() {
    if (this._cancelled) return;
    this._client.unsubscribe(this._channels, this._callback, this._context);
    this._cancelled = true;
  },

  unsubscribe: function() {
    this.cancel();
  }
};

extend(Faye_Subscription.prototype, Faye_Deferrable);

module.exports = Faye_Subscription;
