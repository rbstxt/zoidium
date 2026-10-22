"use strict";
const { shaderSymbols } = require("./code-model.js");

function installCodeWindows({ context, patch, presetFont }) {
  const { PZ, document: doc, window: global } = context;
  const opened = new Map();
  let nextId = 0;
  context.lifecycle.onDispose(() => { for (const win of opened.values()) win.close(); opened.clear(); });

  function open(property, expression = false) {
    const existing = opened.get(property);
    if (existing) { existing.reveal(); return existing; }
    const editor = context.editor, project = editor.project, object = property.parentObject;
    // Check identity through the live tree, including property removal while its
    // effect stays attached. Project replacement also invalidates the target.
    const valid = () => {
      if (editor.project !== project) return false;
      try { return project.addressLookup(property.getAddress()) === property; }
      catch { return false; }
    };
    const title = expression ? "Expression" : "Shader";
    const win = context.ui.openWindow({
      id: "code-" + ++nextId, title, persistKey: "code-" + title.toLowerCase(),
      width: 820, height: 560, minWidth: 380, minHeight: 240,
      isValid: valid, className: "zsp-code-window",
      mount(body) {
        body.classList.add("zsp-code-body");
        function node(tag, cls, text, parent = body) { const el = doc.createElement(tag); el.className = cls; el.textContent = text || ""; parent.append(el); return el; }
        const toolbar = node("div", "zsp-code-toolbar");
        const apply = node("button", "proprow propbutton", "Apply", toolbar); apply.type = "button";
        node("span", "zsp-code-shortcut", "Ctrl/Cmd+S or Ctrl+Enter", toolbar);
        const content = node("div", "zsp-code-content");
        const pane = node("div", "zsp-code-pane", "", content);
        const gutter = node("pre", "zsp-code-gutter", "", pane); gutter.setAttribute("aria-hidden", "true");
        const input = node("textarea", "zsp-code-input", "", pane);
        input.setAttribute("aria-label", title + " source"); input.spellcheck = false; input.wrap = "off";
        const highlight = node("pre", "zsp-code-highlight", "", pane); highlight.setAttribute("aria-hidden", "true");
        const language = expression ? "javascript" : "glsl", grammar = global.Prism?.languages[language];
        if (grammar) pane.classList.add("has-highlight");
        const symbols = expression ? null : node("aside", "zsp-code-symbols", "", content);
        const status = node("div", "zsp-code-status"); status.setAttribute("role", "status");
        const read = () => expression ? property.expression?.source || "" : property.get();
        let aids, checks, templateTools;
        let saved = read(), applying = false, shaderError = "", symbolsStamp = "";
        input.value = saved;
        function lines() { if (grammar) highlight.innerHTML = global.Prism.highlight(input.value + "\n", grammar, language);
          highlight.scrollTop = input.scrollTop; highlight.scrollLeft = input.scrollLeft; gutter.replaceChildren();
          input.value.split("\n").forEach((_, i) => { const row = node("span", checks?.lines().has(i + 1) ? "is-error" : "", String(i + 1), gutter); row.dataset.line = i + 1; });
          gutter.scrollTop = input.scrollTop; }
        function error(message) {
          shaderError = message || ""; status.textContent = shaderError;
          status.title = shaderError; status.classList.toggle("is-error", !!shaderError);
          input.setAttribute("aria-invalid", String(!!shaderError));
        }
        function refresh() {
          const value = read();
          if (!applying && value !== saved) { input.value = value; aids?.reset(); lines(); error(""); }
          saved = value;
          if (expression) error(global.ZoidiumExpressions?.engine.error(property) || property.expression?.error || "");
        }
        function getEntries() {
          let sequence = object;
          while (sequence && !(sequence instanceof PZ.sequence)) sequence = sequence.parent;
          return shaderSymbols(object, { source: input.value, expressions: !!global.ZoidiumExpressions, controls: sequence ? global.ZoidiumExpressions?.controls.list(sequence) || [] : [] });
        }
        function refreshSymbols() {
          if (!symbols) return;
          const entries = getEntries();
          const stamp = JSON.stringify(entries); if (stamp === symbolsStamp) return; symbolsStamp = stamp;
          symbols.replaceChildren(); node("div", "zsp-code-symbol-title", "Available uniforms and helpers", symbols);
          for (const entry of entries) {
            const item = node("div", "zsp-code-symbol-row", "", symbols);
            const button = node("button", "zsp-code-symbol", "", item); button.type = "button"; button.title = entry.hint;
            node("code", "", entry.name, button); node("small", "", entry.type, button);
            button.onclick = () => { aids.insert(entry.category === "include" ? entry.signature : entry.name); };
            const info = node("button", "zsp-code-info", "?", item); info.type = "button"; info.setAttribute("aria-label", "Help for " + entry.name); info.onclick = () => aids.showHelp(entry.name, true);
          }
        }
        function commit() {
          if (!valid()) { win.close(); return; }
          if (editor.history.operation !== null || input.value === read()) return;
          applying = true; error("");
          editor.history.startOperation();
          try {
            const ops = new PZ.ui.properties(editor), address = property.getAddress();
            if (expression) ops.setExpression({ property: address, expression: input.value });
            else ops.setValue({ property: address, value: input.value });
            editor.history.finishOperation(); saved = read();
            if (!shaderError) status.textContent = "Applied";
          } catch (err) { editor.history.discardOperation(); error(String(err.message || err)); }
          finally { applying = false; }
          if (expression) refresh();
        }
        apply.onclick = commit;
        aids = require("./code-aids.js").installAids({ input, pane, body, toolbar, node, global, expression, entries: getEntries, changed() {
          lines(); checks?.schedule(); if (!shaderError) status.textContent = input.value === saved ? "" : "Unapplied changes";
        } });
        if (!expression) checks = require("./code-diagnostics.js").installDiagnostics({ input, pane, body, node, global, context, effect: object, entries: getEntries, aids, valid, status, redraw: lines });
        if (!expression) templateTools = require("./code-templates.js").installTemplates({ context, object, toolbar, node, aids, input, valid, presetFont, error });
        input.onscroll = () => { gutter.scrollTop = input.scrollTop; highlight.scrollTop = input.scrollTop; highlight.scrollLeft = input.scrollLeft; };
        input.onkeydown = event => {
          if (aids.key(event)) { event.preventDefault(); event.stopPropagation(); }
          else if ((event.ctrlKey || event.metaKey) && (event.key.toLowerCase() === "s" || event.key === "Enter")) { event.preventDefault(); commit(); }
        };
        const changed = expression ? property.onExpressionChanged : property.onChanged;
        changed.watch(refresh);
        if (!expression) object.onShaderError?.watch(error);
        const timer = global.setInterval(() => { if (!valid()) { win.close(); return; } refreshSymbols(); if (expression) refresh(); }, 250);
        lines(); refreshSymbols(); refresh(); checks?.schedule(); input.focus();
        return () => {
          templateTools?.dispose(); checks?.dispose(); aids.dispose(); changed.unwatch(refresh); if (!expression) object.onShaderError?.unwatch(error);
          global.clearInterval(timer); opened.delete(property);
        };
      },
    });
    opened.set(property, win); return win;
  }

  patch(PZ.ui.controls, "generateShaderInput", () => function generateShaderInput(property) {
    const root = doc.createElement("div"); root.className = "editbox";
    const button = doc.createElement("button"); button.className = "actionbutton"; button.title = "Open Shader editor";
    const icon = PZ.ui.generateIcon("code"); icon.style.cssText = "width:17px;height:17px;fill:var(--zui-text-muted)";
    button.append(icon); button.onclick = () => open(property); root.append(button);
    root.pz_update = () => {}; return root;
  });
  patch(PZ.ui.controls, "createExpressionControls", original => function expressionControls(property) {
    const root = original.apply(this, arguments);
    const button = root.querySelector('button[title="open expression editor"]');
    if (button) button.onclick = () => open(property, true);
    return root;
  });
  return { open };
}
module.exports = { installCodeWindows };
