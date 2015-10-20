'use strict';

var Transport = require('../transport');
var uri       = require('../../util/uri');
var inherits  = require('inherits');
var extend    = require('lodash/object/extend');

var cbCount = 0;

function getCallbackName() {
  cbCount += 1;
  return '__jsonp' + cbCount + '__';
}

function JSONPTransport(dispatcher, endpoint) {
  JSONPTransport.super_.call(this, dispatcher, endpoint);
}
inherits(JSONPTransport, Transport);

extend(JSONPTransport.prototype, {
 encode: function(messages) {
    var url = extend({}, this.endpoint);
    url.query.message = JSON.stringify(messages);
    url.query.jsonp   = '__jsonp' + cbCount + '__';
    return uri.stringify(url);
  },

  request: function(messages) {
    var head         = document.getElementsByTagName('head')[0],
        script       = document.createElement('script'),
        callbackName = getCallbackName(),
        endpoint     = extend({ }, this.endpoint),
        self         = this;

    endpoint.query.message = JSON.stringify(messages);
    endpoint.query.jsonp   = callbackName;

    var cleanup = function() {
      if (!window[callbackName]) return false;
      window[callbackName] = undefined;
      try { delete window[callbackName]; } catch (e) {}
      script.parentNode.removeChild(script);
    };

    window[callbackName] = function(replies) {
      cleanup();
      self._receive(replies);
    };

    script.type = 'text/javascript';
    script.src  = uri.stringify(endpoint);
    head.appendChild(script);

    script.onerror = function() {
      cleanup();
      self._handleError(messages);
    };

    return { abort: cleanup };
  }
});

/* Statics */
JSONPTransport.isUsable = function(dispatcher, endpoint, callback) {
  callback(true);
};

module.exports = JSONPTransport;
