'use strict';

var Promise = require('bluebird');
var globalEvents = require('../../lib/util/global-events');

module.exports = function() {
  describe('bad connection', function() {

    it('should terminate if the server cannot be pinged', function(done) {
      var serverControl = this.serverControl;
      this.websocket.connect()
        .bind(this)
        .then(function() {
          var self = this;
          return Promise.all([
            new Promise(function(resolve, reject) {
              self.dispatcher.transportDown = function() {
                resolve();
              }
            }),
            serverControl.networkOutage(1000)
          ]);
        })
        .nodeify(done);
    });

    /**
     * This test simulates a network event, such as online/offline detection
     * This should make the speed of recovery much faster
     */
    it('should terminate if the server cannot be pinged after a network event', function(done) {
      var serverControl = this.serverControl;

      this.websocket.connect()
        .bind(this)
        .then(function() {
          var self = this;
          return Promise.all([
            new Promise(function(resolve) {
              self.dispatcher.transportDown = function() {
                resolve();
              }
            }),
            serverControl.networkOutage(1000)
              .then(function() {
                globalEvents.trigger('network');
              })
          ]);
        })
        .nodeify(done);
    });

  });
};
