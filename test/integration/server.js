/* jshint node:true */
'use strict';

var fs = require('fs');
var path = require('path');
var http = require('http');
var https = require('https');
var deflate = require('permessage-deflate');
var faye = require('gitter-faye');
var express = require('express');
var webpack = require('webpack');
var webpackMiddleware = require("webpack-dev-middleware");
var debug = require('debug')('faye:test-server');
var ProxyServer = require('./proxy-server');
var PUBLIC_DIR = __dirname + '/public';

process.on('uncaughtException', function(e) {
  console.error(e.stack || e);
});

var app = express();
var server = http.createServer(app);
var fayeServer = http.createServer();
var proxyServer = new ProxyServer(8001);

var bayeux = new faye.NodeAdapter({
  mount: '/bayeux',
  timeout: 3,
  ping: 2,
  engine: {
    interval: 1
  }
});
bayeux.attach(fayeServer);

app.use(webpackMiddleware(webpack({
  context: __dirname + "/public",
  entry: "mocha!./test-suite",
  output: {
    path: __dirname + "/",
    filename: "test-suite.js"
  },
  devtool: "#eval"

}), {
  noInfo: false,
  quiet: false,

  watchOptions: {
      aggregateTimeout: 300,
      poll: true
  },

  publicPath: "/",
  stats: { colors: true }
}));
app.use(express.static(PUBLIC_DIR));

app.post('/delete/:clientId', function(req, res) {
  var clientId = req.params.clientId;
  console.log('Deleting client', clientId);
  bayeux._server._engine.destroyClient(clientId, function() {
    res.status(200).send('OK');
  });

});

app.post('/network-outage', function(req, res) {
  var timeout = parseInt(req.query.timeout) || 15000;

  proxyServer.disableTraffic();
  console.log('disable traffic');
  setTimeout(function() {
    console.log('enabling traffic');
    proxyServer.enableTraffic();
  }, timeout);

  res.status(200).send('OK');
});


app.use(function(req, res) {
  res.sendStatus(404);
});

bayeux.getClient().subscribe('/control', function(message) {
  console.log('MESSAGE', message);
});

setInterval(function() {
  bayeux.getClient().publish('/datetime', { date: Date.now() });
}, 100);

bayeux.addExtension({
  incoming: function(message, callback) {
    if (message.channel === '/meta/subscribe' && message.subscription === '/banned') {
      message.error = 'Invalid subscription';
    }

    if (message.channel === '/devnull') {
      return;
    }

    if (message.channel === '/meta/handshake') {
      if (message.ext && message.ext.failHandshake) {
        message.error = 'Unable to handshake';
      }
    }

    callback(message);
  }
});

bayeux.on('handshake', function(clientId) {
  console.log('[  handshake] ' + clientId);
});

bayeux.on('subscribe', function(clientId, channel) {
  console.log('[  SUBSCRIBE] ' + clientId + ' -> ' + channel);
});

bayeux.on('unsubscribe', function(clientId, channel) {
  console.log('[UNSUBSCRIBE] ' + clientId + ' -> ' + channel);
});

bayeux.on('disconnect', function(clientId) {
  console.log('[ DISCONNECT] ' + clientId);
});

var port = process.env.PORT || '8000';
fayeServer.listen(8001);
server.listen(port, function() {
  console.log('Listening on ' + port);
});

proxyServer.listen(8002);
