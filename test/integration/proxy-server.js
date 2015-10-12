/* jshint node:true */
'use strict';

var net = require('net');

function ProxyServer(serverPort) {
  this.serverPort = serverPort;
}

ProxyServer.prototype = {
  listen: function(port) {
    var self = this;
    var server = this.server = net.createServer(function(c) { //'connection' listener
      console.log('client connected');
      c.on('end', function() {
        console.log('client disconnected');
      });

      self.createClient(c);
    });

    server.listen(port, function() { //'listening' listener
      console.log('server bound');
    });
  },

  createClient: function(incoming) {
    var self = this;
    var backend = net.connect({ port: this.serverPort }, function() { //'connect' listener
      console.log('connection created');
      //
      // var inpipe = backend.pipe(es.through(function(data) {
      //   console.log('INCOMING!', data.toString());
      //   this.emit(data);
      // }));
      //
      //
      incoming.on('data', function(data) {
        if (self.trafficDisabled) return;
        backend.write(data);
      });

      incoming.on('end', function() {
        // Intentionally leave sockets hanging
      });

      backend.on('data', function(data) {
        if (self.trafficDisabled) return;
        incoming.write(data);
      });

      backend.on('end', function() {
        // Intentionally leave sockets hanging
        // incoming.destroy();
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
