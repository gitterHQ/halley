'use strict';

var Timeouts = require('../util/timeouts');
var uri      = require('../util/uri');
var Promise  = require('bluebird');
var Channel  = require('../protocol/channel');
var debug    = require('debug-proxy')('faye:transport');
var extend   = require('../util/extend');

var registeredTransports = [];

function Faye_Transport(dispatcher, endpoint) {
  this._dispatcher = dispatcher;
  this.endpoint    = endpoint;
  this._outbox     = [];
  this._proxy      = extend({}, this._dispatcher.proxy);

  this.timeouts    = new Timeouts(this);
}

Faye_Transport.prototype = {
  DEFAULT_PORTS:    {'http:': 80, 'https:': 443, 'ws:': 80, 'wss:': 443},
  SECURE_PROTOCOLS: ['https:', 'wss:'],
  MAX_DELAY:        0,

  batching:  true,

  close: function() {
  },

  encode: function(/* messages */) {
    return '';
  },

  /* Returns a promise of a request */
  sendMessage: function(message) {
    var self = this;

    debug('Client %s sending message to %j: %j',
      this._dispatcher.clientId, this.endpoint, message);

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
    if (message.channel === Channel.HANDSHAKE) {
      this.timeouts.add('publish', 10, this._flush);
      return this._promise;
    }

    // TODO: consider why we're doing this
    if (message.channel === Channel.CONNECT) {
      this._connectMessage = message;
    }

    this.timeouts.add('publish', this.MAX_DELAY, this._flush);
    return this._promise;
  },

  _flush: function() {
    this.timeouts.remove('publish');

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

    debug('Client %s received from %j via %s: %j',
               this._dispatcher.clientId, this.endpoint, this.connectionType, replies);

    for (var i = 0, n = replies.length; i < n; i++) {
      this._dispatcher.handleResponse(replies[i]);
    }
  },

  _handleError: function(messages) {
    messages = [].concat(messages);

    debug('Client %s failed to send to %j via %s: %j',
               this._dispatcher.clientId, this.endpoint, this.connectionType, messages);

    for (var i = 0, n = messages.length; i < n; i++) {
      this._dispatcher.handleError(messages[i]);
    }
  },

};

/* Statics */
extend(Faye_Transport, {
  get: function(dispatcher, allowed, disabled, callback) {
    var endpoint = dispatcher.endpoint;

    asyncEach(registeredTransports, function(pair, resume) {
      var connType     = pair[0], Klass = pair[1],
          connEndpoint = dispatcher.endpointFor(connType);

      if (disabled && disabled.indexOf(connType) >= 0)
        return resume();

      if (allowed && allowed.indexOf(connType) < 0) {
        Klass.isUsable(dispatcher, connEndpoint, function() {});
        return resume();
      }

      Klass.isUsable(dispatcher, connEndpoint, function(isUsable) {
        if (!isUsable) return resume();
        var transport = Klass.hasOwnProperty('create') ? Klass.create(dispatcher, connEndpoint) : new Klass(dispatcher, connEndpoint);
        callback(transport);
      });
    }, function() {
      throw new Error('Could not find a usable connection type for ' + uri.stringify(endpoint));
    });
  },

  register: function(type, klass) {
    registeredTransports.push([type, klass]);
    klass.prototype.connectionType = type;
  },

  getConnectionTypes: function() {
    return registeredTransports.map(function(t) { return t[0]; });
  },

});

function asyncEach(list, iterator, callback) {
  var n       = list.length,
      i       = -1,
      calls   = 0,
      looping = false;

  var iterate = function() {
    calls -= 1;
    i += 1;
    if (i === n) return callback && callback();
    iterator(list[i], resume);
  };

  var loop = function() {
    if (looping) return;
    looping = true;
    while (calls > 0) iterate();
    looping = false;
  };

  var resume = function() {
    calls += 1;
    loop();
  };
  resume();
}


module.exports = Faye_Transport;
