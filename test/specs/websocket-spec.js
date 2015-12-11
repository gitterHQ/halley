'use strict';

var sinon = require('sinon');

module.exports = function() {
  describe('websocket-transport', function() {

    it('should connect', function() {
      return this.websocket.connect();
    });

    it('should notify on close', function() {
      var mock = sinon.mock(this.dispatcher);
      mock.expects("transportDown").once();

      return this.websocket.connect()
        .bind(this)
        .then(function() {
          this.websocket.close();
          mock.verify();
        });
    });

  });
};
