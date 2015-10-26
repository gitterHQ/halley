'use strict';

var Faye = { };
var Transport = require('./transport/transport');
Faye.Client = require('./protocol/client');

Transport.register('in-process'  , require('./transport/node/node_local'));
Transport.register('websocket'   , require('./transport/node/node-websocket'));
Transport.register('long-polling', require('./transport/node/node_http'));

module.exports = Faye;