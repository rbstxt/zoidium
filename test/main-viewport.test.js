"use strict";

// Coverage for the main-viewport core script: upstream CM3 builds its main
// viewport without exposing it, while the designer windows borrow
// `editor.mainViewport` for their live previews. The script tracks viewport
// construction and restores the alias once the extension layer is ready.

const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const projectRoot = path.resolve(__dirname, "..");

function loadScript() {
  const full = path.join(projectRoot, "plugins/core/main-viewport.js");
  delete require.cache[require.resolve(full)];
  return require(full);
}

test("viewport construction is tracked and aliased onto editors at ready", () => {
  const g = globalThis;
  const keep = {};
  for (const k of ["PZ", "window", "CM", "VE"]) keep[k] = g[k];
  try {
    class FakeViewport {
      constructor(editor) {
        this.editor = editor || null;
        this.el = { tagName: "DIV" };
      }
    }
    const defined = {};
    const listeners = {};
    g.window = {
      addEventListener: (type, fn) => { listeners[type] = fn; },
    };
    g.PZ = {
      ui: { viewport: FakeViewport },
      zoidium: { define: (name, api) => { defined[name] = api; } },
    };
    loadScript();
    assert.equal(typeof g.PZ.ui.viewport.__zoidiumMainViewport, "boolean");
    // Reloading the script (or a second install) never double-wraps.
    const once = g.PZ.ui.viewport;
    loadScript();
    assert.equal(g.PZ.ui.viewport, once);

    const clipmaker = {};
    const videoeditor = {};
    g.CM = clipmaker;
    g.VE = videoeditor;
    const first = new g.PZ.ui.viewport(clipmaker);
    assert.ok(first instanceof FakeViewport);
    const second = new g.PZ.ui.viewport(videoeditor);
    assert.ok(second instanceof FakeViewport);
    // Nothing aliased before ready fires.
    assert.equal(clipmaker.mainViewport, undefined);
    assert.ok(listeners["zoidium:ready"], "ready listener registered");
    listeners["zoidium:ready"]();
    // Wait out the alias retry tick.
    return new Promise((resolve) => setTimeout(resolve, 50)).then(() => {
      assert.equal(clipmaker.mainViewport, first);
      assert.equal(videoeditor.mainViewport, second);
      assert.ok(defined.mainViewport, "namespace api published");
      assert.equal(defined.mainViewport.for(clipmaker), first);
    });
  } finally {
    for (const k of ["PZ", "window", "CM", "VE"]) {
      if (keep[k] === undefined) delete g[k];
      else g[k] = keep[k];
    }
  }
});

test("missing viewport class installs nothing and never throws", () => {
  const g = globalThis;
  const keepPZ = g.PZ;
  const keepWindow = g.window;
  try {
    g.PZ = { ui: {} };
    g.window = { addEventListener: () => { throw new Error("must not subscribe"); } };
    loadScript();
    g.PZ = undefined;
    loadScript();
  } finally {
    if (keepPZ === undefined) delete g.PZ;
    else g.PZ = keepPZ;
    if (keepWindow === undefined) delete g.window;
    else g.window = keepWindow;
  }
});
