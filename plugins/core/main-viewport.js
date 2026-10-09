(function installMainViewport() {
  "use strict";

  // Upstream CM3 builds its main viewport inside the editor bootstrap but,
  // unlike the OpenZoid checkout, never exposes it. The Trapcode designer,
  // the Optical Flares editor, and the VHS/Datamosh setup windows all borrow
  // `editor.mainViewport` for their live preview panes and render black
  // without it. This core script tracks viewport construction and restores
  // the alias on every known editor instance.
  if (typeof PZ === "undefined" || !PZ.ui || typeof PZ.ui.viewport !== "function") {
    return;
  }
  if (PZ.ui.viewport.__zoidiumMainViewport) {
    return;
  }

  var Original = PZ.ui.viewport;
  var instances = [];

  // Subclassing keeps `instanceof PZ.ui.viewport` (now this class) true and
  // preserves the prototype chain; upstream never `.call`s the constructor
  // and never checks statics, both verified against the staged runtime.
  class TrackedViewport extends Original {
    constructor(...args) {
      super(...args);
      instances.push(this);
    }

    // CM3 disposes a viewport's renderer in unload(). Release the tracked
    // reference and any editor alias pointing at it so a retired viewport is
    // never kept alive or handed to a plugin window as its preview.
    unload(...args) {
      const index = instances.indexOf(this);
      if (index >= 0) instances.splice(index, 1);
      if (this.editor && this.editor.mainViewport === this) this.editor.mainViewport = null;
      return typeof super.unload === "function" ? super.unload(...args) : undefined;
    }
  }
  try {
    Object.defineProperty(TrackedViewport, "name", { value: Original.name || "viewport" });
  } catch (_error) { /* name is cosmetic */ }
  try {
    for (const key of Object.getOwnPropertyNames(Original)) {
      if (key === "prototype" || key === "name" || key === "length") continue;
      TrackedViewport[key] = Original[key];
    }
  } catch (_error) { /* statics are best-effort */ }
  TrackedViewport.__zoidiumMainViewport = true;
  PZ.ui.viewport = TrackedViewport;

  function mainViewportFor(editor) {
    for (let index = instances.length - 1; index >= 0; index -= 1) {
      if (!editor || instances[index].editor === editor) return instances[index];
    }
    return instances.length ? instances[instances.length - 1] : null;
  }

  function aliasEditorViewport() {
    var editors = [];
    try {
      if (typeof globalThis !== "undefined") {
        if (globalThis.CM) editors.push(globalThis.CM);
        if (globalThis.ZOIDIUM_EDITOR && globalThis.ZOIDIUM_EDITOR !== globalThis.CM) {
          editors.push(globalThis.ZOIDIUM_EDITOR);
        }
        if (globalThis.VE) editors.push(globalThis.VE);
      }
    } catch (_error) { /* globals unavailable */ }
    for (const editor of editors) {
      try {
        if (editor && !editor.mainViewport) {
          editor.mainViewport = mainViewportFor(editor);
        }
      } catch (_error) { /* alias is best-effort */ }
    }
  }

  try {
    if (PZ.zoidium && typeof PZ.zoidium.define === "function") {
      PZ.zoidium.define("mainViewport", {
        for: mainViewportFor,
        alias: aliasEditorViewport,
      }, "zoidium/main-viewport");
    }
  } catch (_error) { /* diagnostics must not break boot */ }

  // Viewports are constructed inside initTool(), after pre-init scripts run,
  // so alias once the extension layer reports ready, with a short fallback
  // poll in case the ready event predates this install.
  function aliasWithRetry(attempts) {
    aliasEditorViewport();
    if (attempts > 0) {
      const known = (() => {
        try {
          return !!((globalThis.CM && globalThis.CM.mainViewport) ||
            (globalThis.VE && globalThis.VE.mainViewport));
        } catch (_error) { return true; }
      })();
      if (!known) setTimeout(() => aliasWithRetry(attempts - 1), 500);
    }
  }

  try {
    if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
      window.addEventListener("zoidium:ready", () => aliasWithRetry(5));
    } else {
      aliasWithRetry(5);
    }
  } catch (_error) {
    aliasWithRetry(0);
  }
})();
