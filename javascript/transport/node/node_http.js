'use strict';

var Transport = require('../transport');
var http      = require('http');
var https     = require('https');
var uri       = require('../../util/uri');
var extend    = require('../../utils/extend');
var inherits  = require('inherits');
var extend    = require('../../util/extend');

function NodeHttpTransport(dispatcher, endpoint) {
  NodeHttpTransport.super_.call(this, dispatcher, endpoint);

  this._endpointSecure = this.endpoint.protocol === 'https:';
  this._httpClient     = this._endpointSecure ? https : http;
}
inherits(NodeHttpTransport, Transport);

extend(NodeHttpTransport.prototype, {
  encode: function(messages) {
    return JSON.stringify(messages);
  },

  request: function(messages) {
    var content = new Buffer(this.encode(messages), 'utf8'),
        params  = this._buildParams(content),
        request = this._httpClient.request(params),
        self    = this;

    request.on('response', function(response) {
      self._handleResponse(messages, response);
    });

    request.on('error', function(/*error*/) {
      self._handleError(messages);
    });

    request.end(content);
    return request;
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
  },

  _handleResponse: function(messages, response) {
    var replies = null,
        body    = '',
        self    = this;

    response.setEncoding('utf8');
    response.on('data', function(chunk) { body += chunk; });

    response.on('end', function() {
      try {
        replies = JSON.parse(body);
      } catch (e) {}

      if (replies) {
        self._receive(replies);
      } else {
        self._handleError(messages);
      }
    });
  }

});

/* Statics */
NodeHttpTransport.isUsable = function(dispatcher, endpoint, callback) {
  callback(uri.isURI(endpoint));
};

module.exports = NodeHttpTransport;
