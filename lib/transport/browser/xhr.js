'use strict';

var BatchingTransport = require('../batching-transport');
var globalEvents      = require('../../util/global-events');
var debug             = require('debug')('halley:xhr');
var inherits          = require('inherits');
var extend            = require('../../util/externals').extend;
var Promise           = require('bluebird');

var XML_HTTP_DONE = 4;

var WindowXMLHttpRequest = window.XMLHttpRequest;

function XHRTransport(dispatcher, endpoint) {
  XHRTransport.super_.call(this, dispatcher, endpoint);
}
inherits(XHRTransport, BatchingTransport);

extend(XHRTransport.prototype, {
  encode: function(messages) {
    return JSON.stringify(messages);
  },

  request: function(messages) {
    return new Promise(function(resolve, reject, onCancel) {
      var href = this.endpoint.href;
      var xhr = new WindowXMLHttpRequest();
      var self = this;

      xhr.open('POST', href, true);
      xhr.setRequestHeader('Content-Type', 'application/json');
      xhr.setRequestHeader('Pragma', 'no-cache');

      function cleanup() {
        if (!xhr) return;
        globalEvents.off('beforeunload', onUnload, xhr);
        xhr.onreadystatechange = null;
        xhr = null;
      }

      function onUnload() {
        reject(new Error('Environment unloading'));
        cleanup();
      }

      globalEvents.on('beforeunload', onUnload, xhr);

      xhr.onreadystatechange = function() {
        if (!xhr || xhr.readyState !== XML_HTTP_DONE) return;

        var status = xhr.status;
        var text = xhr.responseText;

        cleanup();

        /**
         * XMLHTTPRequest implementation in MSXML HTTP (at least in IE 8.0 on Windows XP SP3+)
         * does not handle HTTP responses with status code 204 (No Content) properly;
         * the `status' property has the value 1223.
         */
        var successful = (status >= 200 && status < 300) || status === 304 || status === 1223;
        if (!successful) return reject(new Error('HTTP Status ' + status));

        var replies;
        try {
          replies = JSON.parse(text);
        } catch (e) {
          debug('Unable to parse XHR response: %s', e);
          return reject(e);
        }

        if (replies) {
          resolve();
          self._receive(replies);
        } else {
          reject(new Error('No reply'));
        }
      };

      xhr.send(this.encode(messages));

      /* Cancel the XHR request */
      onCancel(function() {
        if (!xhr) return;
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

module.exports = XHRTransport;
