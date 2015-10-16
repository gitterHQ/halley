'use strict';

var Faye_Transport = require('../transport');
var Faye_URI       = require('../../util/uri');
var globalEvents   = require('../../util/global-events');
var debug          = require('debug-proxy')('faye:xhr');
var inherits       = require('inherits');
var extend         = require('../../util/extend');

var WindowXMLHttpRequest = window.XMLHttpRequest;

function Faye_Transport_XHR(dispatcher, endpoint) {
  Faye_Transport_XHR.super_.call(this, dispatcher, endpoint);
  this._sameOrigin = Faye_URI.isSameOrigin(endpoint);
}
inherits(Faye_Transport_XHR, Faye_Transport);

extend(Faye_Transport_XHR.prototype, {
  encode: function(messages) {
    var stringified = JSON.stringify(messages);
    if (this._sameOrigin) {
      // Same origin requests have proper content-type set, so they
      // can use application/json
      return stringified;
    } else {
      // CORS requests are posted as plain text
      return 'message=' + encodeURIComponent(stringified);
    }
  },

  request: function(messages) {
    var href = this.endpoint.href;
    var xhr = new WindowXMLHttpRequest();
    var self = this;

    xhr.open('POST', href, true);

    // Don't set headers for CORS requests
    if (this._sameOrigin) {
      xhr.setRequestHeader('Content-Type', 'application/json');
      xhr.setRequestHeader('Pragma', 'no-cache');
    }

    function abort() {
      if (!xhr) return;
      xhr.abort();
      cleanup();
    }

    function cleanup() {
      globalEvents.off('beforeunload', cleanup, xhr);
      xhr.onreadystatechange = null;
      xhr = null;
    }

    globalEvents.on('beforeunload', cleanup, xhr);

    xhr.onreadystatechange = function() {
      if (!xhr || xhr.readyState !== 4) return;

      var status = xhr.status;
      var text = xhr.responseText;

      cleanup();

      var successful = (status >= 200 && status < 300) || status === 304 || status === 1223;
      if (!successful) return self._handleError(messages);

      var replies;
      try {
        replies = JSON.parse(text);
      } catch (e) {
        debug('Unable to parse XHR response: %s', e)
      }

      if (replies) {
        self._receive(replies);
      } else {
        self._handleError(messages);
      }
    };

    xhr.send(this.encode(messages));
    return { abort: abort };
  }
});

/* Statics */
Faye_Transport_XHR.isUsable = function(dispatcher, endpoint, callback) {
  var isXhr2 = WindowXMLHttpRequest && WindowXMLHttpRequest.prototype.hasOwnProperty('withCredentials');
  var sameOrigin = Faye_URI.isSameOrigin(endpoint);

  callback(sameOrigin || isXhr2);
};

module.exports = Faye_Transport_XHR;
