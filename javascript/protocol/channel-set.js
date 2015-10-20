'use strict';

var Channel = require('./channel');

function ChannelSet() {
  this._channels = {};
}

ChannelSet.prototype = {
  getKeys: function() {
    return Object.keys(this._channels);
  },

  remove: function(name) {
    delete this._channels[name];
  },

  hasSubscription: function(name) {
    return this._channels.hasOwnProperty(name);
  },

  subscribe: function(name, callback, context) {
    var channel = this._channels[name];
    if (!channel) {
      channel = this._channels[name] = new Channel(name);
    }

    if (callback) channel.on('message', callback, context);
  },

  unsubscribe: function(name, callback, context) {
    var channel = this._channels[name];
    if (!channel) return false;
    channel.off('message', callback, context);

    if (channel.isUnused()) {
      this.remove(name);
      return true;
    } else {
      return false;
    }
  },

  distributeMessage: function(message) {
    var channels = Channel.expand(message.channel);

    for (var i = 0, n = channels.length; i < n; i++) {
      var channel = this._channels[channels[i]];
      if (channel) channel.trigger('message', message.data);
    }
  }

};

module.exports = ChannelSet;
