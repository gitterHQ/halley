'use strict';

var Faye           = require('../../faye');
var Faye_Transport = require('../transport');
var Faye_URI       = require('../../util/uri');
var classExtend    = require('../../util/class-extend');

var windowXDomainRequest = window.XDomainRequest;
var windowXMLHttpRequest = window.XMLHttpRequest;

var Faye_Transport_CORS = classExtend(Faye_Transport, {
  encode: function(messages) {
    return 'message=' + encodeURIComponent(Faye.toJSON(messages));
  },

  request: function(messages) {
    var XHRClass = windowXDomainRequest ? windowXMLHttpRequest : windowXMLHttpRequest,
        xhr      = new XHRClass(),
        headers  = this._dispatcher.headers,
        self     = this,
        key;

    xhr.open('POST', Faye_URI.stringify(this.endpoint), true);

    if (xhr.setRequestHeader) {
      xhr.setRequestHeader('Pragma', 'no-cache');
      for (key in headers) {
        if (!headers.hasOwnProperty(key)) continue;
        xhr.setRequestHeader(key, headers[key]);
      }
    }

    var cleanUp = function() {
      if (!xhr) return false;
      xhr.onload = xhr.onerror = xhr.ontimeout = xhr.onprogress = null;
      xhr = null;
    };

    xhr.onload = function() {
      var replies = null;
      try {
        replies = JSON.parse(xhr.responseText);
      } catch (e) {}

      cleanUp();

      if (replies)
        self._receive(replies);
      else
        self._handleError(messages);
    };

    xhr.onerror = xhr.ontimeout = function() {
      cleanUp();
      self._handleError(messages);
    };

    xhr.onprogress = function() {};
    xhr.send(this.encode(messages));
    return xhr;
  }
}, {
  isUsable: function(dispatcher, endpoint, callback, context) {
    if (Faye_URI.isSameOrigin(endpoint))
      return callback.call(context, false);

    if (windowXDomainRequest)
      return callback.call(context, endpoint.protocol === Faye.ENV.location.protocol);

    if (windowXMLHttpRequest) {
      var xhr = new windowXMLHttpRequest();
      return callback.call(context, xhr.withCredentials !== undefined);
    }
    return callback.call(context, false);
  }
});

Faye_Transport.register('cross-origin-long-polling', Faye_Transport_CORS);

module.exports = Faye_Transport_CORS;
