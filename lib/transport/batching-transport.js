'use strict';

var Timeouts  = require('../util/timeouts');
var Promise   = require('bluebird');
var Channel   = require('../protocol/channel');
var debug     = require('debug-proxy')('faye:transport');
var extend    = require('lodash/object/extend');
var inherits  = require('inherits');
var Transport = require('./transport');

var MAX_DELAY = 0;

function BatchingTransport(dispatcher, endpoint) {
  BatchingTransport.super_.call(this, dispatcher, endpoint);

  this._dispatcher = dispatcher;
  this._outbox     = [];

  this.timeouts    = new Timeouts(this);
}
inherits(BatchingTransport, Transport);

extend(BatchingTransport.prototype, {
  close: function() {
  },

  /* Returns a promise of a request */
  sendMessage: function(message) {
    var self = this;

    debug('Client %s sending message to %j: %j', this._dispatcher.clientId, this.endpoint, message);

    this._outbox.push(message);
    this._flushLargeBatch();
    if (!this._promise) {
      this._promise = new Promise(function(resolve, reject) {
        self._resolve = resolve;
        self._reject = reject;
      });
    }

    // For a handshake, flush almost immediately
    if (message.channel === Channel.HANDSHAKE) {
      this.timeouts.add('publish', 10, this._flush);
      return this._promise;
    }

    if (message.channel === Channel.CONNECT) {
      this._connectMessage = message;
    }

    this.timeouts.add('publish', MAX_DELAY, this._flush);
    return this._promise;
  },

  _flush: function() {
    this.timeouts.remove('publish');

    if (this._outbox.length > 1 && this._connectMessage) {
      // If we have sent out a request. don't
      // long poll on the response. Instead request
      // an immediate response from the server
      this._connectMessage.advice = { timeout: 0 };
    }

    this._resolve(this.request(this._outbox));
    this._promise = this._resolve = this._reject = null;

    this._connectMessage = null;
    this._outbox = [];
  },

  _flushLargeBatch: function() {
    var string = this.encode(this._outbox);
    if (string.length < this._dispatcher.maxRequestSize) return;
    var last = this._outbox.pop();
    this._flush();
    if (last) this._outbox.push(last);
   },


});

module.exports = BatchingTransport;
