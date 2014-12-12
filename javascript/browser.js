'use strict';

var Faye_Client = require('./protocol/client');
require('./transport/cors');
require('./transport/event_source');
require('./transport/jsonp');
require('./transport/web_socket');
require('./transport/xhr');

module.exports = Faye_Client;
