'use strict';

var fetch = require('../../fetch');
var Promise = require('bluebird');
var globalEvents = require('../../../../lib/util/global-events');

module.exports = function() {
  describe('bad connection', function() {

    it('should terminate if the server cannot be pinged', function(done) {
      this.timeout(10000);

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
            fetch('/network-outage?timeout=1000', {
              method: 'post',
              body: ""
            })
          ]);
        })
        .finally(function() {
          return fetch('/restore-network-outage', {
            method: 'post',
            body: ""
          })
        })
        .nodeify(done);
    });

    /**
     * This test simulates a network event, such as online/offline detection
     * This should make the speed of recovery much faster
     */
    it('should terminate if the server cannot be pinged after a network event', function(done) {
      this.timeout(10000);

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
            fetch('/network-outage?timeout=1000', {
              method: 'post',
              body: ""
            }).then(function() {
              globalEvents.trigger('network');
            })
          ]);
        })
        .finally(function() {
          return fetch('/restore-network-outage', {
            method: 'post',
            body: ""
          })
        })
        .nodeify(done);
    });

  });
};
