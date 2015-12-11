'use strict';

var Channel      = require('./channel');
var Subscription = require('./subscription');
var Promise      = require('bluebird');
var Synchronized = require('../util/promise-util').Synchronized;
var debug        = require('debug')('halley:channel-set');

function ChannelSet(onSubscribe, onUnsubscribe) {
  this._onSubscribe = onSubscribe;
  this._onUnsubscribe = onUnsubscribe;
  this._channels = {};
  this._pending = new Synchronized();
}

ChannelSet.prototype = {
  getKeys: function() {
    return Object.keys(this._channels);
  },

  /**
   * Returns a promise of a subscription
   */
  subscribe: function(name, onMessage, context) {
    // All subscribes and unsubscribes are synchonized by
    // the channel name to prevent inconsistent state
    return this._pending.sync(name, function() {
      return this._doSubscribe(name, onMessage, context);
    }.bind(this));
  },

  unsubscribe: function(name, onMessage, context) {
    // All subscribes and unsubscribes are synchonized by
    // the channel name to prevent inconsistent state
    return this._pending.sync(name, function() {
      return this._doUnsubscribe(name, onMessage, context);
    }.bind(this));
  },

  _doSubscribe: Promise.method(function(name, onMessage, context) {
    debug('subscribe: channel=%s', name);

    var existingChannel = this._channels[name];

    // If the client is resubscribing to an existing channel
    // there is no need to re-issue to message to the server
    if (existingChannel) {
      debug('subscribe: existing: channel=%s', name);

      var subscription = new Subscription(this, name, onMessage, context);
      if (onMessage) existingChannel.on('message', onMessage, context);
      return subscription;
    }

    return this._onSubscribe(name)
      .bind(this)
      .then(function() {
        debug('subscribe: success: channel=%s', name);

        var subscription = new Subscription(this, name, onMessage, context);
        var channel = this._channels[name] = new Channel(name);
        if (onMessage) channel.on('message', onMessage, context);

        return subscription;
      });
  }),

  _doUnsubscribe: Promise.method(function(name, onMessage, context) {
    var channel = this._channels[name];
    if (!channel) return;
    channel.off('message', onMessage, context);

    // Do not perform the `unsubscribe` if the channel is still being used
    // by other subscriptions
    if (!channel.isUnused()) return;

    delete this._channels[name];

    return this._onUnsubscribe(name);
  }),

  distributeMessage: function(message) {
    var channels = Channel.expand(message.channel);

    for (var i = 0, n = channels.length; i < n; i++) {
      var channel = this._channels[channels[i]];
      if (channel) channel.trigger('message', message.data);
    }
  }

};

module.exports = ChannelSet;
