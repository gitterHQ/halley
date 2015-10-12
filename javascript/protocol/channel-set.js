'use strict';

var Faye_Channel = require('./channel');

function Faye_Channel_Set() {
  this._channels = {};
}

Faye_Channel_Set.prototype = {
  getKeys: function() {
    var keys = [];
    for (var key in this._channels) keys.push(key);
    return keys;
  },

  remove: function(name) {
    delete this._channels[name];
  },

  hasSubscription: function(name) {
    return this._channels.hasOwnProperty(name);
  },

  subscribe: function(names, callback, context) {
    var name;
    for (var i = 0, n = names.length; i < n; i++) {
      name = names[i];
      var channel = this._channels[name] = this._channels[name] || new Faye_Channel(name);
      if (callback) channel.bind('message', callback, context);
    }
  },

  unsubscribe: function(name, callback, context) {
    var channel = this._channels[name];
    if (!channel) return false;
    channel.unbind('message', callback, context);

    if (channel.isUnused()) {
      this.remove(name);
      return true;
    } else {
      return false;
    }
  },

  distributeMessage: function(message) {
    var channels = Faye_Channel.expand(message.channel);

    for (var i = 0, n = channels.length; i < n; i++) {
      var channel = this._channels[channels[i]];
      if (channel) channel.trigger('message', message.data);
    }
  }

};

module.exports = Faye_Channel_Set;
