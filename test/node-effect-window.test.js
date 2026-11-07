"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), vm = require("node:vm");
const { FakeElement } = require("./fake-dom");
const model = require("../plugins/node-effect/model.js");
const { compile } = require("../plugins/node-effect/compiler.js");

function surface() {
  const frames = new Map(); let next = 0;
  const view = { document: {}, requestAnimationFrame(fn) { frames.set(++next, fn); return next; },
    cancelAnimationFrame(id) { frames.delete(id); }, frames };
  view.document.defaultView = view;
  view.document.createElement = tag => { const el = new FakeElement(tag); el.ownerDocument = view.document; el.append = (...nodes) => nodes.forEach(node => el.appendChild(node)); return el; };
  view.step = () => { const work = [...frames.values()]; frames.clear(); work.forEach(fn => fn()); };
  return view;
}
test("Node Effect initial framing migrates both pending frames to the popup and cancels on close", () => {
  const main = surface(), popup = surface(); let options, framed = 0;
  vm.runInNewContext(fs.readFileSync("zoidium/ui-kit-popouts.js", "utf8"), { window: main });
  const body = main.document.createElement("div"), handle = main.ZoidiumUIBuilder.popouts.environment(body);
  const observable = { watch() {}, unwatch() {} };
  const effect = { type: 1, customProperties: [], properties: { fragShader: {
    get: () => compile(model.initialGraph()).shader, onChanged: observable,
  } }, onShaderError: observable };
  main.ZoidiumUI = { nodeEditor: () => ({ element: main.document.createElement("div"), frameAll() { framed++; }, destroy() {} }) };
  const modules = name => name === "./shader-check.js" ? { createShaderCheck: () => ({ dispose() {} }) }
    : name === "./recipes.js" ? {} : require("../plugins/node-effect/" + name.slice(2));
  require("../plugins/node-effect/node-effect.js").activate({ PZ: {}, editor: {}, window: main, document: main.document,
    apis: { modules: { createRequire: () => modules } }, lifecycle: { onDispose() {} },
    ui: { controls: { note: () => ({ element: new FakeElement("p") }) }, registerEditor() {}, openWindow(config) { options = config; } },
  });
  main.ZoidiumNodeEffect.open(effect);
  let cleanup = options.mount(body, handle);
  assert.equal(main.frames.size, 1);
  body.ownerDocument = popup.document; handle.refresh();
  assert.equal(main.frames.size, 0); assert.equal(popup.frames.size, 1);
  popup.step(); assert.equal(framed, 0); assert.equal(popup.frames.size, 1);
  popup.step(); assert.equal(framed, 1);
  cleanup();
  cleanup = options.mount(body, handle); popup.step(); cleanup();
  assert.equal(popup.frames.size, 0, "closing cancels the second framing request");
  handle.dispose();
});
