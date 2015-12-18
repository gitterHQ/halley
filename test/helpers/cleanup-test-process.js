'use strict';

var Halley = require('../..');
var wtf = require('wtfnode');

var url = process.argv[2];

var client = new Halley.Client(url);

client.publish('/channel', { data: 1 })
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
