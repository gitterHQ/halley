'use strict';

var BatchingTransport = require('../batching-transport');
var debug             = require('debug')('halley:xhr');
var inherits          = require('inherits');
var extend            = require('../../util/externals').extend;
var Promise           = require('bluebird');

var XML_HTTP_HEADERS_RECEIVED = 2;
var XML_HTTP_DONE = 4;

var WindowXMLHttpRequest = window.XMLHttpRequest;

function XHRTransport(dispatcher, endpoint) {
  XHRTransport.super_.call(this, dispatcher, endpoint);
  this._sameOrigin = isSameOrigin(endpoint);
}
inherits(XHRTransport, BatchingTransport);

extend(XHRTransport.prototype, {
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
    return new Promise(function(resolve, reject, onCancel) {
      var href = this.endpoint.href;
      var xhr = new WindowXMLHttpRequest();
      var self = this;

      xhr.open('POST', href, true);

      // Don't set headers for CORS requests
      if (this._sameOrigin) {
        xhr.setRequestHeader('Content-Type', 'application/json');
        xhr.setRequestHeader('Pragma', 'no-cache');
      }

      function cleanup() {
        if (!xhr) return;
        xhr.onreadystatechange = null;
        xhr = null;
      }

      xhr.onreadystatechange = function() {
        if (!xhr) return;

        var readyState = xhr.readyState;

        if (readyState !== XML_HTTP_DONE &&
            readyState !== XML_HTTP_HEADERS_RECEIVED) return;

        /**
         * XMLHTTPRequest implementation in MSXML HTTP (at least in IE 8.0 on Windows XP SP3+)
         * does not handle HTTP responses with status code 204 (No Content) properly;
         * the `status' property has the value 1223.
         */
        var status = xhr.status;
        var successful = (status >= 200 && status < 300) || status === 304 || status === 1223;
        if (successful) {
          resolve();
        } else {
          reject(new Error('HTTP Status ' + status));
          return;
        }

        if (xhr.readyState == XML_HTTP_HEADERS_RECEIVED) {
          return;
        }

        /* readyState is XML_HTTP_DONE */
        var text = xhr.responseText;
        cleanup();

        var replies;
        try {
          replies = JSON.parse(text);
        } catch (e) {
          debug('Unable to parse XHR response: %s', e);
          self._dispatcher.transportDown(self);
          return;
        }

        if (replies) {
          self._receive(replies);
        } else {
          self._dispatcher.transportDown(self);
        }
      };

      xhr.send(this.encode(messages));

      /* Cancel the XHR request */
      onCancel(function() {
        if (!xhr || xhr.readyState === XML_HTTP_DONE) return;
        xhr.onreadystatechange = null;
        xhr.abort();
        cleanup();
      });

    }.bind(this));
  }
});

/* Statics */
XHRTransport.isUsable = function() {
  return true;
};

function isSameOrigin(uri) {
  var location = window.location;
  if (!location) return false;
  return uri.protocol === location.protocol &&
         uri.hostname === location.hostname &&
         uri.port     === location.port;
}


module.exports = XHRTransport;
