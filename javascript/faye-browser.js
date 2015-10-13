'use strict';

var Faye = require('./faye');
var Faye_Transport = require('./transport/transport');
Faye.Client = require('./protocol/client');

/* Register the transports. Order is important */
Faye_Transport.register('websocket'                , require('./transport/web_socket'));
Faye_Transport.register('eventsource'              , require('./transport/browser/event_source'));
Faye_Transport.register('long-polling'             , require('./transport/browser/xhr'));
Faye_Transport.register('cross-origin-long-polling', require('./transport/browser/cors'));
Faye_Transport.register('callback-polling'         , require('./transport/browser/jsonp'));

module.exports = Faye;
