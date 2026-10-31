"use strict";
// Themed Source Text and Style controls for Shape+ text items.
//
// The controls reuse CM3's native property markup (div.editbox wrapping an
// input with class pz-inputbox, like generateTextInput/generateListInput) so
// they follow the dark theme, link-blue values and hue/saturation variables
// through zoidium/ui-overrides.css. No inline colours are used; the only
// Shape+ rules live in the injected <style> below (see native-ui.js for the
// same pattern) and size the multiline field.
const STYLE_ID = "shape-plus-text-controls";
function ensureStyle(document) {
  if (!document || document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  // The field auto-grows from one line to about six through fit() below and
  // then scrolls; the max-height here is only a backstop for that script.
  style.textContent = ".shape-plus-source-text{width:100%;box-sizing:border-box;resize:vertical;overflow-y:auto;font:inherit;white-space:pre-wrap;word-break:break-word;min-height:calc(1.5em + 6px);max-height:calc(9em + 6px)}";
  document.head.appendChild(style);
}
// Grow the field to its content up to about six lines, then let it scroll.
function fit(input) {
  const view = input.ownerDocument && input.ownerDocument.defaultView;
  const style = view && typeof view.getComputedStyle === "function" ? view.getComputedStyle(input) : null;
  const line = (style && parseFloat(style.lineHeight)) || 16;
  const pad = (style && (parseFloat(style.paddingTop) + parseFloat(style.paddingBottom))) || 0;
  const border = (style && (parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth))) || 0;
  input.style.height = "auto";
  input.style.height = Math.min(input.scrollHeight, Math.round(line * 6 + pad)) + border + "px";
}
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
  ensureStyle(typeof document !== "undefined" ? document : null);
  context.lifecycle.onDispose(() => {
    if (typeof document !== "undefined") document.getElementById(STYLE_ID)?.remove();
  });
  const PZ = context.PZ || window.PZ, editor = context.editor || window.CM;
  const at = property => require("./text-properties.js").localFrame(property, editor, PZ);
  function transaction(work) {
    if (editor.history.operation !== null) return;
    editor.history.startOperation();
    try { work(new PZ.ui.properties(editor)); }
    finally { editor.history.finishOperation(); }
  }
  function set(ops, property, value, frame) {
    if (property.animated) ops.startEdit(property, frame);
    ops.setValue({ property: property.getAddress(), value, frame, oldValue: property.get(frame) });
  }
  context.lifecycle.onDispose(context.apis.propertyControls.register("shape-plus/source-text", { type: PZ.property.type.TEXT, create(property) {
    const wrap = document.createElement("div");
    wrap.className = "editbox";
    const input = document.createElement("textarea");
    input.className = "pz-inputbox shape-plus-source-text";
    input.setAttribute("aria-label", "Source Text");
    wrap.append(input);
    let editing = false, frame;
    wrap.pz_update = () => {
      input.readOnly = !!property.expression;
      if (editing) return;
      input.value = String(require("./text-properties.js").holdValue(property, at(property)));
      fit(input);
    };
    input.onfocus = () => {
      if (editor.history.operation !== null) return;
      frame = at(property);
      editor.history.startOperation(); editing = editor.history.operation;
    };
    input.oninput = () => { if (editing && editor.history.operation === editing) { set(new PZ.ui.properties(editor), property, input.value, frame); fit(input); } };
    const finish = () => { if (editing && editor.history.operation === editing) editor.history.finishOperation(); editing = false; };
    input.onblur = finish;
    input.onkeydown = event => { event.stopPropagation(); if (event.key === "Escape" && !event.isComposing) { event.preventDefault(); input.blur(); } };
    wrap.pz_update(); return wrap;
  } }));
  context.lifecycle.onDispose(context.apis.propertyControls.register("shape-plus/font-style", { type: PZ.property.type.LIST, create(property) {
    const wrap = document.createElement("div");
    wrap.className = "editbox";
    const select = document.createElement("select");
    select.className = "pz-inputbox";
    select.setAttribute("aria-label", "Style");
    wrap.append(select);
    wrap.pz_update = () => {
      const items = property.definition.items || [];
      const signature = JSON.stringify(items);
      if (select.dataset.items !== signature) {
        select.replaceChildren(...items.map(item => {
          const option = new Option(item.name, item.value);
          option.pz_value = item.value;
          return option;
        }));
        select.dataset.items = signature;
      }
      const current = require("./text-properties.js").holdValue(property, at(property));
      select.selectedIndex = Math.max(0, items.findIndex(item => item.value === current));
    };
    select.onchange = () => transaction(ops => {
      const value = select.children[select.selectedIndex]?.pz_value ?? select.value;
      const node = property.parentObject, font = node.textState?.primary, instance = font?.instances.find(item => item.name === value);
      const frame = at(property);
      set(ops, property, value, frame);
      applyInstance(instance?.coordinates, node.properties, (axis, axisValue) => set(ops, axis, axisValue, frame), message => context.ui.notify({ title: "Shape+", message }));
    });
    wrap.pz_update(); return wrap;
  } }));
}
module.exports = { install, applyInstance };
