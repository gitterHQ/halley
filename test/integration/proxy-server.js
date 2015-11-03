'use strict';

var net = require('net');
var debug = require('debug')('halley:test:proxy-server');

function ProxyServer(serverPort, listenPort) {
  this.serverPort = serverPort;
  this.listenPort = listenPort;
}

ProxyServer.prototype = {
  listen: function(callback) {
    if (!callback) callback = function() {};
    if (this.server) return callback();

    var self = this;
    var server = this.server = net.createServer(function(c) { //'connection' listener
      debug('client connected');
      c.on('end', function() {
        debug('client disconnected');
      });

      self.createClient(c);
    });

    server.listen(this.listenPort, function() { //'listening' listener
      debug('server bound');
      callback();
    });
  },

  createClient: function(incoming) {
    var self = this;
    debug('connection created');

    var backend = net.connect({ port: this.serverPort }, function() {
      debug('backend connection created');

      incoming.on('data', function(data) {
        if (self.trafficDisabled) {
          debug('dropping incoming request');
          return;
        }

        backend.write(data);
      });

      backend.on('data', function(data) {
        if (self.trafficDisabled) {
          debug('dropping backend response');
          return;
        }

        incoming.write(data);
      });

      incoming.on('end', function() {
        debug('incoming end');
        // Intentionally leave sockets hanging
      });

      backend.on('end', function() {
        debug('backend end');
        // Intentionally leave sockets hanging
        incoming.destroy();
      });

      incoming.on('error', function() {
        debug('incoming error');
        backend.destroy();
      });

      backend.on('error', function() {
        debug('backend error');
      });

      backend.on('close', function() {
        debug('backend close');
        incoming.destroy();
      });

      incoming.on('close', function() {
        debug('incoming close');
      });

    });
  },

  disableTraffic: function() {
    debug('Trashing all incoming traffic');
    this.trafficDisabled = true;
  },

  enableTraffic: function() {
    debug('Re-enabling incoming traffic');
    this.trafficDisabled = false;
  }
};

module.exports = ProxyServer;
