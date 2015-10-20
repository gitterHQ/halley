'use strict';

/* http://stackoverflow.com/questions/1382107/whats-a-good-way-to-extend-error-in-javascript/27925672#27925672 */
function BayeuxError(code, params, message) {
  this.name = 'FayeError';

  if (!Error.captureStackTrace) {
    Error.captureStackTrace(this, this.constructor);
  } else {
    var err = new Error();
    var stack;
    Object.defineProperty(this, 'stack', {
      configurable: true,
      enumerable: false,
      get: function() {
        if (stack !== undefined) return stack;
        stack = err.stack;
        return stack;
      },
      set: function(value) {
        stack = value;
      }
    });

    this.stack = (new Error()).stack;
  }
  this.code    = code;
  this.params  = Array.prototype.slice.call(params);
  this.message = message;
}

BayeuxError.prototype = new Error();
BayeuxError.prototype.name = BayeuxError;
BayeuxError.prototype.constructor = BayeuxError;

BayeuxError.prototype.toString = function() {
  return this.code + ':' +
         this.params.join(',') + ':' +
         this.message;
};

BayeuxError.parse = function(message) {
  message = message || '';
  var match = /^([\d+]):([^:]*):(.*)$/.exec(message);
  if (!match) return new BayeuxError(null, [], message);

  var code   = parseInt(match[1]);
  var params = match[2].split(',');
  var m      = match[3];

  return new BayeuxError(code, params, m);
};

// http://code.google.com/p/cometd/wiki/BayeuxCodes
var errors = {
  versionMismatch:  [300, 'Version mismatch'],
  conntypeMismatch: [301, 'Connection types not supported'],
  extMismatch:      [302, 'Extension mismatch'],
  badRequest:       [400, 'Bad request'],
  clientUnknown:    [401, 'Unknown client'],
  parameterMissing: [402, 'Missing required parameter'],
  channelForbidden: [403, 'Forbidden channel'],
  channelUnknown:   [404, 'Unknown channel'],
  channelInvalid:   [405, 'Invalid channel'],
  extUnknown:       [406, 'Unknown extension'],
  publishFailed:    [407, 'Failed to publish'],
  serverError:      [500, 'Internal server error']
};

Object.keys(errors).forEach(function(name) {
  var errorCode = errors[name][0];
  var description = errors[name][1];

  BayeuxError[name] = function() {
    return new this(errorCode, arguments, description).toString();
  };
});

module.exports = BayeuxError;
