var Faye = require('../../..');

var Promise = require('bluebird');
Promise.longStackTraces();

require('./subscribe-test');
require('./reset-test');
require('./rehandshake-test');
require('./publish-test');
require('./bad-connection-test');
