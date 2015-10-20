describe('test-suite', function() {

  before(function(done) {
    console.log('Starting server');
    require('./server')(done);
  });

  require('./public/test-suite');
});
