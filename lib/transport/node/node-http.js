'use strict';

var BatchingTransport = require('../batching-transport');
var http              = require('http');
var https             = require('https');
var inherits          = require('inherits');
var extend            = require('../../util/externals').extend;
var Promise           = require('bluebird');

function NodeHttpTransport(dispatcher, endpoint, advice) {
  NodeHttpTransport.super_.call(this, dispatcher, endpoint, advice);

  this._endpointSecure = this.endpoint.protocol === 'https:';
  this._httpClient     = this._endpointSecure ? https : http;
}
inherits(NodeHttpTransport, BatchingTransport);

extend(NodeHttpTransport.prototype, {
  encode: function(messages) {
    return JSON.stringify(messages);
  },

  request: function(messages) {
    return new Promise(function(resolve, reject, onCancel) {
      var content = new Buffer(this.encode(messages), 'utf8');
      var params  = this._buildParams(content);
      var request = this._httpClient.request(params);
      var self    = this;

      request.on('response', function(response) {

        var status = response.statusCode;
        var successful = (status >= 200 && status < 300);
        if (successful) {
          resolve();
        } else {
          reject(new Error('HTTP Status ' + status));
          return;
        }

        var body = '';

        response.setEncoding('utf8');
        response.on('data', function(chunk) { body += chunk; });

        response.on('end', function() {
          var replies = null;

          try {
            replies = JSON.parse(body);
          } catch (e) {
            self._dispatcher.transportDown(self);
            return;
          }

          if (replies) {
            self._receive(replies);
          } else {
            self._dispatcher.transportDown(self);
          }
        });
      });

      request.on('error', function(error) {
        reject(error);
      });

      request.end(content);
      onCancel(function() {
        request.abort();
      });

    }.bind(this));
  },

  _buildParams: function(content) {
    var uri    = this.endpoint;

    var params = {
      method:   'POST',
      host:     uri.hostname,
      path:     uri.path,
      headers:  {
        'Content-Length': content.length,
        'Content-Type':   'application/json',
        'Host':           uri.host
      }
    };

    if (uri.port) {
      params.port = uri.port;
    }

    return params;
  }
});

/* Statics */
NodeHttpTransport.isUsable = function(endpoint) {
  return (endpoint.protocol === 'http:' || endpoint.protocol === 'https:') && endpoint.host && endpoint.path;
};

module.exports = NodeHttpTransport;
