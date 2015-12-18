'use strict';

var fork   = require('child_process').fork;
var assert = require('assert');

describe('client-shutdown-test', function() {

  it('should cleanup after disconnect', function(done) {
    var testProcess = fork(__dirname + '/helpers/cleanup-test-process', [this.urlDirect]);

    testProcess.on('close', function (code) {
      assert.strictEqual(code, 0);
      done();
    });

  });

});
