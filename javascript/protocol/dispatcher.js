'use strict';

var Scheduler      = require('./scheduler');
var Transport      = require('../transport/transport');
var PublisherMixin = require('../mixins/publisher');
var uri            = require('../util/uri');
var Envelope       = require('./envelope');
var extend         = require('../util/extend');
var debug          = require('debug-proxy')('faye:dispatcher');

/**
 * The dispatcher sits between the client and the transport.
 *
 * It's responsible for tracking sending messages to the transport,
 * tracking in-flight messages
 */

function Dispatcher(client, endpoint, options) {
  this._client     = client;
  this.endpoint    = uri.parse(endpoint);
  this._alternates = options.endpoints || {};

  this._disabled    = [];
  this._envelopes   = {};
  this.retry        = options.retry || this.DEFAULT_RETRY;
  this._scheduler   = options.scheduler || Scheduler;
  this._state       = 0;
  this.transports   = {};
  this.wsExtensions = [];

  this.proxy = options.proxy || {};
  if (typeof this._proxy === 'string') this._proxy = {origin: this._proxy};

  var exts = options.websocketExtensions;
  if (exts) {
    exts = [].concat(exts);
    for (var i = 0, n = exts.length; i < n; i++)
      this.addWebsocketExtension(exts[i]);
  }

  this.tls = options.tls || {};
  this.tls.ca = this.tls.ca || options.ca;

  for (var type in this._alternates)
    this._alternates[type] = uri.parse(this._alternates[type]);

  this.maxRequestSize = this.MAX_REQUEST_SIZE;
}

Dispatcher.prototype = {
  MAX_REQUEST_SIZE: 2048,
  DEFAULT_RETRY:    5000,

  UP:   1,
  DOWN: 2,

  endpointFor: function(connectionType) {
    return this._alternates[connectionType] || this.endpoint;
  },

  addWebsocketExtension: function(extension) {
    this.wsExtensions.push(extension);
  },

  disable: function(feature) {
    this._disabled.push(feature);
  },

  close: function() {
    debug('Dispatcher close requested');
    var transport = this._transport;
    delete this._transport;
    if (transport) transport.close();
  },

  getConnectionTypes: function() {
    return Transport.getConnectionTypes();
  },

  selectTransport: function(transportTypes, callback) {
    var self = this;
    debug('Selecting transport');

    Transport.get(self, transportTypes, self._disabled, function(transport) {
      debug('Selected %s transport for %s', transport.connectionType, uri.stringify(transport.endpoint));

      if (transport === self._transport) return;
      if (self._transport) self._transport.close();

      self._transport = transport;
      self.connectionType = transport.connectionType;
      if (callback) callback(transport);
    });
  },

  sendMessage: function(message, timeout, options) {
    options = options || {};

    var self = this;
    var id = message.id;
    var attempts = options.attempts;
    var envelope = this._envelopes[id];

    function removeEnvelope() {
      delete self._envelopes[id];
    }

    if (!envelope) {
      var scheduler = new this._scheduler(message, { timeout: timeout, interval: this.retry, attempts: attempts });
      envelope = this._envelopes[id] = new Envelope(message, scheduler, { deadline: options.deadline });

      // Remove the envelope on resolve or reject
      envelope.promise.then(removeEnvelope, removeEnvelope);
    }

    this._sendEnvelope(envelope);
    return envelope.promise;
  },

  _sendEnvelope: function(envelope) {
    if (!this._transport) return;
    var self = this;

    function onTimeout() {
      debug('Envelope timeout %j', envelope);
      self.handleError(envelope.message);
    }

    function onSend() {
      return self._transport.sendMessage(envelope.message);
    }

    envelope.scheduleSend(onSend, onTimeout);
  },

  handleResponse: function(reply) {
    debug('handleResponse %j', reply);

    var envelope = this._envelopes[reply.id];

    if (reply.successful !== undefined && envelope) {
      // This is a response to a message we fired.
      envelope.resolve(reply);
    } else {
      // Distribe this message through channels
      // Don't trigger a message if this is a reply
      // to a request, otherwise it'll pass
      // through the extensions twice
      this.trigger('message', reply);
    }

    if (this._state === this.UP) return;
    this._state = this.UP;
    this._client.trigger('transport:up');
  },

  handleError: function(message) {
    debug('handleError %j', message);
    var envelope = this._envelopes[message.id];

    if (!envelope) return;

    var self = this;

    envelope.failScheduleRetry(function() {
      self._sendEnvelope(envelope);
    });

    if (this._state === this.DOWN) return;
    this._state = this.DOWN;
    this._client.trigger('transport:down');
  },

  transportDown: function(transport) {
    if (transport !== this._transport) {
      return;
    }
    debug('Transport down');
    this.trigger('transportDown');
  }
};

/* Mixins */
extend(Dispatcher.prototype, PublisherMixin);

module.exports = Dispatcher;
