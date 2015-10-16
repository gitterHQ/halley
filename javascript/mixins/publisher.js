'use strict';

var Events = require('backbone-events-standalone');
var extend = require('../util/extend');

var Faye_Publisher = {
  countListeners: function(eventType) {
    // This is a dirty implementation which relies on the underlying implementatio
    // of Backbone.Events to remain the same.
    // Consider an alternative
    var events = this._events;
    if (!events) return 0;

    var handler = events[eventType];
    if (!handler) return 0;

    if (Array.isArray(handler)) {
      // If we've already got an array, just append.
      return handler.length;
    } else {
      // Optimize the case of one listener. Don't need the extra array object.
      return 1;
    }
  },
};

extend(Faye_Publisher, Events);

module.exports = Faye_Publisher;
