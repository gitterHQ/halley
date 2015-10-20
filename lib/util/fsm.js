'use strict';

var Events            = require('backbone-events-standalone');
var Promise           = require('bluebird');
var debug             = require('debug-proxy')('faye:fsm');
var extend            = require('./extend');

function StateMachine(config) {
  this._config = config;
  this._state = config.initial;
  this._transitionQueue = [];
}

StateMachine.prototype = {
  getState: function() {
    return this._state;
  },

  stateIs: function() {
    for(var i = 0; i < arguments.length; i++) {
      if(this._state === arguments[i]) return true;
    }

    return false;
  },

  transition: function(transition) {
    this._queueTransition(transition);
  },

  _queueTransition: function(transition, optional) {
    this._transitionQueue.push({ transition: transition, optional: optional });

    if(this._transitionQueue.length == 1) {
      this._dequeueTransition();
    }
  },

  _dequeueTransition: function() {
    var transitionDetails = this._transitionQueue.shift();
    if(!transitionDetails) return;

    var transition = transitionDetails.transition;
    var optional = transitionDetails.optional;

    try {
      var transitions = this._config.transitions;
      var newState = transitions[this._state] && transitions[this._state][transition];

      if (!newState) {
        if(!optional) {
          this.trigger('error', new Error('Unable to perform transition ' + transition + ' from state ' + this._state));
        }

        return;
      }

      if (newState === this._state) return;

      this.trigger('transition', transition, this._state, newState);
      debug('%s: leave: %s', this._config.name, this._state);
      this.trigger('leave:' + this._state, newState);

      var oldState = this._state;
      this._state = newState;

      debug('%s enter:%s', this._config.name, this._state);
      this.trigger('enter:' + this._state, oldState);
    } catch(e) {
      this.trigger('error', e);
    } finally {
      var self = this;
      this._transitionQueue.shift();

      if(this._transitionQueue.length) {
        setTimeout(function() {
          self._dequeueTransition();
        }, 0);
      }
    }
  },

  transitionIfPossible: function(transition) {
    this._queueTransition(transition, true);
  },

  waitFor: function(options) {
    var self = this;

    if(this._state === options.fulfilled) return Promise.resolve();
    if(this._state === options.rejected) return Promise.reject();

    return new Promise(function(resolve, reject) {
      var timeoutId;
      var fulfilled = options.fulfilled;
      var rejected = options.rejected;
      var timeout = options.timeout;

      var listener = function(transition, oldState, newState) {
        if(newState === fulfilled || newState === rejected) {
          self.stopListening(self, 'transition', listener);
          clearTimeout(timeoutId);

          if(newState === fulfilled) {
            resolve();
          } else {
            reject(new Error('State is ' + newState));
          }
        }

      };

      if(timeout) {
        timeoutId = setTimeout(function() {
          self.stopListening(self, 'transition', listener);
          reject(new Error('Timeout waiting for ' + fulfilled));
        }, timeout);
      }

      self.listenTo(self, 'transition', listener);
    });
  }
};

/* Mixins */
extend(StateMachine.prototype, Events);

module.exports = StateMachine;
