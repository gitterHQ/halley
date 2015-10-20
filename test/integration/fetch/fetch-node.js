/* jshint node:true */
'use strict';

var url = require('url');
var fetch = require('node-fetch');

fetch.Promise = require('bluebird');

module.exports = function(relativeUrl, options) {
  var resolved = url.resolve('http://localhost:8000', relativeUrl);
  return fetch(resolved, options);
};
