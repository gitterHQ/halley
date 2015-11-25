'use strict';

var StateMachineMixin = require('../lib/mixins/statemachine-mixin');
var assert            = require('assert');
var extend            = require('../lib/util/externals').extend;
var Promise           = require('bluebird');

describe('statemachine-mixin', function() {

  describe('normal flow', function() {

    beforeEach(function() {

      var TEST_FSM = {
        name: "test",
        initial: "A",
        transitions: {
          A: {
            t1: "B"
          },
          B: {
            t2: "C"
          },
          C: {
            t3: "A"
          }
        }
      };

      function TestMachine() {
        this.initStateMachine(TEST_FSM);
      }

      TestMachine.prototype = {
      };
      extend(TestMachine.prototype, StateMachineMixin);

      this.testMachine = new TestMachine();
    });

    it('should transition', function(done) {
      this.testMachine.transitionState('t1')
        .bind(this)
        .then(function() {
          assert(this.testMachine.stateIs('B'));
        })
        .nodeify(done);
    });

    it('should serialize transitions', function(done) {
      return Promise.all([
          this.testMachine.transitionState('t1'),
          this.testMachine.transitionState('t2')
        ])
        .bind(this)
        .then(function() {
          assert(this.testMachine.stateIs('C'));
        })
        .nodeify(done);
    });

    it('should handle optional transitions', function(done) {
      this.testMachine.transitionState('doesnotexist', { optional: true })
        .bind(this)
        .then(function() {
          assert(this.testMachine.stateIs('A'));
        })
        .nodeify(done);
    });

    it('should reject invalid transitions', function(done) {
      this.testMachine.transitionState('doesnotexist')
        .bind(this)
        .then(function() {
          assert.ok(false);
        }, function(err) {
          assert.strictEqual(err.message, 'Unable to perform transition doesnotexist from state A');

        })
        .nodeify(done);
    });

    it('should proceed with queued transitions after a transition has failed', function(done) {
      return Promise.all([
          this.testMachine.transitionState('doesnotexist'),
          this.testMachine.transitionState('t1'),
        ].map(function(p) { return p.reflect(); }))
        .bind(this)
        .spread(function(p1, p2) {
          assert(p1.isRejected());
          assert(p2.isFulfilled());
          assert(this.testMachine.stateIs('B'));
        })
        .nodeify(done);

    });
  });

  describe('automatic transitioning', function() {

    beforeEach(function() {

      var TEST_FSM = {
        name: "test",
        initial: "A",
        transitions: {
          A: {
            t1: "B",
            t2: "C"
          },
          B: {
            t3: "C"
          },
          C: {
            t4: "A"
          }
        }
      };

      function TestMachine() {
        this.initStateMachine(TEST_FSM);
      }

      TestMachine.prototype = {
        _onEnterA: function() {
          return 't1';
        },
        _onEnterB: function() {
          return 't3';
        },
        _onEnterC: function() {
        }
      };
      extend(TestMachine.prototype, StateMachineMixin);

      this.testMachine = new TestMachine();

    });

    it('should transition', function(done) {
      this.testMachine.transitionState('t1')
        .bind(this)
        .then(function() {
          assert(this.testMachine.stateIs('C'));
        })
        .nodeify(done);
    });

    it.skip('should reject on state transitions', function(done) {
      return Promise.all([
          this.testMachine.waitForState({
            rejected: 'B',
            fulfilled: 'C'
          }),
          this.testMachine.transitionState('t1')
        ])
        .bind(this)
        .then(function() {
          assert.ok(false);
        }, function(err) {
          assert.strictEqual(err.message, 'State is B');
        })
        .nodeify(done);
    });

    it.skip('should wait for state transitions when already in the state', function(done) {
        this.testMachine.waitForState({
          fulfilled: 'A'
        })
        .bind(this)
        .then(function() {
          assert(this.testMachine.stateIs('A'));
        })
        .nodeify(done);
    });

    it.skip('should reject state transitions when already in the state', function(done) {
      return this.testMachine.waitForState({
          fulfilled: 'C',
          rejected: 'A'
        })
        .bind(this)
        .then(function() {
          assert.ok(false);
        }, function() {
          assert.ok(true);
        })
        .nodeify(done);
    });

    it.skip('should timeout waiting for state transitions', function(done) {
      return this.testMachine.waitForState({
          fulfilled: 'C',
          rejected: 'B',
          timeout: 1
        })
        .bind(this)
        .then(function() {
          assert.ok(false);
        }, function(err) {
          assert.strictEqual(err.message, 'Timeout waiting for state C');
        })
        .nodeify(done);
    });

  });

  describe('error handling', function() {

    beforeEach(function() {

      var TEST_FSM = {
        name: "test",
        initial: "A",
        transitions: {
          A: {
            t1: "B",
            t4: "C",
            t6: 'FAIL_ON_ENTER'
          },
          B: {
            t2: "C",
            error: 'D'
          },
          C: {
            t5: 'E'
          },
          D: {
            t3: "E"
          },
          E: {

          },
          FAIL_ON_ENTER: {

          }
        }
      };

      function TestMachine() {
        this.initStateMachine(TEST_FSM);
      }

      TestMachine.prototype = {
        _onLeaveC: function() {
        },
        _onEnterB: function() {
          throw new Error('Failed to enter B');
        },
        _onEnterFAIL_ON_ENTER: function() {
          throw new Error('Failed on enter');
        }
      };
      extend(TestMachine.prototype, StateMachineMixin);

      this.testMachine = new TestMachine();

    });

    it('should handle errors on transition', function(done) {
      this.testMachine.transitionState('t1')
        .bind(this)
        .then(function() {
          assert(this.testMachine.stateIs('D'));
        })
        .nodeify(done);
    });

    it('should transition to error state before other queued transitions', function(done) {
      return Promise.all([
          this.testMachine.transitionState('t1'),
          this.testMachine.transitionState('t3'),
        ].map(function(p) { return p.reflect(); }))
        .bind(this)
        .spread(function(p1, p2) {
          assert(p1.isFulfilled());
          assert(p2.isFulfilled());
          assert(this.testMachine.stateIs('E'));
        })
        .nodeify(done);
    });


    it('should throw the original error if the state does not have an error transition', function(done) {
      return this.testMachine.transitionState('t6')
        .bind(this)
        .then(function() {
          assert.ok(false);
        }, function(err) {
          assert.strictEqual(err.message, 'Failed on enter');
        })
        .nodeify(done);
    });

  });



});
