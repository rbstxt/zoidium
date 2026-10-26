"use strict";

(function (root) {
  const commonJS = typeof module === "object" && module.exports;
  const S = commonJS ? require("./community-safe-json") : root.ZoidiumCommunityJSON;
  const P = commonJS ? require("./community-package") : root.ZoidiumCommunityPackage;
  const keyFor = key => "community-value-" + key;
  function validate(effect) {
    S.data(effect);
    S.keys(effect, ["id", "name", "dataSchema", "template", "properties", "actions", "ui"]);
    if (!/^community-[a-f0-9]{32}-fx-[a-z][a-z0-9-]{0,63}$/.test(effect.id) ||
        typeof effect.name !== "string" || !effect.name.length || effect.name.length > 4096 ||
        effect.dataSchema !== 1 || !["identity-v1", "gain-v1"].includes(effect.template)) S.fail("invalid effect declaration");
    P.properties(effect.properties); P.list(effect.actions, 64); effect.actions.forEach(P.token);
    if (new Set(effect.actions).size !== effect.actions.length) S.fail("duplicate action");
    P.ui(effect.ui, effect.properties, effect.actions);
    return effect;
  }
  function definitions(declaration, types) {
    validate(declaration);
    const out = {};
    for (const p of declaration.properties) {
      // Static properties cannot load or evaluate native expressions. They are
      // hidden from native generators, which accept richer authored metadata.
      out[keyFor(p.key)] = { name: "Community value", visible: false,
        type: p.type === "number" ? types.NUMBER : types.TEXT, value: p.default };
    }
    return out;
  }
  function read(effect, declaration) {
    const values = {};
    for (const p of declaration.properties) values[p.key] = effect.properties[keyFor(p.key)].get();
    P.state(values, declaration.properties);
    return values;
  }
  function apply(effect, declaration, editor, values, valid) {
    S.data(values); P.state(values, declaration.properties);
    if (!valid() || editor.history.operation !== null) return false;
    const changes = Object.entries(values).filter(([key, value]) => effect.properties[keyFor(key)].get() !== value);
    if (!changes.length) return true;
    // One native operation covers a guest patch, including multi-property actions.
    const ops = new root.PZ.ui.properties(editor);
    editor.history.startOperation();
    try {
      for (const [key, value] of changes) {
        const p = effect.properties[keyFor(key)];
        ops.setValue({ property: p.getAddress(), value, oldValue: p.get() });
      }
      editor.history.finishOperation();
    } catch (error) { editor.history.discardOperation(); throw error; }
    return true;
  }
  function mount({ body, effect, declaration, editor, valid, dispatch, ui = root.ZoidiumUI }) {
    // Validate before creating any DOM or invoking a host control builder.
    validate(declaration);
    const bindings = [], buttons = [];
    let closed = false, busy = false, lastAction = -Infinity;
    const alive = () => !closed && valid();
    function sync() {
      const enabled = alive();
      let values;
      try { values = read(effect, declaration); } catch (_) { values = {}; }
      for (const b of bindings) { b.control.setDisabled(!enabled || busy); if (enabled) b.control.set(values[b.key]); }
      for (const control of buttons) control.setDisabled(!enabled || busy);
    }
    async function send(event) {
      if (!alive() || busy || editor.history.operation !== null) { sync(); return; }
      // No queue of action clicks or property gestures can accumulate.
      const now = Date.now();
      if (now - lastAction < 125) { sync(); return; }
      lastAction = now; busy = true; sync();
      try {
        const patch = await dispatch(event);
        if (patch && alive()) apply(effect, declaration, editor, patch, alive);
      } catch (error) {
        if (alive()) status.element.textContent = String(error.message).slice(0, 4096);
      } finally { busy = false; sync(); }
    }
    function nodes(parent, list) {
      for (const node of list) {
        if (node.kind === "section") {
          const section = ui.controls.section({ title: node.label }); parent.appendChild(section.element); nodes(section.body, node.children);
        } else if (node.kind === "label") parent.appendChild(ui.controls.note(node.label).element);
        else if (node.kind === "button") {
          const control = ui.controls.button({ title: node.label, onClick: () => { void send({ action: node.action }); } });
          buttons.push(control); parent.appendChild(control.element);
        } else {
          const p = declaration.properties.find(p => p.key === node.property);
          const config = { label: node.label, value: read(effect, declaration)[p.key],
            onChange: value => { void send({ property: p.key, value }); } };
          let control;
          if (p.type === "number") control = ui.controls.number({ ...config, min: p.min, max: p.max, step: 0.01 });
          else if (p.type === "boolean") control = ui.controls.checkbox(config);
          else if (p.type === "color") control = ui.controls.color(config);
          else control = ui.controls.select({ ...config, options: p.options.map(o => ({ ...o })) });
          bindings.push({ key: p.key, control }); parent.appendChild(control.element);
        }
      }
    }
    const status = ui.controls.note("Community preview. Video and image export are unavailable.");
    body.appendChild(status.element); nodes(body, declaration.ui); sync();
    const timer = setInterval(sync, 250);
    return () => { if (closed) return; closed = true; clearInterval(timer); sync(); };
  }
  const api = { keyFor, validate, definitions, read, apply, mount };
  if (commonJS) module.exports = api; else root.ZoidiumCommunityUI = api;
})(globalThis);
