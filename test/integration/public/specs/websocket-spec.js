'use strict';

var assert = require('assert');
var sinon = require('sinon');

module.exports = function() {
  describe('websocket-transport', function() {

    it('should connect', function(done) {
      this.websocket.connect()
        .nodeify(done);
    });

    it('should notify on close', function(done) {
      var mock = sinon.mock(this.dispatcher);
      mock.expects("transportDown").once();

      this.websocket.connect()
        .bind(this)
        .then(function() {
          this.websocket.close();
          mock.verify();
        })
        .nodeify(done);
    });

  });
};
