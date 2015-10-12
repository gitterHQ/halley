'use strict';

var Faye           = require('../../faye');
var Faye_Transport = require('./transport');
var inherits       = require('inherits');
var extend         = require('../../util/extend');

function Faye_Transport_NodeLocal(dispatcher, endpoint) {
  Faye_Transport_NodeLocal.super_.call(this, dispatcher, endpoint);
}
inherits(Faye_Transport_NodeLocal, Faye_Transport);

extend(Faye_Transport_NodeLocal.prototype, {
  batching: false,

  request: function(messages) {
    messages = Faye.copyObject(messages);
    this.endpoint.process(messages, null, function(replies) {
      this._receive(Faye.copyObject(replies));
    }, this);
  }
});

/* Statics */
extend(Faye_Transport_NodeLocal, {
  isUsable: function(client, endpoint, callback, context) {
    /* TODO: come up with a better way of knowing that the endpoint is the Faye Server */
    callback.call(context, !!endpoint.process);
  }
});

Faye_Transport.register('in-process', Faye_Transport_NodeLocal);

module.exports = Faye_Transport_NodeLocal;
