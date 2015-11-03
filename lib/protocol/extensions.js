'use strict';

var Promise = require('bluebird');

function Faye_Extensions() {
  this._extensions = [];
}

Faye_Extensions.prototype = {
  add: function(extension) {
    this._extensions.push(extension);
  },

  remove: function(extension) {
    this._extensions = this._extensions.filter(function(e) {
      return e !== extension;
    });
  },

  pipe: function(stage, message) {
    var extensions = this._extensions;

    if (!extensions || extensions.length === 0) return Promise.resolve(message);

    return Promise.reduce(extensions, function(message, extension) {
      if (!extension) return message;

      var fn = extension[stage];
      if (!fn) return message;

      return new Promise(function(resolve) {
        fn.call(extension, message, resolve);
      });

    }, message);
  }
};

module.exports = Faye_Extensions;
