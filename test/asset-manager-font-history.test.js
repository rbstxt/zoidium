"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const { createResolveFonts } = require("../plugins/asset-manager/assets-fonts.js");

test("resolving two fonts is one undo and redo step", async () => {
  const undo = [], redo = [], values = { a: "a", b: "b" };
  const history = { operation: null,
    startOperation() { this.operation = []; },
    pushCommand(fn) { this.operation.push(fn); },
    finishOperation() { if (this.operation.length) undo.push(this.operation); this.operation = null; },
    replay(from, to) { const commands = from.pop(); this.operation = []; commands.slice().reverse().forEach(fn => fn()); to.push(this.operation); this.operation = null; } };
  function set(key, value) { const old = values[key]; values[key] = value; history.pushCommand(() => set(key, old)); }
  const project = {}, editor = { project, history };
  const items = ["a", "b"].map(id => ({ id, name: id, kind: "font", status: "missing", usages: [{}] }));
  const registry = { snapshot: () => ({ items }), builtInFonts: () => [] };
  const choices = [];
  const controls = {
    note: () => ({ element: {} }), section: () => ({ element: {}, body: { appendChild() {} } }),
    select: options => { choices.push(options); return { element: {} }; }, button: () => ({ element: {} }),
  };
  let footer;
  const win = { close() {}, reveal() {} };
  const session = { document: {}, editor: () => editor, kit: { controls }, registry: () => registry,
    context: { ui: { getWindow: () => null, openWindow(options) { footer = options.footer; options.mount({ textContent: "", appendChild() {} }); return win; } } },
    notify() {}, actions: { async replace(item, target) {
      const opened = !history.operation;
      if (opened) history.startOperation();
      set(item.id, target.itemId);
      if (opened) history.finishOperation();
    } } };
  createResolveFonts(session).open();
  choices[0].onChange("new-a"); choices[1].onChange("new-b");
  await footer[0].onClick();
  assert.deepEqual(values, { a: "new-a", b: "new-b" });
  assert.equal(undo.length, 1);
  history.replay(undo, redo);
  assert.deepEqual(values, { a: "a", b: "b" });
  history.replay(redo, undo);
  assert.deepEqual(values, { a: "new-a", b: "new-b" });
});
