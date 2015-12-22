'use strict';

var Promise       = require('bluebird');
var Sequencer     = require('../util/promise-util').Sequencer;
var cancelBarrier = require('../util/promise-util').cancelBarrier;
var debug         = require('debug')('halley:fsm');

var StateMachineMixin = {
  initStateMachine: function(config) {
    this._config = config;
    this._state = config.initial;
    this._sequencer = new Sequencer();
    this._pendingTransitions = {};
  },

  getState: function() {
    return this._state;
  },

  stateIs: function() {
    // 99% case optimisation
    if (arguments.length === 1) {
      return this._state === arguments[0];
    }

    for(var i = 0; i < arguments.length; i++) {
      if(this._state === arguments[i]) return true;
    }

    return false;
  },

  transitionState: function(transition, options) {
    var pending = this._pendingTransitions;

    if (options && options.dedup) {
      // The caller can specify that it there is already
      // a pending transition of the given type
      // wait on that, rather than queueing another.
      if (pending[transition]) {
        debug('transition state: %s (dedup)', transition);
        return pending[transition];
      }
    }

    var next = this._sequencer.chain(function() {
      return this._dequeueTransition(transition, options);
    }.bind(this));

    if (!pending[transition]) {
      // If this is the first transition of it's type
      // save it for deduplication
      pending[transition] = next;
    }

    return next.finally(function() {
      if (pending[transition] === next) {
        delete pending[transition];
      }
    });
  },

  _dequeueTransition: Promise.method(function(transition, options) {
    var optional = options && options.optional;

    debug('%s: Performing transition: %s', this._config.name, transition);
    var newState = this._findTransition(transition);
    if (!newState) {
      if(!optional) {
        throw new Error('Unable to perform transition ' + transition + ' from state ' + this._state);
      }

      return null;
    }

    if (newState === this._state) return null;

    debug('%s: leave: %s', this._config.name, this._state);
    this._triggerStateLeave(this._state, newState);

    var oldState = this._state;
    this._state = newState;

    debug('%s enter:%s', this._config.name, this._state);
    var promise = this._triggerStateEnter(this._state, oldState)
      .bind(this)
      .then(function(nextTransition) {
        if (nextTransition) {
          return this._dequeueTransition(nextTransition);
        }

        return Promise.resolve();
      })
      .catch(function(err) {
        debug('Error while entering state %s: %s', this._state, err);
        var errorTransitionState = this._findTransition('error');
        if (errorTransitionState) {
          return this._dequeueTransition('error');
        }

        /* No error handler, just throw */
        throw err;
      });


    // State transitions can't be cancelled
    return cancelBarrier(promise);
  }),

  /* Find the next state, given the current state and a transition */
  _findTransition: function(transition) {
    var currentState = this._state;
    var transitions = this._config.transitions;
    var newState = transitions[currentState] && transitions[currentState][transition];
    if (newState) return newState;

    var globalTransitions = this._config.globalTransitions;
    return globalTransitions && globalTransitions[transition];
  },

  _triggerStateLeave: Promise.method(function(currentState, nextState) {
    var handler = this['_onLeave' + currentState];
    if (handler) {
      return handler.call(this, nextState);
    }
  }),

  _triggerStateEnter: Promise.method(function(newState, oldState) {
      var handler = this['_onEnter' + newState];
      if (handler) {
        return handler.call(this, oldState);
      }
  })
};

module.exports = StateMachineMixin;
