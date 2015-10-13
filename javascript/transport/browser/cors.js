'use strict';

var Faye           = require('../../faye');
var Faye_Transport = require('../transport');
var Faye_URI       = require('../../util/uri');
var inherits       = require('inherits');
var extend         = require('../../util/extend');

/**
 * NOT CURRENTLY USED. XHR does the trick
 */

var WindowXDomainRequest = window.XDomainRequest;
var WindowXMLHttpRequest = window.XMLHttpRequest;

function Faye_Transport_CORS(dispatcher, endpoint) {
  Faye_Transport_CORS.super_.call(this, dispatcher, endpoint);
}
inherits(Faye_Transport_CORS, Faye_Transport);

extend(Faye_Transport_CORS.prototype, {
  encode: function(messages) {
    return 'message=' + encodeURIComponent(Faye.toJSON(messages));
  },

  request: function(messages) {
    var XHRClass = WindowXDomainRequest ? WindowXMLHttpRequest : WindowXMLHttpRequest,
        xhr      = new XHRClass(),
        self     = this;

    xhr.open('POST', Faye_URI.stringify(this.endpoint), true);

    var cleanUp = function() {
      if (!xhr) return;
      xhr.onload = xhr.onerror = xhr.ontimeout = xhr.onprogress = null;
      xhr = null;
    };

    xhr.onload = function() {
      var replies = null;
      try {
        replies = JSON.parse(xhr.responseText);
      } catch (e) {
      }

      cleanUp();

      if (replies) {
        self._receive(replies);
      } else {
        self._handleError(messages);
      }
    };

    xhr.onerror = xhr.ontimeout = function() {
      cleanUp();
      self._handleError(messages);
    };

    xhr.onprogress = function() {};
    xhr.send(this.encode(messages));
    return xhr;
  }
});

/* Statics */
extend(Faye_Transport_CORS, {
  isUsable: function(dispatcher, endpoint, callback) {
    if (Faye_URI.isSameOrigin(endpoint)) {
      return callback(false);
    }

    if (WindowXDomainRequest) {
      return callback(endpoint.protocol === Faye.ENV.location.protocol);
    }

    if (WindowXMLHttpRequest) {
      var xhr = new WindowXMLHttpRequest();
      return callback(xhr.withCredentials !== undefined);
    }

    return callback(false);
  }
});

module.exports = Faye_Transport_CORS;
