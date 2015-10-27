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
    this.dispatcher.transportDown = function() { };
  });

  describe("sendMessage", function() {
    beforeEach(function() {
      this.clock = lolex.install();
    });

    afterEach(function() {
      this.clock.uninstall();
    });

    describe("for non-batching transports", function() {
      before(function() {
        this.transport = transportFactory(this.dispatcher, this.dispatcher.endpoint);
        this.mock = sinon.mock(this.transport);
      });

      it("makes a request immediately", function() {
        this.mock.expects("request").withArgs([{ no: "batch" }]).exactly(1);
        this.transport.sendMessage({no: "batch"});
        this.clock.tick(10);
      });
    });
  });
};
