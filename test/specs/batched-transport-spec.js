/* jshint node:true, unused:true */
var Faye_URI = require('../../../../lib/util/uri');
var lolex = require("lolex");
var sinon = require('sinon');

module.exports = function(transportFactory) {
  before(function() {
    this.dispatcher = {
      endpoint:       Faye_URI.parse("http://example.com/"),
      endpoints:      {},
      maxRequestSize: 2048,
      headers:        {},
      proxy:          {},
      transports:     {},
      wsExtensions:   []
    };

    this.dispatcher.endpointFor = function() { return this.endpoint; };
  });

  describe("sendMessage", function() {
    beforeEach(function() {
      this.clock = lolex.install();
    });

    afterEach(function() {
      this.clock.uninstall();
    });

    describe("for batching transports", function() {
      before(function() {
        this.transport = transportFactory(this.dispatcher, this.dispatcher.endpoint);
        this.mock = sinon.mock(this.transport);
      });

      before(function() {
        this.mock.verify();
      });

      it("does not make an immediate request", function() {
        this.mock.expects("request").never();
        this.transport.sendMessage({ batch: "me" });
      });

      it("queues the message to be sent after a timeout", function() {
        this.mock.expects("request").withArgs([{batch: "me"}]).exactly(1);
        this.transport.sendMessage({ batch: "me" });
        this.clock.tick(10);
      });

      it("allows multiple messages to be batched together", function() {
        this.mock.expects("request").withArgs([{id: 1}, {id: 2}]).exactly(1);
        this.transport.sendMessage({id: 1});
        this.transport.sendMessage({id: 2});
        this.clock.tick(10);
      });

      it("adds advice to connect messages sent with others", function() {
        this.mock.expects("request").withArgs([{channel: "/meta/connect", advice: {timeout: 0}}, {}]).exactly(1);
        this.transport.sendMessage({channel: "/meta/connect"});
        this.transport.sendMessage({});
        this.clock.tick(10);
      });

      it("adds no advice to connect messages sent alone", function() {
        this.mock.expects("request").withArgs([{channel: "/meta/connect"}]).exactly(1);
        this.transport.sendMessage({channel: "/meta/connect"});
        this.clock.tick(10);
      });
    });

  });
};
