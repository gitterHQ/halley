'use strict';

describe('test-suite', function() {

  var server = require('./server');

  before(function(done) {
    console.log('Starting server');
    server.listen({ }, done);
  });

  after(function(done) {
    server.unlisten(done);
  });

  require('./public/test-suite-node');
});
