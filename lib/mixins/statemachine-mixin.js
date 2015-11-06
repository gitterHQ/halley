'use strict';

var Promise = require('bluebird');
var debug   = require('debug')('halley:fsm');
var Events  = require('../util/externals').Events;
var extend  = require('../util/externals').extend;

/**
 * V8 is unable to optimise statements with
 * try-catch, so minimise the size of the
 * unoptimised function
 */
function tryCatch(tryFn, catchFn, context) {
  try {
    tryFn.call(context);
  } catch(e) {
    catchFn.call(context, e);
  }
}

var StateMachineMixin = {
  initStateMachine: function(config) {
      this._config = config;
      this._state = config.initial;
      this._transitionQueue = [];
      this._stateEvents = extend({}, Events);
  },

  getState: function() {
    return this._state;
  },

  stateIs: function() {
    for(var i = 0; i < arguments.length; i++) {
      if(this._state === arguments[i]) return true;
    }

    return false;
  },

  transitionState: function(transition, options) {
    this._queueTransition(transition, options && options.optional);
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

    tryCatch(function() {
      debug('%s: Performing transition: %s', this._config.name, transition);
      var transitions = this._config.transitions;
      var newState = transitions[this._state] && transitions[this._state][transition];

      if (!newState) {
        if(!optional) {
          this._triggerError(new Error('Unable to perform transition ' + transition + ' from state ' + this._state));
        }

        return;
      }

      if (newState === this._state) return;

      debug('%s: leave: %s', this._config.name, this._state);
      this._triggerStateLeave(this._state, newState);

      var oldState = this._state;
      this._state = newState;

      debug('%s enter:%s', this._config.name, this._state);
      this._triggerStateEnter(this._state, oldState);
    }, function(e) {
      this._triggerError(e);
    }, this);

    var self = this;
    this._transitionQueue.shift();

    if(this._transitionQueue.length) {
      setTimeout(function() {
        self._dequeueTransition();
      }, 0);
    }
  },

  _triggerError: function(e) {
    debug('Error during state transition: %s', e);
    if (this._onStateError) {
      this._onStateError(e);
    }
  },

  _triggerStateEnter: function(newState, oldState) {
    this._stateEvents.trigger('enter', newState);
    tryCatch(function() {
      var handler = this['_onEnter' + newState];
      if (handler) {
        handler.call(this, oldState);
      }
    }, function(e) {
      this._triggerError(e);
    }, this);
  },

  _triggerStateLeave: function(currentState, nextState) {
    tryCatch(function() {
      var handler = this['_onLeave' + currentState];
      if (handler) {
        handler.call(this, nextState);
      }
    }, function(e) {
      this._triggerError(e);
    }, this)
  },

  waitForState: function(options) {
    var self = this;

    var fulfilledState = options.fulfilled;
    var rejectedState = options.rejected;
    var timeout = options.timeout;

    if(this._state === fulfilledState) return Promise.resolve();
    if(this._state === rejectedState) return Promise.reject(new Error('State is ' + rejectedState));

    var listener;
    var promise = new Promise(function(resolve, reject) {
      listener = function(newState) {
        if(newState === fulfilledState) {
          resolve();
        } else if (newState === rejectedState){
          reject(new Error('State is ' + newState));
        }
      }.bind(this);

      self._stateEvents.on('enter', listener);
    });

    /* Add a timeout */
    if (timeout) {
      promise = promise.timeout(timeout, 'Timeout waiting for ' + fulfilledState);
    }

    /* Cleanup */
    promise = promise.finally(function() {
      /* Remove the event listener on settle */
      self._stateEvents.off(self, 'enter', listener);
    });

    return promise;
  }
};

module.exports = StateMachineMixin;
