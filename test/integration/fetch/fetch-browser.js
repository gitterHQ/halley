/* jshint browser:true */
'use strict';

if (!window.Promise) {
  window.Promise = require('bluebird');
}

// Polyfill if required
require('whatwg-fetch');

module.exports = window.fetch;
