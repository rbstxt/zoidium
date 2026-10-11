// Zoidium shared property readers.
//
// Safe reads of CM3 dynamic properties at a time: every reader falls back
// instead of throwing, so a broken expression or a detached layer can never
// break a render. Load order: before zoidium/plugin-apis.js (see
// postInitScripts in zoidium/runtime-config.js). plugin-apis.js exposes this
// table as ZoidiumPluginApis.props.
(function initializeProps(global) {
  "use strict";

  // Finite number or fallback (plugins/core/object3d-registry.js semantics).
  function finiteOr(value, fallback) {
    return typeof value === "number" && Number.isFinite(value) ? value : fallback;
  }

  // Coercing scalar helper used by Scene+ serialized controls.
  function numberValue(value, fallback) {
    var number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  // Material+ permits numeric strings and absent optional property getters.
  // Keep this separate from readNumber, whose strict number semantics differ.
  function readNumberCoerced(property, time, fallback) {
    try {
      var value = property?.get?.(time);
      return Number.isFinite(Number(value)) ? Number(value) : fallback;
    } catch (_error) {
      // Dynamic properties may be unavailable before their native load.
      return fallback;
    }
  }

  // Deep-clones JSON data through a serialize round-trip. Returns the input
  // unchanged when it cannot be cloned (never throws).
  function cloneJson(value) {
    if (value === undefined) {
      return undefined;
    }
    if (value === null) {
      return null;
    }
    try {
      return JSON.parse(JSON.stringify(value));
    } catch (_error) {
      return value;
    }
  }

  // Stricter clone for reset/default data (plugins/core/particle-defaults.js
  // semantics): functions and undefined clone to undefined instead of leaking
  // a live reference through the catch path.
  function cloneJsonValue(value) {
    if (value === undefined || typeof value === "function") return undefined;
    if (value === null || typeof value !== "object") return value;
    try {
      return JSON.parse(JSON.stringify(value));
    } catch (_error) {
      return value;
    }
  }

  // Reads a dynamic number property at a time, falling back when the value is
  // not finite (for example a broken focus expression). Exact semantics of
  // the Camera+ reader in plugins/camera-plus/camera-class.js.
  function readNumber(property, time, fallback) {
    try {
      var value = property.get(time);
      return typeof value === "number" && isFinite(value) ? value : fallback;
    } catch (_error) {
      return fallback;
    }
  }

  // Reads a dynamic vector property at a time. Each component falls back
  // independently, so a partially broken value still yields a usable vector.
  // The fallback is never mutated; pass a fresh array per call or reuse a
  // frozen constant.
  function readVector(property, time, fallback) {
    var clean = Array.isArray(fallback) ? fallback : [];
    var raw = null;
    try {
      raw = property.get(time);
    } catch (_error) {
      raw = null;
    }
    if (!Array.isArray(raw)) return clean.slice();
    return clean.map(function (slot, index) {
      var value = Number(raw[index]);
      return Number.isFinite(value) ? value : slot;
    });
  }

  // Reads a dynamic color property at a time as [r, g, b] in [0, 1]. Missing
  // or non-finite channels fall back per channel; longer vectors (rgba) keep
  // only their first three entries.
  function readColor(property, time, fallback) {
    var clean = Array.isArray(fallback) ? fallback.slice(0, 3) : [0, 0, 0];
    while (clean.length < 3) clean.push(0);
    var raw = null;
    try {
      raw = property.get(time);
    } catch (_error) {
      raw = null;
    }
    if (!Array.isArray(raw)) return clean;
    return clean.map(function (slot, index) {
      var value = Number(raw[index]);
      return Number.isFinite(value) ? value : slot;
    });
  }

  // Iterates the own entries of a property map (effect.properties, layer
  // properties). Skips nothing: callers filter by key.
  function forEachProp(properties, visit) {
    if (!properties || typeof visit !== "function") return;
    Object.keys(properties).forEach(function (key) {
      visit(properties[key], key);
    });
  }

  global.ZoidiumSharedProps = {
    finiteOr: finiteOr,
    numberValue: numberValue,
    readNumberCoerced: readNumberCoerced,
    cloneJson: cloneJson,
    cloneJsonValue: cloneJsonValue,
    readNumber: readNumber,
    readVector: readVector,
    readColor: readColor,
    forEachProp: forEachProp,
  };
  // Serialize this initializer, including its closure state and dependencies.
  // The worker receives the same implementation without fetching overlay files.
  Object.defineProperty(global.ZoidiumSharedProps, "workerSource", {
    value: function () {
      return "(" + Function.prototype.toString.call(initializeProps) + ")(globalThis);\n" +
        "globalThis.ZoidiumPluginApis = globalThis.ZoidiumPluginApis || {};\n" +
        "globalThis.ZoidiumPluginApis.props = globalThis.ZoidiumSharedProps;\n";
    },
  });
})(typeof globalThis !== "undefined" ? globalThis : this);
