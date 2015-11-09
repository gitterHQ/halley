/* jshint node:true */
'use strict';

var BayeuxServer = require('./bayeux-server');
var ProxyServer = require('./proxy-server');
var Promise = require('bluebird');

function BayeuxWithProxyServer() {
}

BayeuxWithProxyServer.prototype = {
  start: function(callback) {
    var self = this;
    this.bayeuxServer = new BayeuxServer();
    this.bayeuxServer.start(function(err, bayeuxPort) {
      if (err) return callback(err);
      self.proxyServer = new ProxyServer(bayeuxPort);
      self.proxyServer.start(function(err, proxyPort) {
        if (err) return callback(err);

        return callback(null, { bayeuxPort: bayeuxPort, proxyPort: proxyPort });
      });
    });
  },

  stop: function(callback) {
    var self = this;

    this.proxyServer.stop(function(err) {

      if (err) return callback(err);
      self.bayeuxServer.stop(function(err) {

        if (err) return callback(err);
        callback();
      });
    });

  },


  networkOutage: Promise.method(function(timeout) {
    this.proxyServer.disableTraffic(timeout);
  }),

  stopWebsockets: Promise.method(function(timeout) {
    this.bayeuxServer.crush(timeout);
  }),

  deleteSocket: Promise.method(function(clientId) {
    return Promise.fromCallback(this.bayeuxServer.deleteClient.bind(this.bayeuxServer, clientId));
  }),

  restart: Promise.method(function() {
    var proxy = this.proxyServer;
    return Promise.fromCallback(proxy.stop.bind(proxy))
      .then(function() {
        return Promise.fromCallback(proxy.start.bind(proxy));
      });
  }),

  restoreAll: Promise.method(function() {
    this.proxyServer.enableTraffic();
    this.bayeuxServer.uncrush();
  }),

};

module.exports = BayeuxWithProxyServer;
