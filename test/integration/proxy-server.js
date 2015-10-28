'use strict';

var net = require('net');

function ProxyServer(serverPort, listenPort) {
  this.serverPort = serverPort;
  this.listenPort = listenPort;
}

var log = console.log.bind(console, 'proxy:');

ProxyServer.prototype = {
  listen: function(callback) {
    if (!callback) callback = function() {};
    if (this.server) return callback();

    var self = this;
    var server = this.server = net.createServer(function(c) { //'connection' listener
      log('client connected');
      c.on('end', function() {
        log('client disconnected');
      });

      self.createClient(c);
    });

    server.listen(this.listenPort, function() { //'listening' listener
      log('server bound');
      callback();
    });
  },

  createClient: function(incoming) {
    var self = this;
    log('connection created');

    var backend = net.connect({ port: this.serverPort }, function() {
      log('backend connection created');

      incoming.on('data', function(data) {
        if (self.trafficDisabled) {
          log('dropping incoming request');
          return;
        }

        backend.write(data);
      });

      backend.on('data', function(data) {
        if (self.trafficDisabled) {
          log('dropping backend response');
          return;
        }

        incoming.write(data);
      });

      incoming.on('end', function() {
        log('incoming end');
        // Intentionally leave sockets hanging
      });

      backend.on('end', function() {
        log('backend end');
        // Intentionally leave sockets hanging
        incoming.destroy();
      });

      incoming.on('error', function() {
        log('incoming error');
        backend.destroy();
      });

      backend.on('error', function() {
        log('backend error');
      });

      backend.on('close', function() {
        log('backend close');
        incoming.destroy();
      });

      incoming.on('close', function() {
        log('incoming close');
      });

    });
  },

  disableTraffic: function() {
    log('Trashing all incoming traffic');
    this.trafficDisabled = true;
  },

  enableTraffic: function() {
    log('Re-enabling incoming traffic');
    this.trafficDisabled = false;
  }
};

module.exports = ProxyServer;
