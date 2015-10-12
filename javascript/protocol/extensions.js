'use strict';

var debug = require('debug-proxy')('faye:extensible');

function Faye_Extensions() {

}

Faye_Extensions.prototype = {
  add: function(extension) {
    if (!this._extensions) {
      this._extensions = [];
    }
    this._extensions.push(extension);
  },

  remove: function(extension) {
    var extensions = this._extensions;
    if (!extensions) return;
    var i = extensions.length;
    while (i--) {
      if (extensions[i] !== extension) continue;
      extensions.splice(i,1);
    }
  },

  pipe: function(stage, message, callback) {
    debug('Passing through %s extensions: %j', stage, message);
    var extensions = this._extensions;

    if (!extensions) return callback(message);
    extensions = extensions.slice();

    (function pipe(message) {
      if (!message) return callback(message);

      var extension = extensions.shift();
      if (!extension) return callback(message);

      var fn = extension[stage];
      if (!fn) return pipe(message);
      fn(message, pipe);
    })(message);

  }
};

module.exports = Faye_Extensions;
