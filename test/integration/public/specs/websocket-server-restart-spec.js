'use strict';

var sinon = require('sinon');
var serverControl = require('../server-control');

module.exports = function() {
  describe('server restart', function() {

    it('should terminate if the server disconnects', function(done) {
      var mock = sinon.mock(this.dispatcher);
      mock.expects("transportDown").once();

      this.websocket.connect()
        .bind(this)
        .then(function() {
          return serverControl.restart();
        })
        .delay(10)
        .then(function() {
          mock.verify();
        })
        .nodeify(done);
    });

  });
};
