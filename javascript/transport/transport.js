'use strict';

var Faye          = require('../faye');
var Faye_Timeouts = require('../mixins/timeouts');
var Faye_URI      = require('../util/uri');
var Promise       = require('bluebird');
var Faye_Channel  = require('../protocol/channel');
var debug         = require('debug-proxy')('faye:transport');
var extend        = require('../util/extend');
var classExtend   = require('../util/class-extend');

var  registeredTransports = [];

var Faye_Transport = classExtend({
  DEFAULT_PORTS:    {'http:': 80, 'https:': 443, 'ws:': 80, 'wss:': 443},
  SECURE_PROTOCOLS: ['https:', 'wss:'],
  MAX_DELAY:        0,

  batching:  true,

  initialize: function(dispatcher, endpoint) {
    this._dispatcher = dispatcher;
    this.endpoint    = endpoint;
    this._outbox     = [];
    this._proxy      = extend({}, this._dispatcher.proxy);

    // if (!this._proxy.origin && Faye_NodeAdapter) {
    //   this._proxy.origin = Faye.indexOf(this.SECURE_PROTOCOLS, this.endpoint.protocol) >= 0
    //                      ? (process.env.HTTPS_PROXY || process.env.https_proxy)
    //                      : (process.env.HTTP_PROXY  || process.env.http_proxy);
    // }
  },

  close: function() {
  },

  encode: function(/* messages */) {
    return '';
  },

  /* Returns a promise of a request */
  sendMessage: function(message) {
    var self = this;
    debug('Client %s sending message to %s: %j',
               this._dispatcher.clientId, Faye_URI.stringify(this.endpoint), message);

    if (!this.batching) return Promise.resolve(this.request([message]));

    this._outbox.push(message);
    this._flushLargeBatch();
    if (!this._promise) {
      this._promise = new Promise(function(resolve, reject) {
        self._resolve = resolve;
        self._reject = reject;
      });
    }

    // For a handshake, flush almost immediately
    if (message.channel === Faye_Channel.HANDSHAKE) {
      this.addTimeout('publish', 0.01, this._flush, this);
      return this._promise;
    }

    // TODO: consider why we're doing this
    if (message.channel === Faye_Channel.CONNECT) {
      this._connectMessage = message;
    }

    this.addTimeout('publish', this.MAX_DELAY, this._flush, this);
    return this._promise;
  },

  _flush: function() {
    this.removeTimeout('publish');

    // TODO: figure out what this is about
    if (this._outbox.length > 1 && this._connectMessage)
      this._connectMessage.advice = { timeout: 0 };

    // Faye_Promise.fulfill(this._promise, this.request(this._outbox));
    this._resolve(this.request(this._outbox));
    delete this._promise;
    delete this._resolve;
    delete this._reject;

    this._connectMessage = null;
    this._outbox = [];
  },

  _flushLargeBatch: function() {
    var string = this.encode(this._outbox);
    if (string.length < this._dispatcher.maxRequestSize) return;
    var last = this._outbox.pop();
    this._flush();
    if (last) this._outbox.push(last);
  },

  _receive: function(replies) {
    if (!replies) return;
    replies = [].concat(replies);

    debug('Client %s received from %s via %s: %j',
               this._dispatcher.clientId, Faye_URI.stringify(this.endpoint), this.connectionType, replies);

    for (var i = 0, n = replies.length; i < n; i++) {
      this._dispatcher.handleResponse(replies[i]);
    }
  },

  _handleError: function(messages) {
    messages = [].concat(messages);

    debug('Client %s failed to send to %s via %s: %j',
               this._dispatcher.clientId, Faye_URI.stringify(this.endpoint), this.connectionType, messages);

    for (var i = 0, n = messages.length; i < n; i++) {
      this._dispatcher.handleError(messages[i]);
    }
  },

  _getCookies: function() {
    var cookies = this._dispatcher.cookies,
        url     = Faye_URI.stringify(this.endpoint);

    if (!cookies) return '';

    return Faye.map(cookies.getCookiesSync(url), function(cookie) {
      return cookie.cookieString();
    }).join('; ');
  },

  _storeCookies: function(setCookie) {
    var cookies = this._dispatcher.cookies,
        url     = Faye_URI.stringify(this.endpoint),
        cookie;

    if (!setCookie || !cookies) return;
    setCookie = [].concat(setCookie);

    for (var i = 0, n = setCookie.length; i < n; i++) {
      cookie = Faye.Cookies.Cookie.parse(setCookie[i]);
      cookies.setCookieSync(cookie, url);
    }
  }

}, {
  get: function(dispatcher, allowed, disabled, callback, context) {
    var endpoint = dispatcher.endpoint;

    Faye.asyncEach(registeredTransports, function(pair, resume) {
      var connType     = pair[0], Klass = pair[1],
          connEndpoint = dispatcher.endpointFor(connType);

      if (Faye.indexOf(disabled, connType) >= 0)
        return resume();

      if (Faye.indexOf(allowed, connType) < 0) {
        Klass.isUsable(dispatcher, connEndpoint, function() {});
        return resume();
      }

      Klass.isUsable(dispatcher, connEndpoint, function(isUsable) {
        if (!isUsable) return resume();
        var transport = Klass.hasOwnProperty('create') ? Klass.create(dispatcher, connEndpoint) : new Klass(dispatcher, connEndpoint);
        callback.call(context, transport);
      });
    }, function() {
      throw new Error('Could not find a usable connection type for ' + Faye_URI.stringify(endpoint));
    });
  },

  register: function(type, klass) {
    registeredTransports.push([type, klass]);
    klass.prototype.connectionType = type;
  },

  getConnectionTypes: function() {
    return Faye.map(registeredTransports, function(t) { return t[0]; });
  },

},[
  Faye_Timeouts
]);

module.exports = Faye_Transport;
