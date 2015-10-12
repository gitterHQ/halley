'use strict';

var Faye           = require('../faye');
var Faye_Scheduler = require('./scheduler');
var Faye_Transport = require('../transport/transport');
var Faye_Publisher = require('../mixins/publisher');
var Faye_URI       = require('../util/uri');
var classExtend    = require('../util/class-extend');
var debug          = require('debug-proxy')('faye:dispatcher');

var Faye_Dispatcher = classExtend({
  MAX_REQUEST_SIZE: 2048,
  DEFAULT_RETRY:    5,

  UP:   1,
  DOWN: 2,

  initialize: function(client, endpoint, options) {
    this._client     = client;
    this.endpoint    = Faye_URI.parse(endpoint);
    this._alternates = options.endpoints || {};

    this.cookies      = Faye.Cookies && new Faye.Cookies.CookieJar();
    this._disabled    = [];
    this._envelopes   = {};
    this.headers      = {};
    this.retry        = options.retry || this.DEFAULT_RETRY;
    this._scheduler   = options.scheduler || Faye_Scheduler;
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
      this._alternates[type] = Faye_URI.parse(this._alternates[type]);

    this.maxRequestSize = this.MAX_REQUEST_SIZE;
  },

  endpointFor: function(connectionType) {
    return this._alternates[connectionType] || this.endpoint;
  },

  addWebsocketExtension: function(extension) {
    this.wsExtensions.push(extension);
  },

  disable: function(feature) {
    this._disabled.push(feature);
  },

  setHeader: function(name, value) {
    this.headers[name] = value;
  },

  close: function() {
    debug('Dispatcher close requested');
    var transport = this._transport;
    delete this._transport;
    if (transport) transport.close();
  },

  getConnectionTypes: function() {
    return Faye_Transport.getConnectionTypes();
  },

  selectTransport: function(transportTypes, callback, context) {
    var self = this;
    debug('Selecting transport');

    Faye_Transport.get(self, transportTypes, self._disabled, function(transport) {
      debug('Selected %s transport for %s', transport.connectionType, Faye_URI.stringify(transport.endpoint));

      if (transport === self._transport) return;
      if (self._transport) self._transport.close();

      self._transport = transport;
      self.connectionType = transport.connectionType;
      if (callback) callback.call(context, transport);
    });
  },

  sendMessage: function(message, timeout, options) {
    options = options || {};

    var id       = message.id,
        attempts = options.attempts,
        deadline = options.deadline && new Date().getTime() + (options.deadline * 1000),
        envelope = this._envelopes[id],
        scheduler;

    if (!envelope) {
      scheduler = new this._scheduler(message, { timeout: timeout, interval: this.retry, attempts: attempts, deadline: deadline });
      envelope  = this._envelopes[id] = {message: message, scheduler: scheduler};
    }

    this._sendEnvelope(envelope);
  },

  _sendEnvelope: function(envelope) {
    if (!this._transport) return;
    if (envelope.request || envelope.timer) return;

    var message   = envelope.message,
        scheduler = envelope.scheduler,
        self      = this;

    if (!scheduler.isDeliverable()) {
      scheduler.abort();
      delete this._envelopes[message.id];
      return;
    }

    envelope.timer = Faye.ENV.setTimeout(function() {
      debug('Envelope timeout %j', envelope);
      self.handleError(message);
    }, scheduler.getTimeout() * 1000);

    scheduler.send();
    envelope.request = this._transport.sendMessage(message);
  },

  handleResponse: function(reply) {
    var envelope = this._envelopes[reply.id];

    if (reply.successful !== undefined && envelope) {
      envelope.scheduler.succeed();
      delete this._envelopes[reply.id];
      Faye.ENV.clearTimeout(envelope.timer);
    }

    this.trigger('message', reply);

    if (this._state === this.UP) return;
    this._state = this.UP;
    this._client.trigger('transport:up');
  },

  handleError: function(message, immediate) {
    var envelope = this._envelopes[message.id],
        request  = envelope && envelope.request,
        self     = this;

    if (!request) return;

    request.then(function(req) {
      if (req && req.abort) req.abort();
    });

    var scheduler = envelope.scheduler;
    scheduler.fail();

    Faye.ENV.clearTimeout(envelope.timer);
    envelope.request = envelope.timer = null;

    if (!scheduler.isDeliverable()) {
      scheduler.abort();
      debug('Ignoring error on envelope %j', envelope);
      delete this._envelopes[message.id];
    } else {
      if (immediate) {
        this._sendEnvelope(envelope);
      } else {
        envelope.timer = Faye.ENV.setTimeout(function() {
          envelope.timer = null;
          self._sendEnvelope(envelope);
        }, scheduler.getInterval() * 1000);
      }
    }


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
}, null, [
  Faye_Publisher
]);

module.exports = Faye_Dispatcher;
