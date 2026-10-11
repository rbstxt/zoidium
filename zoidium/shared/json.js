// Zoidium shared safe-JSON helpers.
//
// Prototype-pollution-safe parsing and assignment for settings, presets, and
// project fragments: "__proto__", "constructor", and "prototype" keys are
// dropped instead of being assigned. Load order: before
// zoidium/plugin-apis.js (see postInitScripts in zoidium/runtime-config.js).
// plugin-apis.js exposes this table as ZoidiumPluginApis.json.
(function (global) {
  "use strict";

  var UNSAFE_KEYS = ["__proto__", "constructor", "prototype"];

  function isSafeKey(key) {
    return UNSAFE_KEYS.indexOf(key) === -1;
  }

  // Parses JSON text without throwing. Returns the fallback (null by default)
  // for empty input, syntax errors, or non-string input.
  function parseJsonSafe(text, fallback) {
    var bottom = arguments.length > 1 ? fallback : null;
    if (typeof text !== "string" || !text) return bottom;
    try {
      return JSON.parse(text);
    } catch (_error) {
      return bottom;
    }
  }

  // Removes dangerous keys from a plain parsed object, in place, and returns
  // it. Nested objects are cleaned recursively; arrays are walked; other
  // values pass through.
  function cleanParsed(value) {
    if (Array.isArray(value)) {
      value.forEach(cleanParsed);
      return value;
    }
    if (value && typeof value === "object") {
      Object.keys(value).forEach(function (key) {
        if (!isSafeKey(key)) {
          delete value[key];
          return;
        }
        cleanParsed(value[key]);
      });
    }
    return value;
  }

  // Parses JSON text and drops dangerous keys at every depth. Returns the
  // fallback when parsing fails.
  function parseJsonClean(text, fallback) {
    var parsed = parseJsonSafe(text, arguments.length > 1 ? fallback : null);
    if (parsed && typeof parsed === "object") cleanParsed(parsed);
    return parsed;
  }

  // Assigns own enumerable entries of each source onto the target, skipping
  // "__proto__", "constructor", and "prototype" so a parsed payload can never
  // change the target's prototype. Returns the target.
  function safeAssign(target, source) {
    var out = target || {};
    for (var index = 1; index < arguments.length; index += 1) {
      var from = arguments[index];
      if (!from || typeof from !== "object") continue;
      Object.keys(from).forEach(function (key) {
        if (!isSafeKey(key)) return;
        out[key] = from[key];
      });
    }
    return out;
  }

  global.ZoidiumSharedJson = {
    isSafeKey: isSafeKey,
    parseJsonSafe: parseJsonSafe,
    parseJsonClean: parseJsonClean,
    cleanParsed: cleanParsed,
    safeAssign: safeAssign,
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
