'use strict';

var BatchingTransport = require('../batching-transport');
var uri               = require('../../util/uri');
var inherits          = require('inherits');
var extend            = require('../../util/externals').extend;
var Promise           = require('bluebird');
var cbCount = 0;

function getCallbackName() {
  cbCount += 1;
  return '__jsonp' + cbCount + '__';
}

function JSONPTransport(dispatcher, endpoint) {
  JSONPTransport.super_.call(this, dispatcher, endpoint);
}
inherits(JSONPTransport, BatchingTransport);

extend(JSONPTransport.prototype, {
 encode: function(messages) {
    var url = extend({}, this.endpoint);
    url.query.message = JSON.stringify(messages);
    url.query.jsonp   = '__jsonp' + cbCount + '__';
    return uri.stringify(url);
  },

  request: function(messages) {
    return new Promise(function(resolve, reject, onCancel) {

      var head         = document.getElementsByTagName('head')[0];
      var script       = document.createElement('script');
      var callbackName = getCallbackName();
      var endpoint     = extend({ }, this.endpoint);
      var self         = this;

      endpoint.query.message = JSON.stringify(messages);
      endpoint.query.jsonp   = callbackName;

      var cleanup = function(remove) {
        if (!window[callbackName]) return false;
        if (remove) {
          window[callbackName] = null;
          try { delete window[callbackName]; } catch(e) {}
        } else {
          // Prevent global errors
          window[callbackName] = function() {};
        }
        if (script.parentElement) {
          script.parentElement.removeChild(script);
        }
      };

      window[callbackName] = function(replies) {
        cleanup(true);
        resolve();
        self._receive(replies);
      }.bind(this);

      script.type = 'text/javascript';
      script.src  = uri.stringify(endpoint);
      head.appendChild(script);

      script.onerror = function() {
        cleanup(true);
        reject(new Error('jsonp failed'));
      };

      onCancel(function() {
        cleanup(false);
      });

    }.bind(this));

  }
});

/* Statics */
JSONPTransport.isUsable = function(/*endpoint*/) {
  return true;
};

module.exports = JSONPTransport;
