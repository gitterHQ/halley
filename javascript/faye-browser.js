'use strict';

var Faye = { };
Faye.Client = require('./protocol/client');

var Faye_Transport = require('./transport/transport');

/* Register the transports. Order is important */
Faye_Transport.register('websocket'       , require('./transport/web_socket'));
// TODO: consider eventsource
// Faye_Transport.register('eventsource'              , require('./transport/browser/event_source'));
Faye_Transport.register('long-polling'    , require('./transport/browser/xhr'));
Faye_Transport.register('callback-polling', require('./transport/browser/jsonp'));

module.exports = Faye;
