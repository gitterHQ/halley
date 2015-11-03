/* jshint node:true, unused:true */
'use strict';

var ProxyServer = require('./proxy-server');
var debug = require('debug')('halley:test:proxy-app');

process.on('uncaughtException', function(e) {
  console.error(e.stack || e);
  process.exit(1);
});

var proxyServer = new ProxyServer(8001, 8002);
proxyServer.listen(function() {
  debug('Proxy server proxying requested from 8002 to 8001');
  process.send({ ready: true });
});

process.on('message', function(data) {
  if (data.disable) {
    debug('disabling traffic');
    proxyServer.disableTraffic();
  }

  if (data.enable) {
    debug('reenabling traffic');
    proxyServer.enableTraffic();
  }
});
