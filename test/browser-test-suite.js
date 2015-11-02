'use strict';

var Promise = require('bluebird');
Promise.longStackTraces();

require('./transport-xhr-test');
require('./transport-browser-websocket-test');
