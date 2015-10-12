'use strict';

var Faye_Deferrable = require('../mixins/deferrable');
var classExtend     = require('../util/class-extend');

var Faye_Subscription = classExtend({
  initialize: function(client, channels, callback, context) {
    this._client    = client;
    this._channels  = channels;
    this._callback  = callback;
    this._context     = context;
    this._cancelled = false;
  },

  cancel: function() {
    if (this._cancelled) return;
    this._client.unsubscribe(this._channels, this._callback, this._context);
    this._cancelled = true;
  },

  unsubscribe: function() {
    this.cancel();
  }
}, null, [
  Faye_Deferrable
]);

module.exports = Faye_Subscription;
