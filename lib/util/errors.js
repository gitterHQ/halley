'use strict';

var inherits = require('inherits');

function defineProperty(obj, name, value) {
  Object.defineProperty(obj, name, {
    value: value,
    configurable: true,
    enumerable: false,
    writable: true
  });
}

function BayeuxError(message) {
  if (!(this instanceof BayeuxError)) return new BayeuxError(message);

  var code, params, m;
  message = message || '';
  var match = /^([\d]+):([^:]*):(.*)$/.exec(message);

  if (match) {
    code   = parseInt(match[1], 10);
    params = match[2].split(',');
    m      = match[3];
  }

  defineProperty(this, "message", m || message || "bayeuxError");
  defineProperty(this, "name", "BayeuxError");
  defineProperty(this, "code", code);
  defineProperty(this, "params", params);
  defineProperty(this, "bayeuxMessage", m);

  if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
  } else {
      Error.call(this);
  }
}
inherits(BayeuxError, Error);

function TransportError(message) {
  if (!(this instanceof TransportError)) return new TransportError(message);

  defineProperty(this, "message", message);
  defineProperty(this, "name", "TransportError");

  if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
  } else {
      Error.call(this);
  }
}
inherits(TransportError, Error);

module.exports = {
  BayeuxError: BayeuxError,
  TransportError: TransportError
};
