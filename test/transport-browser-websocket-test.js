var WebSocketTransport = require('../lib/transport/browser/browser-websocket');

describe('browser-websocket', function() {

  require('./specs/non-batched-transport-spec')(function(dispatcher, endpoint) {
    return new WebSocketTransport(dispatcher, endpoint);
  });

});
