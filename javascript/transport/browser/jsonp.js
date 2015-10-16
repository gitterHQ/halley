'use strict';

var Faye_Transport = require('../transport');
var Faye_URI       = require('../../util/uri');
var inherits       = require('inherits');
var extend         = require('../../util/extend');

var cbCount = 0;

function getCallbackName() {
  cbCount += 1;
  return '__jsonp' + cbCount + '__';
}

function Faye_Transport_JSONP(dispatcher, endpoint) {
  Faye_Transport_JSONP.super_.call(this, dispatcher, endpoint);
}
inherits(Faye_Transport_JSONP, Faye_Transport);

extend(Faye_Transport_JSONP.prototype, {
 encode: function(messages) {
    var url = extend({}, this.endpoint);
    url.query.message = JSON.stringify(messages);
    url.query.jsonp   = '__jsonp' + cbCount + '__';
    return Faye_URI.stringify(url);
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
    script.src  = Faye_URI.stringify(endpoint);
    head.appendChild(script);

    script.onerror = function() {
      cleanup();
      self._handleError(messages);
    };

    return { abort: cleanup };
  }
});

/* Statics */
Faye_Transport_JSONP.isUsable = function(dispatcher, endpoint, callback) {
  callback(true);
};

module.exports = Faye_Transport_JSONP;
