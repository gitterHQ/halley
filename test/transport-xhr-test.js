var XHRTransport = require('../lib/transport/browser/xhr');

describe('xhr', function() {

  require('./specs/batched-transport-spec')(function(dispatcher, endpoint) {
    return new XHRTransport(dispatcher, endpoint);
  });

});
