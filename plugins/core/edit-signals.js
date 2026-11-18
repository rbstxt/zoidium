// Zoidium Core — edit signals.
// Every user edit reaches the editor as an input event, a CM3 history
// operation, a project load or plugin/asset event, a font load, or an explicit
// touch() from Zoidium code. Between signals the serialized project cannot
// change. The preview cache and the temporal input key reuse their memoized
// values only while the epoch is unchanged and no signal happened inside the
// hot window.
(function installEditSignals(global) {
  "use strict";

  if (global.ZoidiumEditSignals) {
    if (typeof module === "object" && module.exports) module.exports = global.ZoidiumEditSignals;
    return;
  }

  // Edits arrive through input events and native history operations. Their
  // asynchronous follow-up work (file reads, imports) can land a little later,
  // so consumers revalidate for this long after the last signal.
  const HOT_MS = 1500;
  // Boundary reasons that mean the project graph itself changed. Consumers
  // that hold private project copies drop them for these.
  const graphReasons = new Set(["plugin-state-change", "project-load-start", "asset-reloaded"]);

  let epoch = 0;
  let lastSignalAt = -Infinity;
  let pluginEpoch = 0;
  let fontEpoch = 0;
  let gesture = false;
  let disposed = false;
  const listeners = new Set();

  function clock() {
    return typeof performance !== "undefined" && typeof performance.now === "function"
      ? performance.now() : Date.now();
  }

  function reasonOf(source) {
    if (typeof source === "string") return source;
    return source?.type || "observable";
  }

  // Notifies every consumer. A failing listener must not stop the others.
  function signal(source) {
    const reason = reasonOf(source);
    epoch += 1;
    lastSignalAt = clock();
    for (const listener of Array.from(listeners)) {
      try { listener(reason, epoch); }
      catch (error) { console.error("[Zoidium] edit signal listener failed:", error); }
    }
  }

  // For project writes that happen outside an input event or history
  // operation. Keeping the reason in the signal name makes it visible in the
  // preview cache's debug counters.
  function touch(reason) {
    signal(reason ? "api." + reason : "api");
  }

  function subscribe(listener) {
    ensureHistoryHooks();
    listeners.add(listener);
    return { unwatch() { listeners.delete(listener); } };
  }

  function isHot() {
    return clock() - lastSignalAt < HOT_MS;
  }

  const inputEvents = ["pointerdown", "pointermove", "pointerup", "keydown", "keyup", "click",
    "dblclick", "contextmenu", "wheel", "input", "change", "drop", "paste", "touchstart", "touchmove", "touchend",
    "pointercancel", "touchcancel", "blur"];
  function input(event) {
    if (event.type === "pointerdown" || event.type === "touchstart") gesture = true;
    if (event.type === "pointerup" || event.type === "pointercancel" || event.type === "touchend" ||
      event.type === "touchcancel" || event.type === "blur") gesture = false;
    // Hovering cannot edit; dragging moves with a pressed button.
    if (event.type === "pointermove" && !event.buttons) return;
    signal(event);
  }
  if (typeof global.addEventListener === "function") {
    for (const event of inputEvents) global.addEventListener(event, input, true);
  }

  function pluginsChanged() {
    pluginEpoch += 1;
    signal("plugin-state-change");
  }
  function projectLoaded() { signal("project-load-start"); }
  function assetReloaded() { signal("asset-reloaded"); }
  function fontsChanged(event) {
    fontEpoch += 1;
    signal(event?.type ? "fonts." + event.type : "fonts");
  }
  const document = global.document;
  document?.addEventListener?.("zoidium:plugin-state-change", pluginsChanged);
  document?.addEventListener?.("zoidium:project-load-start", projectLoaded);
  document?.addEventListener?.("zoidium:asset-reloaded", assetReloaded);
  document?.fonts?.addEventListener?.("loadingdone", fontsChanged);
  document?.fonts?.addEventListener?.("loadingerror", fontsChanged);

  // Every native edit, undo and redo passes through the history object, also
  // from pop-out editor windows whose input events this document never sees.
  const historyMethods = ["startOperation", "pushCommand", "finishOperation", "discardOperation", "undo", "redo"];
  const originalHistory = new Map();
  let historyPrototype = null;
  function ensureHistoryHooks() {
    const prototype = global.PZ?.ui?.history?.prototype;
    if (!prototype || prototype === historyPrototype) return;
    historyPrototype = prototype;
    for (const name of historyMethods) {
      const original = prototype[name];
      if (typeof original !== "function") continue;
      originalHistory.set(name, original);
      prototype[name] = function signalHistory() {
        signal("history." + name);
        try { return original.apply(this, arguments); }
        finally { signal("history." + name); }
      };
    }
  }
  ensureHistoryHooks();

  function dispose() {
    if (disposed) return;
    disposed = true;
    listeners.clear();
    if (typeof global.removeEventListener === "function") {
      for (const event of inputEvents) global.removeEventListener(event, input, true);
    }
    document?.removeEventListener?.("zoidium:plugin-state-change", pluginsChanged);
    document?.removeEventListener?.("zoidium:project-load-start", projectLoaded);
    document?.removeEventListener?.("zoidium:asset-reloaded", assetReloaded);
    document?.fonts?.removeEventListener?.("loadingdone", fontsChanged);
    document?.fonts?.removeEventListener?.("loadingerror", fontsChanged);
    if (historyPrototype) {
      for (const [name, original] of originalHistory) historyPrototype[name] = original;
      originalHistory.clear();
      historyPrototype = null;
    }
  }

  const api = {
    get epoch() { return epoch; },
    get lastSignalAt() { return lastSignalAt; },
    get pluginEpoch() { return pluginEpoch; },
    get fontEpoch() { return fontEpoch; },
    get hotWindowMs() { return HOT_MS; },
    graphReason(reason) { return graphReasons.has(reason); },
    isHot, touch, signal, subscribe, dispose,
    gestureActive() { return gesture; },
    quietMs() { return clock() - lastSignalAt; },
  };
  global.ZoidiumEditSignals = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
