var fetch = require('../fetch');
var Promise = require('bluebird');

function fetchBluebird(url, options) {
  return Promise.resolve(fetch(url, options));
}
exports.networkOutage = function(timeout) {
  return fetchBluebird('http://localhost:8000/network-outage?timeout=' + (timeout || 5000), {
     method: 'post',
     body: ""
   });
};

exports.stopWebsockets = function(timeout) {
  return fetchBluebird('http://localhost:8000/stop-websockets?timeout=' + (timeout || 5000), {
     method: 'post',
     body: ""
   });
};

exports.deleteSocket = function(clientId) {
  return fetchBluebird('http://localhost:8000/delete/' + clientId, {
    method: 'post',
    body: ""
  });
};

exports.restart = function() {
  return fetchBluebird('/restart', {
    method: 'post',
    body: ""
  });
};

exports.restoreAll = function() {
  return fetchBluebird('http://localhost:8000/restore-all', {
      method: 'post',
      body: ""
    });
};
