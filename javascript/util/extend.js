'use strict';

module.exports = function(dest, source) {
  if (!source) return dest;

  var keys = Object.keys(source);
  for (var i = 0; i < keys.length; i++) {
    var key = keys[i];
    dest[key] = source[key];
  }

  return dest;
};
