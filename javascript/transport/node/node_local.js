'use strict';

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
    var self = this;
    this.endpoint.process(messages, null, function(replies) {
      self._receive(replies);
    });
  }
});

/* Statics */
extend(Faye_Transport_NodeLocal, {
  isUsable: function(client, endpoint, callback) {
    /* TODO: come up with a better way of knowing that the endpoint is the Faye Server */
    callback(!!endpoint.process);
  }
});

module.exports = Faye_Transport_NodeLocal;
