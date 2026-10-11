// Zoidium shared floating-window helpers.
//
// Small pure helpers behind context.ui.openWindow and ZoidiumUI.openWindow:
// persisted window geometry (the same localStorage schema the UI kit uses)
// and Escape-to-close handling. The UI kit owns the live window behavior in
// zoidium/ui-kit.js; these helpers let setup windows and tests share the key
// handling and the geometry map shape without duplicating them. Load order:
// before zoidium/plugin-apis.js (see postInitScripts in
// zoidium/runtime-config.js). plugin-apis.js exposes this table as
// ZoidiumPluginApis.windows.
(function initializeWindows(global) {
  "use strict";

  var GEOMETRY_KEY = "zoidium.ui.windows.v1";

  // True for Escape key events (only the key is tested, so synthetic events
  // and keyboard-layout variants keep working).
  function isEscapeKey(event) {
    return !!event && event.key === "Escape";
  }

  // True when the window should close on this keydown: an unconsumed Escape.
  // Mirrors the UI kit close path in zoidium/ui-kit.js.
  function shouldCloseOnEscape(event) {
    return isEscapeKey(event) && !event.defaultPrevented;
  }

  // Calls handler on an unconsumed Escape keydown on target. Returns a
  // disposer that removes the listener. The target only needs
  // addEventListener/removeEventListener (a DOM element or the window).
  function onEscape(target, handler) {
    function listener(event) {
      if (!shouldCloseOnEscape(event)) return;
      handler(event);
    }
    if (target && typeof target.addEventListener === "function") {
      target.addEventListener("keydown", listener);
    }
    return function disposeEscape() {
      if (target && typeof target.removeEventListener === "function") {
        target.removeEventListener("keydown", listener);
      }
    };
  }

  // Reads the persisted geometry map ({ persistKey: geometry }) from storage.
  // The storage only needs getItem (localStorage by default). Never throws.
  function readWindowGeometries(storage) {
    try {
      var store = storage || (global.localStorage || null);
      var raw = store && store.getItem(GEOMETRY_KEY);
      var parsed = raw ? JSON.parse(raw) : null;
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (_error) {
      return {};
    }
  }

  // Persists one window's geometry under its key. Never throws; storage
  // failures keep the window working for the current session.
  function writeWindowGeometry(storage, key, geometry) {
    if (!key) return;
    try {
      var store = storage || (global.localStorage || null);
      if (!store) return;
      var all = readWindowGeometries(store);
      all[key] = geometry;
      store.setItem(GEOMETRY_KEY, JSON.stringify(all));
    } catch (_error) {
      // Storage is optional.
    }
  }

  global.ZoidiumSharedWindows = {
    GEOMETRY_KEY: GEOMETRY_KEY,
    isEscapeKey: isEscapeKey,
    shouldCloseOnEscape: shouldCloseOnEscape,
    onEscape: onEscape,
    readWindowGeometries: readWindowGeometries,
    writeWindowGeometry: writeWindowGeometry,
  };
  // Serialize this initializer, including its closure state and dependencies.
  // The worker receives the same implementation without fetching overlay files.
  Object.defineProperty(global.ZoidiumSharedWindows, "workerSource", {
    value: function () {
      return "(" + Function.prototype.toString.call(initializeWindows) + ")(globalThis);\n" +
        "globalThis.ZoidiumPluginApis = globalThis.ZoidiumPluginApis || {};\n" +
        "globalThis.ZoidiumPluginApis.windows = globalThis.ZoidiumSharedWindows;\n";
    },
  });
})(typeof globalThis !== "undefined" ? globalThis : this);
