/* jshint browser:true */

'use strict';

var Promise = require('bluebird');

if (!window.Promise) {
  window.Promise = Promise;
}

// Polyfill if required
require('whatwg-fetch');

function fetchBluebird(url, options) {
  return Promise.resolve(window.fetch(url, options));
}

function RemoteServerControl() {
  this.id = null;
}

RemoteServerControl.prototype = {
  setup: function() {
    return fetchBluebird('http://localhost:8000/setup', {
       method: 'post',
       body: ""
     })
     .bind(this)
     .then(function(response) {
       return Promise.resolve(response.json());
     })
     .then(function(json) {
       this.id = json.id;
       return json.ports;
     });
  },

  teardown: function() {
    return fetchBluebird('http://localhost:8000/control/' + this.id + '/teardown', {
       method: 'post',
       body: ""
     });
  },

  networkOutage: function(timeout) {
    return fetchBluebird('http://localhost:8000/control/' + this.id + '/network-outage?timeout=' + (timeout || 5000), {
       method: 'post',
       body: ""
     });
  },

  stopWebsockets: function(timeout) {
    return fetchBluebird('http://localhost:8000/control/' + this.id + '/stop-websockets?timeout=' + (timeout || 5000), {
       method: 'post',
       body: ""
     });
  },

  deleteSocket: function(clientId) {
    return fetchBluebird('http://localhost:8000/control/' + this.id + '/delete/' + clientId, {
      method: 'post',
      body: ""
    });
  },

  restart: function() {
    return fetchBluebird('http://localhost:8000/control/' + this.id + '/restart', {
      method: 'post',
      body: ""
    });
  },

  restoreAll: function() {
    return fetchBluebird('http://localhost:8000/control/' + this.id + '/restore-all', {
        method: 'post',
        body: ""
      });
  },

}
module.exports = RemoteServerControl;
