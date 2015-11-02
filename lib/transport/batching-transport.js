'use strict';

var Promise   = require('bluebird');
var Channel   = require('../protocol/channel');
var debug     = require('debug-proxy')('faye:batching-transport');
var inherits  = require('inherits');
var Transport = require('./transport');
var extend    = require('../util/externals').extend;

var MAX_DELAY = 0;

function BatchingTransport(dispatcher, endpoint) {
  BatchingTransport.super_.call(this, dispatcher, endpoint);

  this._dispatcher       = dispatcher;
  this._outbox           = [];
  this._nextBatchPromise = null;
}
inherits(BatchingTransport, Transport);

extend(BatchingTransport.prototype, {
  close: function() {
    // consider: do we cancel the next batch?
  },

  /* Returns a promise of a request */
  sendMessage: function(message) {
    var requestSize = this.encode(this._outbox.concat(message)).length;

    // If this message is going to cause the request to exceed the maximum request size....
    if (this._outbox.length && requestSize > this._dispatcher.maxRequestSize) {
      this._triggerResolve();

      return this._nextBatch()
        .bind(this)
        .then(function() {
          // Resend after the current batch has gone out
          return this.sendMessage(message);
        });
    }

    this._outbox.push(message);

    if (message.channel === Channel.CONNECT) {
      this._connectMessage = message;
    }

    var promise = this._nextBatch();

    /* Call this after next batch to ensure _triggerResolve is available */
    if (message.channel === Channel.HANDSHAKE) {
      // Flush immediately for handshakes
      this._triggerResolve();
    }

    return promise;
  },

  /**
   * Returns a promise of the next flush, or creates one
   */
  _nextBatch: function() {
    if (this._nextBatchPromise) return this._nextBatchPromise;

    var triggerPromise = new Promise(function(resolve) {
      this._triggerResolve = resolve;
    }.bind(this));

    var promise = this._nextBatchPromise = Promise.any([triggerPromise, Promise.delay(MAX_DELAY)])
      .bind(this)
      .finally(function() {
        this._nextBatchPromise = null;
        this._triggerResolve = null;
      })
      .then(function() {
        var outbox = this._outbox;
        this._outbox = [];

        var connectMessage = this._connectMessage;
        this._connectMessage = null;

        debug('Flushing batch of %s messages', outbox.length);

        if (outbox.length > 1 && connectMessage) {
          // If we have sent out a request. don't
          // long poll on the response. Instead request
          // an immediate response from the server
          connectMessage.advice = { timeout: 0 };
        }

        return this.request(outbox);
      });

    return promise;
  }

});

module.exports = BatchingTransport;
