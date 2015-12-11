'use strict';

var ChannelSet = require('../lib/protocol/channel-set');
var assert = require('assert');
var Promise = require('bluebird');
var sinon = require('sinon');

function settleAll(promises) {
  return Promise.all(promises.map(function(promise) { return promise.reflect(); }));
}

describe('channel-set', function() {

  beforeEach(function() {
    this.onSubscribe = sinon.spy(function() {
      return Promise.delay(1);
    });

    this.onUnsubscribe = sinon.spy(function() {
      return Promise.delay(1);
    });

    this.onSubscribeBadChannel = sinon.spy(function() {
      return Promise.delay(1).throw(new Error('Fail'));
    });

    this.onUnsubscribeBadChannel = sinon.spy(function() {
      return Promise.delay(1).throw(new Error('Fail'));
    });

    this.listener1 = function listener1() {};
    this.listener2 = function listener2() {};
    this.listener3 = function listener3() {};

    this.channelSet = new ChannelSet(this.onSubscribe, this.onUnsubscribe);
    this.channelSetBadChannel = new ChannelSet(this.onSubscribeBadChannel, this.onUnsubscribeBadChannel);
  });

  it('should subscribe', function() {
    return this.channelSet.subscribe('/x', this.listener1)
      .bind(this)
      .then(function() {

        assert(this.onSubscribe.calledWith('/x'));
        assert(this.onSubscribe.calledOnce);
      })
      .then(function() {
        assert.deepEqual(this.channelSet.getKeys(), ['/x']);
      });
  });

  it('should serialize multiple subscribes that occur in parallel', function() {
    return Promise.all([
        this.channelSet.subscribe('/x', this.listener1),
        this.channelSet.subscribe('/x', this.listener2),
      ])
      .bind(this)
      .then(function() {
        assert(this.onSubscribe.calledWith('/x'));
        assert(this.onSubscribe.calledOnce);
      })
      .then(function() {
        assert.deepEqual(this.channelSet.getKeys(), ['/x']);
      });
  });

  it('should fail both subscriptions when subscribe occurs in parallel', function() {
    return settleAll([
        this.channelSetBadChannel.subscribe('/x', this.listener1),
        this.channelSetBadChannel.subscribe('/x', this.listener2),
      ])
      .bind(this)
      .each(function(x) {
        assert(x.isRejected());
        assert(this.onSubscribeBadChannel.calledWith('/x'));
        assert(this.onSubscribeBadChannel.calledTwice);
      })
      .then(function() {
        assert.deepEqual(this.channelSetBadChannel.getKeys(), []);
      });
  });

  it('should serialize subscribes followed by unsubscribed', function() {
    return Promise.all([
        this.channelSet.subscribe('/x', this.listener1),
        this.channelSet.unsubscribe('/x', this.listener1),
        this.channelSet.subscribe('/x', this.listener1),
      ])
      .bind(this)
      .then(function() {
        assert(this.onSubscribe.calledWith('/x'));
        assert(this.onSubscribe.calledTwice);

        assert(this.onUnsubscribe.calledWith('/x'));
        assert(this.onUnsubscribe.calledOnce);

        assert.deepEqual(this.channelSet.getKeys(), ['/x']);
      });
  });

  it('should handle parallel subscribes being cancelled', function() {
    var s1 = this.channelSet.subscribe('/x', this.listener1);
    var s2 = this.channelSet.subscribe('/x', this.listener2);

    s1.cancel();

    return s2
      .bind(this)
      .then(function() {
        assert(s1.isCancelled());

        assert(this.onSubscribe.calledWith('/x'));
        assert(this.onSubscribe.calledTwice);
      });

  });

});
