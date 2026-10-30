"use strict";
function applyInstance(coordinates, properties, write, notify) {
  const skipped = [];
  for (const [tag, value] of Object.entries(coordinates || {})) {
    const property = properties["axis_" + tag];
    if (!property || property.expression) { if (property?.expression) skipped.push(tag); continue; }
    write(property, value);
  }
  if (skipped.length) notify("Expression-driven axes were kept: " + skipped.join(", ") + ".");
}
function install(context) {
  const PZ = context.PZ || window.PZ, editor = context.editor || window.CM;
  const at = property => require("./text-properties.js").localFrame(property, editor, PZ);
  function transaction(work) {
    if (editor.history.operation !== null) return;
    editor.history.startOperation();
    try { work(new PZ.ui.properties(editor)); } finally { editor.history.finishOperation(); }
  }
  function set(ops, property, value, frame) {
    if (property.animated) ops.startEdit(property, frame);
    ops.setValue({ property: property.getAddress(), value, frame, oldValue: property.get(frame) });
  }
  context.lifecycle.onDispose(context.apis.propertyControls.register("shape-plus/source-text", { type: PZ.property.type.TEXT, create(property) {
    const input = document.createElement("textarea"); input.setAttribute("aria-label", "Source Text"); input.rows = 3;
    input.style.cssText = "width:100%;resize:vertical;box-sizing:border-box";
    let editing = false, frame;
    input.pz_update = () => { if (!editing) input.value = String(require("./text-properties.js").holdValue(property, at(property))); };
    input.onfocus = () => {
      if (editor.history.operation !== null) return;
      frame = at(property);
      editor.history.startOperation(); editing = editor.history.operation;
    };
    input.oninput = () => { if (editing && editor.history.operation === editing) set(new PZ.ui.properties(editor), property, input.value, frame); };
    const finish = () => { if (editing && editor.history.operation === editing) editor.history.finishOperation(); editing = false; };
    input.onblur = finish;
    input.onkeydown = event => { event.stopPropagation(); if (event.key === "Escape" && !event.isComposing) { event.preventDefault(); input.blur(); } };
    input.pz_update(); return input;
  } }));
  context.lifecycle.onDispose(context.apis.propertyControls.register("shape-plus/font-style", { type: PZ.property.type.LIST, create(property) {
    const select = document.createElement("select"); select.setAttribute("aria-label", "Style");
    select.pz_update = () => {
      const items = property.definition.items || [];
      const signature = JSON.stringify(items);
      if (select.dataset.items !== signature) { select.replaceChildren(...items.map(item => new Option(item.name, item.value))); select.dataset.items = signature; }
      select.value = require("./text-properties.js").holdValue(property, at(property));
    };
    select.onchange = () => transaction(ops => {
      const node = property.parentObject, font = node.textState?.primary, instance = font?.instances.find(item => item.name === select.value);
      const frame = at(property);
      set(ops, property, select.value, frame);
      applyInstance(instance?.coordinates, node.properties, (axis, value) => set(ops, axis, value, frame), message => context.ui.notify({title:"Shape+",message}));
    });
    select.pz_update(); return select;
  } }));
}
module.exports = { install, applyInstance };
