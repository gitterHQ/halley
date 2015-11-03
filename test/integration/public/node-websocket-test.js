'use strict';

var WebSocket = require('../../../lib/transport/node/node-websocket');
var uri = require('../../../lib/util/uri');

describe('node websocket transport', function() {

  describe('direct', function() {

    beforeEach(function() {
      this.dispatcher = {
        timeout: 1000,
        transportDown: function() {
        },
        handleResponse: function() {
        },
        handleError: function() {
        }
      };

      this.websocket = new WebSocket(this.dispatcher, uri.parse('http://localhost:8001/bayeux'));
    });

    afterEach(function() {
      this.websocket.close();
    });

    require('./specs/websocket-spec')();
  });

  describe('proxied', function() {

    beforeEach(function() {
      this.dispatcher = {
        timeout: 1000,
        transportDown: function() {
        },
        handleResponse: function() {
        },
        handleError: function() {
        }
      };

      this.websocket = new WebSocket(this.dispatcher, uri.parse('http://localhost:8002/bayeux'));
    });

    afterEach(function() {
      this.websocket.close();
    });

    require('./specs/websocket-server-restart-spec')();
    require('./specs/websocket-bad-connection-spec')();
  });

});
