"use strict";
let runtime = null;
function activate(context) {
  const { PZ, document: doc, window: win } = context;
  const require = context.apis.modules.createRequire(context.getAsset, { root: "./plugins/expressions-plus/" });
  const disposers = [];
  let live = true;
  context.lifecycle.onDispose(() => { live = false; for (const dispose of disposers.splice(0).reverse()) dispose(); runtime = null; });
  function patch(holder, key, make) {
    const original = holder[key], implementation = make(original);
    // A later plugin may wrap this method. Its retained reference must become
    // a native passthrough when Expressions+ no longer owns the outer slot.
    const replacement = function () { return (live ? implementation : original).apply(this, arguments); };
    disposers.push(() => { if (holder[key] === replacement) holder[key] = original; });
    holder[key] = replacement;
  }
  // Reuse the existing Zoidium wiggle implementation without enabling its
  // effect pack or exposing the private evaluation context to expressions.
  const sharedRequire = context.apis.modules.createRequire(context.getAsset, { root: "./plugins/", scope: { PZ } });
  sharedRequire("./trapcode-suite/trapcode-expressions.js");
  const store = require("./controls.js").createControlsStore({ PZ, patch, notify: () => { if (context.editor?.project?.ui) context.editor.project.ui.dirty = true; } });
  disposers.push(() => store.detach(context.editor?.sequence));
  const world = require("./world.js").createWorldProvider({ PZ, THREE: win.THREE, patch, createConstraintEvaluator: sharedRequire("./constraints/track-to-evaluate.js").createEvaluator });
  const engine = require("./engine.js").installEngine({ PZ, document: doc, patch, wiggleMethods: PZ.trapcode.expressionMethods, controls: sequence => sequence ? store.list(sequence) : [], world });
  disposers.push(() => engine.restore(context.editor?.project));
  const shaders = require("./shaders.js").installShaders({ PZ, THREE: win.THREE, store, engine, patch, pipeline: context.apis.shaderPipeline, onDispose: fn => disposers.push(fn) });
  const controlsUI = require("./controls-ui.js").installControlsUI({ context, store, patch });
  if (context.editor?.sequence) store.ensure(context.editor.sequence);
  const errorRows = new Set();
  const errorTimer = win.setInterval(() => {
    for (const row of errorRows) { if (!row.el.isConnected) errorRows.delete(row); else row.sync(); }
  }, 250);
  disposers.push(() => { win.clearInterval(errorTimer); errorRows.clear(); });
  patch(PZ.ui.controls, "createExpressionControls", original => function expressionControls(property) {
    const el = original.apply(this, arguments);
    const indicator = el.querySelector('button[title="show error"]'), text = el.querySelector("textarea");
    function update() {
      const error = engine.error(property);
      el.title = error || "Expression";
      if (text) { text.title = error || "Expression"; text.setAttribute("aria-invalid", String(!!error)); }
      if (indicator) { indicator.title = error || "Expression"; indicator.style.display = error ? "" : "none"; }
    }
    if (indicator) indicator.onclick = () => { update(); if (text) text.focus(); };
    let last;
    const sync = () => { const error = engine.error(property); if (error !== last) { last = error; update(); } };
    errorRows.add({ el, sync });
    update(); return el;
  });
  const api = { engine, controls: store, controlsUI, shaders, requires: source => engine.requiresSource(source) };
  win.ZoidiumExpressions = api;
  disposers.push(() => { if (win.ZoidiumExpressions === api) delete win.ZoidiumExpressions; });
  runtime = { context, engine, store, shaders };
}
module.exports = {
  activate,
  isInUse() {
    let used = false;
    if (runtime?.context.editor?.sequence && runtime.store.list(runtime.context.editor.sequence).length) return true;
    runtime?.context.editor?.project?.forEachItemOfType(runtime.context.PZ.property.dynamic, p => { if (p.expression && runtime.engine.isExtended(p.expression)) used = true; });
    runtime?.context.editor?.project?.forEachItemOfType(runtime.context.PZ.effect.shader, effect => {
      if (/\bz(?:Time|Frame)\b|\bctl_\w+|\/\/\s*#include\s*<zoidium\/(?:hash|noise|color|sdf)>/.test(effect.properties.fragShader.get())) used = true;
    });
    return used;
  },
  inUseReason: () => "This project uses Expressions+ syntax or API. Remove those expressions before disabling Expressions+.",
};
