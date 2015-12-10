# Halley

[![Join the chat at https://gitter.im/gitterHQ/halley](https://badges.gitter.im/Join%20Chat.svg)](https://gitter.im/gitterHQ/halley?utm_source=badge&utm_medium=badge&utm_campaign=pr-badge&utm_content=badge)

Halley is an experimental fork of James Coglan's excellent Faye library.

## Differences from Faye

The main differences from Faye are (listed in no particular order):
* **Uses promises** (and Bluebird's promise cancelleation feature) to do the heavy-lifting whereever possible.
* No Ruby client or server and no server support. Halley is a **Javascript Bayeux client only**
* **Webpack/browserify packaging**
* **Client reset support**. This will force the client to rehandshake. This can be useful when the application realises that the connection is dead before the bayeux client does and allows for faster recovery in these situations.
* **No eventsource support** as we've found them to be unreliable in a ELB/haproxy setup
* All **durations are in milliseconds**, not seconds
* Wherever possible, implementations have been replaced with external libraries:
  * Uses bluebird for promises
  * Uses backbone events (or backbone-events-standalone) for events
  * Mocha and sinon for testing

### Debugging

Halley uses [debug](https://github.com/visionmedia/debug) for debugging. 

  * To enable in nodejs, `export DEBUG=halley:*`
  * To enable in a browser, `window.localStorage.debug='halley:*'`

To limit the amount of debug logging produced, you can specify individual categories, eg `export DEBUG=halley:client`.

## License

(The MIT License)

Copyright (c) 2009-2014 James Coglan and contributors

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the 'Software'), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies
of the Software, and to permit persons to whom the Software is furnished to do
so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED 'AS IS', WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
