'use strict';

var Faye = { };
var Faye_Transport = require('./transport/transport');
Faye.Client = require('./protocol/client');

Faye_Transport.register('in-process'  , require('./transport/node/node_local'));
Faye_Transport.register('websocket'   , require('./transport/web_socket'));
Faye_Transport.register('long-polling', require('./transport/node/node_http'));

module.exports = Faye;
