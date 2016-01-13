'use strict';

var wtf     = require('wtfnode'); // Must be first
var Halley  = require('../..');
var Promise = require('bluebird');

var url = process.argv[2];

var client = new Halley.Client(url);

client.publish('/channel', { data: 1 })
  .then(function() {
    var resolve;
    var gotMessage = new Promise(function(res) {
      resolve = res;
    });

    return [gotMessage, client.subscribe('/datetime', function() {
      resolve();
    })];
  })
  .spread(function(message, subscription) {
    return subscription.unsubscribe();
  })
  .then(function() {
    return client.disconnect();
  })
  .then(function() {
    setInterval(function() {
      wtf.dump();
    }, 1000).unref();
  })
  .catch(function(err) {
    console.error(err && err.stack || err);
    process.exit(1);
  })
  .done();
