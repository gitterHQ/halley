/* jshint node:true */
'use strict';

var net = require('net');
var EventEmitter = require('events').EventEmitter;

function ProxyServer(serverPort, listenPort) {
  this.serverPort = serverPort;
  this.listenPort = listenPort;
}

var emitter = new EventEmitter();

ProxyServer.prototype = {
  listen: function(callback) {
    if (!callback) callback = function() {};
    if (this.server) return callback();

    var self = this;
    var server = this.server = net.createServer(function(c) { //'connection' listener
      console.log('client connected');
      c.on('end', function() {
        console.log('client disconnected');
      });

      self.createClient(c);
    });

    server.listen(this.listenPort, function() { //'listening' listener
      console.log('server bound');
      callback();
    });
  },

  unlisten: function(callback) {
    if (!callback) callback = function() {};
    emitter.emit('disconnectAll');

    if (!this.server) return callback();
    console.log('>>>>>>>>>>>>>>>>>>>>>>>>>>>>');
    this.server.close(function() {
      console.log('Server closed');
      callback();
    });
    this.server = null;
  },

  createClient: function(incoming) {
    var self = this;
    console.log('connection created');

    var backend = net.connect({ port: this.serverPort }, function() { //'connect' listener
      console.log('backend connection created');
      var disconnect = function() {
        console.log('DISCONNECTING!', incoming);
        incoming.destroy();
        backend.end();
      }.bind(incoming);

      emitter.addListener('disconnectAll', disconnect);

      incoming.on('data', function(data) {
        console.log('in');
        if (self.trafficDisabled) return;
        backend.write(data);
      });

      backend.on('data', function(data) {
        console.log('out');

        if (self.trafficDisabled) return;
        incoming.write(data);
      });

      incoming.on('end', function() {
        console.log('incoming end');
        // Intentionally leave sockets hanging
      });

      backend.on('end', function() {
        console.log('backend end');
        // Intentionally leave sockets hanging
        incoming.destroy();
      });

      incoming.on('error', function() {
        console.log('incoming error');
        backend.destroy();
      });

      backend.on('error', function() {
        console.log('backend error');
      });

      backend.on('close', function() {
        console.log('backend close');
        incoming.destroy();
      });

      incoming.on('close', function() {
        console.log('incoming close');
        emitter.removeListener('disconnectAll', disconnect);
      });

    });
  },

  disableTraffic: function() {
    this.trafficDisabled = true;
  },

  enableTraffic: function() {
    this.trafficDisabled = false;
  }
};

module.exports = ProxyServer;
