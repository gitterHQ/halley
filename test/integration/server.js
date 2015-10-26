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
var PUBLIC_DIR = __dirname + '/public';


var proxyChild;

function createProxyChild(callback) {
  if (!callback) callback = function() {};

  terminateProxyChild(function() {
    proxyChild = require('child_process').fork(__dirname + '/proxy-app.js', {
      stdio: [0, 1, 2]
    });

    proxyChild.on('exit', function(exitCode) {
      console.log('Proxy terminated with exitCode ' + exitCode);
    });

    proxyChild.once('message', function() {
      console.log('RECV', arguments);
      callback();
    });
  });
}

function terminateProxyChild(callback) {
  if (!callback) callback = function() {};


  if (proxyChild) {
    proxyChild.once('exit', function() {
      callback();
    });

    proxyChild.kill('SIGTERM');
    proxyChild = null;
  } else {
    callback();
  }
}

function main(options, callback) {
  var app = express();
  var fayeApp = express();
  var server = http.createServer(app);
  var fayeServer = http.createServer(fayeApp);

  var bayeux = new faye.NodeAdapter({
    mount: '/bayeux',
    timeout: 3,
    ping: 2,
    engine: {
      interval: 1
    }
  });
  bayeux.attach(fayeServer);

  if (options.webpack) {
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
  }

  app.post('/delete/:clientId', function(req, res) {
    var clientId = req.params.clientId;
    console.log('Deleting client', clientId);
    bayeux._server._engine.destroyClient(clientId, function() {
      res.status(200).send('OK');
    });

  });

  app.post('/network-outage', function(req, res) {
    var timeout = parseInt(req.query.timeout) || 15000;

    console.log('disable traffic');
    proxyChild.send({ disable: true });

    setTimeout(function() {
      console.log('enabling traffic');
      proxyChild.send({ enable: true });
    }, timeout);

    res.status(200).send('OK');
  });

  app.post('/disconnect', function(req, res) {
    terminateProxyChild(function() {
      createProxyChild(function() {
        res.status(200).send('OK');
      });
    });
  });

  app.get('*', function(req, res) {
    res.status(404).send('Not found');
  });

  fayeApp.get('*', function(req, res) {
    res.status(404).send('Not found');
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
    },

    outgoing: function(message, callback) {
      var advice;
      if (message.channel === '/advice-retry') {
        advice = message.advice = message.advice || {};
        advice.reconnect = 'retry';
        advice.timeout = 2000;
      }

      if (message.channel === '/advice-handshake') {
        advice = message.advice = message.advice || {};
        advice.reconnect = 'handshake';
        advice.timeout = 2000;
      }

      if (message.channel === '/advice-none') {
        advice = message.advice = message.advice || {};
        advice.reconnect = 'none';
      }

      return callback(message);
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

  fayeServer.listen(8001, function() {
    server.listen(port, function() {
      createProxyChild(callback);
    });

  });

}

module.exports = main;

if (require.main === module) {
  process.on('uncaughtException', function(e) {
    console.error(e.stack || e);
    process.exit(1);
  });

  main({ webpack: true }, function() {
    console.log('Listening');
  });
}
