'use strict';

var extend = require('./extend');

var classExtend = function(parent, methods, statics, mixins) {
  if (typeof parent !== 'function') {
    mixins = statics;
    statics = methods;
    methods = parent;
    parent  = Object;
  }

  var Klass = function() {
    if (!this.initialize) return this;
    return this.initialize.apply(this, arguments) || this;
  };

  var Bridge = function() {};
  Bridge.prototype = parent.prototype;

  Klass.prototype = new Bridge();
  extend(Klass.prototype, methods);

  if (statics) {
    extend(Klass, statics);
  }

  if (mixins) {
    mixins.forEach(function(mixin) {
      extend(Klass.prototype, mixin);
    });
  }

  return Klass;
};

module.exports = classExtend;
