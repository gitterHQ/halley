'use strict';

var Faye_Client = require('./protocol/client');
require('./transport/web_socket');
require('./transport/event_source');
require('./transport/xhr');
require('./transport/cors');
require('./transport/jsonp');

module.exports = Faye_Client;
