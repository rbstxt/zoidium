"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { host } = require("./property-groups-ui-harness");
const { installEditor } = require("../plugins/shader-plus/editor");

test("Show hidden changes only its panel DOM and restores rows on disposal", () => {
  const { PZ, editor, list, doc, panel } = host(), disposers = [];
  editor.playback = { currentFrame: 0 };
  Object.setPrototypeOf(list.parent, PZ.effect.shader.prototype);
  list[0].properties.name.set("Mode"); list[1].definition.zoidiumShader = { visibleWhen: { property: "Mode", values: [3] } };
  PZ.ui.objectTypes = new Map([[PZ.property, []]]);
  PZ.ui.edit.prototype.generateItemCommands = function () {};
  PZ.ui.edit.prototype.generateButton = () => doc.createElement("button");
  PZ.ui.properties = class {};
  const api = installEditor({ context: { PZ, editor, document: doc, window: { setInterval() {}, clearInterval() {} }, lifecycle: { onDispose(fn) { disposers.push(fn); } } },
    patch: (holder, key, make) => { holder[key] = make(holder[key]); }, presetFont: () => null });
  const first = panel(), second = panel();
  function prepare(view) {
    view.options.showPropertyControls = true; view.objectsChanged();
    const heading = view.list.firstElementChild;
    view.generateItemCommands(heading, list);
    const rows = view.el.querySelectorAll("li").filter(row => row.pz_object?.parent === list);
    for (const row of rows) Object.defineProperty(row, "isConnected", { value: true });
    return { rows, button: heading.children[1].firstElementChild };
  }
  const a = prepare(first), b = prepare(second), before = JSON.stringify(list), history = editor.history.undoStack.length;
  api.sync(); assert.equal(a.rows[1].hidden, true); assert.equal(b.rows[1].hidden, true);
  a.button.onclick({ stopPropagation() {} });
  assert.equal(a.button.getAttribute("aria-pressed"), "true");
  assert.equal(a.rows[1].hidden, false); assert.equal(a.rows[1].classList.contains("zsp-hidden-property"), true);
  assert.equal(a.rows[0].classList.contains("zsp-hidden-property"), false);
  assert.equal(b.rows[1].hidden, true, "another panel keeps its own state");
  assert.equal(JSON.stringify(list), before); assert.equal(editor.history.undoStack.length, history);
  a.button.onclick({ stopPropagation() {} }); assert.equal(a.rows[1].hidden, true);
  for (const dispose of disposers.reverse()) dispose();
  assert.equal(a.rows[1].hidden, false); assert.equal(a.rows[1].classList.contains("zsp-hidden-property"), false);
  assert.equal(a.button.parentElement, null);
});
