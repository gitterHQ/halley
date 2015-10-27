'use strict';

var Promise = require('bluebird');
Promise.longStackTraces();

require('./client-long-polling-test');
require('./client-websockets-test');
require('./client-all-transports-test');
// require('./on-before-unload-test');
// require('./subscribe-test');
// require('./reset-test');
// require('./rehandshake-test');
// require('./publish-test');
// require('./bad-connection-test');
// require('./server-restart-test');
