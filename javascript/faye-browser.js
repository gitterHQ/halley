'use strict';

var Faye = { };
Faye.Client = require('./protocol/client');

var Transport = require('./transport/transport');

/* Register the transports. Order is important */
Transport.register('websocket'       , require('./transport/browser/browser-websocket'));
// TODO: consider eventsource
// Transport.register('eventsource'              , require('./transport/browser/event_source'));
Transport.register('long-polling'    , require('./transport/browser/xhr'));
Transport.register('callback-polling', require('./transport/browser/jsonp'));

module.exports = Faye;
