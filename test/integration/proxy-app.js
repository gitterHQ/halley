/* jshint node:true, unused:true */
'use strict';

var ProxyServer = require('./proxy-server');

process.on('uncaughtException', function(e) {
  console.error(e.stack || e);
  process.exit(1);
});

var proxyServer = new ProxyServer(8001, 8002);
proxyServer.listen(function() {
  console.log('proxy: Proxy server proxying requested from 8002 to 8001');
  process.send({ ready: true });
});

process.on('message', function(data) {
  if (data.disable) {
    proxyServer.disableTraffic();
  }

  if (data.enable) {
    proxyServer.enableTraffic();
  }
});
