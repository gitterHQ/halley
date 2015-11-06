'use strict';

var debug          = require('debug')('halley:pool');
var Promise        = require('bluebird');

function TransportPool(dispatcher, endpoint, advice, disabled, registered) {
  this._dispatcher = dispatcher;
  this._endpoint = endpoint;
  this._advice = advice;
  this._transports = {};
  this._disabled = disabled;
  this._registered = registered;
  this._disconnecting = false;

  this._registeredHash = registered.reduce(function(memo, transport) {
    var type = transport[0];
    var Klass = transport[1];
    memo[type] = Klass;
    return memo;
  }, {});

  this._allowed = null;

  this.setAllowed(null)
    .catch(function(err) {
      debug('Unable to preconnect to any available transports', err && err.stack || err);
    });
}

TransportPool.prototype = {
  /** Returns a promise to transport */
  get: function() {
    if (this._transportPromise) {
      return this._transportPromise;
    }

    var promise = this._transportPromise = this._reselect()
      .bind(this)
      .finally(function() {
        if (!promise.isFulfilled()) {
          this._transportPromise = null;
        }
      });
    return promise;
  },

  setAllowed: function(allowedTypes, cleanup) {
    this._disconnecting = false;

    // Maintain the order from this._allowed
    this._allowed = this._registered
      .map(function(transport) {
        return transport[0];
      })
      .filter(function(type) {
        return !allowedTypes || allowedTypes.indexOf(type) >= 0;
      });

    this._transportPromise = this._reselect();

    if (cleanup) {
      // Remove transports that we won't use
      Object.keys(this._transports).forEach(function(type) {
        if (this._allowed.indexOf(type) >= 0) return;

        var transport = this._transports[type];
        delete this._transports[type];

        if (transport.isFulfilled()) {
          transport.value().close();
        } else {
          transport.cancel();
        }

      }, this);
    }

    return this._transportPromise;
  },

  _reselect: function() {
    debug('_reselect: %j', this._allowed);

    // Load the trasn
    var connectionPromises = this._allowed
      .filter(function(type) {
        var Klass = this._registeredHash[type];

        if (this._disabled && this._disabled.indexOf(type) >= 0) return false;

        return Klass.isUsable(this._endpoint);
      }, this)
      .map(function(type) {
        var Klass = this._registeredHash[type];

        var current = this._transports[type];
        if (current) {
          if(!current.isRejected() && !current.isCancelled()) {
            return current;
          }
        }

        var instance = new Klass(this._dispatcher, this._endpoint, this._advice);

        // If the instance is a `thenable` (websockets for example)
        // then bluebird will bind to the then method
        var promise = instance.connect ?
          instance.connect().return(instance) :
          Promise.resolve(instance);

        this._transports[type] = promise;
        return promise;
      }, this);

    if (!connectionPromises.length) {
      return Promise.reject(new Error('No suitable transports available'));
    }

    if (this._secondarySelect) {
      this._secondarySelect.cancel();
      this._secondarySelect = null;
    }

    if (connectionPromises.length > 1 && connectionPromises.some(function(promise) { return promise.isPending(); })) {
      // Some connection types may be better once
      // we know that they're able to connect
      // possibly switch to them once
      // the connection is established
      this._secondarySelect = Promise.all(connectionPromises.map(function(promise) {
          // Wait until the promise is fulfilled via
          // a resolve or a reject
          return promise.reflect();
        }))
        .bind(this)
        .then(function() {
          if (this._disconnecting) return;
          // If this is the initial connection, don't switch
          // to the new transport
          if (!this._allowed) return;

          return Promise.any(connectionPromises);
        })
        .then(function(newTransport) {
          if (!newTransport) return;

          if (this._transportPromise && this._transportPromise.isFulfilled()) {
            if (this._transportPromise.value() === newTransport) {
              return;
            }
          }
          var connectionType = newTransport.connectionType;

          debug('Switching transports: %s', connectionType);
          this._transportPromise = Promise.resolve(newTransport);
        })
        .catch(function(err) {
          debug('Unable to select new transport after completion: %s', err && err.stack || err);
        })
        .done();

    }

    // Return the first usable transport
    return Promise.any(connectionPromises)
      .then(function(transport) {
        debug('Selected transport %s', transport.connectionType);
        return transport;
      })
      .catch(Promise.AggregateError, function(err) {
        /* Just fail with the first problem */
        throw err[0];
      });
  },

  closing: function() {
    this._disconnecting = true;
  },

  close: function() {
    debug('_close');

    var transports = this._transports;
    this._transports = {};

    if (this._transportPromise) {
      this._transportPromise.cancel();
      this._transportPromise = null;
    }

    Object.keys(transports).forEach(function(type) {
      var transportPromise = transports[type];
      if (transportPromise.isFulfilled()) {
        transportPromise.value().close();
      } else {
        transportPromise.cancel();
      }
    });
  },

  /**
   * Called on transport close
   */
  down: function(transport) {
    var connectionType = transport.connectionType;
    var transportPromise = this._transports[connectionType];
    if (!transportPromise) return;

    if (transportPromise.isFulfilled()) {
      var existingTransport = transportPromise.value();
      if (existingTransport !== transport) return;

      // Don't call transport.close as this
      // will be called from the close
      delete this._transports[connectionType];

      // Next time someone does a `.get` we will attempt to reselect
      this._transportPromise = null;
    }
  }

};

module.exports = TransportPool;
