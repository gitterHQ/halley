'use strict';

var Faye           = require('../../faye');
var Faye_Transport = require('./transport');
var classExtend    = require('../../util/class-extend');

var Faye_Transport_NodeLocal = classExtend(Faye_Transport, {
  batching: false,

  request: function(messages) {
    messages = Faye.copyObject(messages);
    this.endpoint.process(messages, null, function(replies) {
      this._receive(Faye.copyObject(replies));
    }, this);
  }
}, {
  isUsable: function(client, endpoint, callback, context) {
    /* TODO: come up with a better way of knowing that the endpoint is the Faye Server */
    callback.call(context, !!endpoint.process);
  }
});

Faye_Transport.register('in-process', Faye_Transport_NodeLocal);

module.exports = Faye_Transport_NodeLocal;
