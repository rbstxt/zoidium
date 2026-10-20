"use strict";
let runtime = null;
function activate(context) {
  const { PZ, document: doc, window: win } = context;
  const require = context.apis.modules.createRequire(context.getAsset, { root: "./plugins/expressions-plus/" });
  const disposers = [];
  context.lifecycle.onDispose(() => { for (const dispose of disposers.splice(0).reverse()) dispose(); runtime = null; });
  function patch(holder, key, make) {
    const original = holder[key], replacement = make(original);
    disposers.push(() => { if (holder[key] === replacement) holder[key] = original; });
    holder[key] = replacement;
  }
  // Reuse the existing Zoidium wiggle implementation without enabling its
  // effect pack or exposing the private evaluation context to expressions.
  const sharedRequire = context.apis.modules.createRequire(context.getAsset, { root: "./plugins/", scope: { PZ } });
  sharedRequire("./trapcode-suite/trapcode-expressions.js");
  const store = require("./controls.js").createControlsStore({ PZ, patch, notify: () => { if (context.editor?.project?.ui) context.editor.project.ui.dirty = true; } });
  const engine = require("./engine.js").installEngine({ PZ, document: doc, patch, wiggleMethods: PZ.trapcode.expressionMethods, controls: sequence => sequence ? store.list(sequence) : [] });
  const controlsUI = require("./controls-ui.js").installControlsUI({ context, store, patch });
  if (context.editor?.sequence) store.ensure(context.editor.sequence);
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
    const timer = win.setInterval(() => { if (el.isConnected) sync(); }, 250);
    disposers.push(() => win.clearInterval(timer));
    update(); return el;
  });
  const api = { engine, controls: store, controlsUI };
  win.ZoidiumExpressions = api;
  disposers.push(() => { if (win.ZoidiumExpressions === api) delete win.ZoidiumExpressions; });
  runtime = { context, engine, store };
}
module.exports = {
  activate,
  isInUse() {
    let used = false;
    if (runtime?.context.editor?.sequence && runtime.store.list(runtime.context.editor.sequence).length) return true;
    runtime?.context.editor?.project?.forEachItemOfType(runtime.context.PZ.property.dynamic, p => { if (p.expression && runtime.engine.isExtended(p.expression)) used = true; });
    return used;
  },
  inUseReason: () => "This project uses Expressions+ syntax or API. Remove those expressions before disabling Expressions+.",
};
