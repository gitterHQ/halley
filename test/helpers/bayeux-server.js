/* jshint node:true */
'use strict';

var http = require('http');
var faye = require('gitter-faye');
var debug = require('debug')('halley:test:bayeux-server');
var enableDestroy = require('server-destroy');

function BayeuxServer() {
  this.port = 0;
}

BayeuxServer.prototype = {

  start: function(callback) {
    var server = this.server = http.createServer();
    enableDestroy(server);

    var bayeux = this.bayeux = new faye.NodeAdapter({
      mount: '/bayeux',
      timeout: 1,
      ping: 0.5,
      engine: {
        interval: 0.5
      }
    });
    bayeux.attach(server);

    this.publishTimer = setInterval(function() {
      bayeux.getClient().publish('/datetime', { date: Date.now() });
    }, 100);

    server.on('upgrade', function(req) {
      if (self.crushWebsocketConnections) {
        // Really mess things up
        req.socket.write('<OHNOES>');
        req.socket.destroy();
      }
    });

    var self = this;

    bayeux.addExtension({
      incoming: function(message, req, callback) {
        if (self.crushWebsocketConnections) {
          if (req && req.headers.connection === 'Upgrade') {
            debug('Disconnecting websocket');
            req.socket.destroy();
            return;
          }
        }

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

      outgoing: function(message, req, callback) {
        var advice;
        if (message.channel === '/advice-retry') {
          advice = message.advice = message.advice || {};
          advice.reconnect = 'retry';
          advice.timeout = 2000;
        }

        if (message.channel === '/advice-handshake') {
          advice = message.advice = message.advice || {};
          advice.reconnect = 'handshake';
          advice.interval = 150;
          // advice.timeout = 150;
        }

        if (message.channel === '/advice-none') {
          advice = message.advice = message.advice || {};
          advice.reconnect = 'none';
        }

        return callback(message);
      }
    });

    server.listen(this.port, function(err) {
      if (err) return callback(err);
      self.port = server.address().port;
      callback(null, server.address().port);
    });
  },

  stop: function(callback) {
    clearTimeout(this.publishTimer);
    clearTimeout(this.uncrushTimeout);
    this.server.destroy(callback);
    this.server = null;
  },

  deleteClient: function(clientId, callback) {
    debug('Deleting client', clientId);
    this.bayeux._server._engine.destroyClient(clientId, callback);
  },

  crush: function(timeout) {
    if (this.crushWebsocketConnections) return;
    this.crushWebsocketConnections = true;
    this.uncrushTimeout = setTimeout(this.uncrush.bind(this), timeout || 5000);
  },

  uncrush: function() {
    if (!this.crushWebsocketConnections) return;
    this.crushWebsocketConnections = false;
    clearTimeout(this.uncrushTimeout);
  }
};

module.exports = BayeuxServer;
