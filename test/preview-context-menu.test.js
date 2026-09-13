"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const patchSource = fs.readFileSync(
  path.join(__dirname, "..", "plugins", "core", "preview-context-menu.js"),
  "utf8"
);

function createContext() {
  const registrations = [];
  const target = {
    tagName: "CANVAS",
    addEventListener(type, listener) {
      registrations.push({ type, listener });
    },
  };

  function EditorControls(_camera, domElement) {
    domElement.addEventListener("contextmenu", () => {});
    domElement.addEventListener("mousedown", () => {});
    this.domElement = domElement;
  }
  EditorControls.prototype.dispose = function dispose() {};

  const context = {
    document: {},
    THREE: { EditorControls },
  };
  context.window = context;
  vm.runInNewContext(patchSource, context);

  return { context, registrations, target };
}

test("preview controls leave the native context menu enabled", () => {
  const { context, registrations, target } = createContext();

  new context.THREE.EditorControls({}, target);

  assert.deepEqual(
    registrations.map((registration) => registration.type),
    ["mousedown", "contextmenu"]
  );
  const event = { stopped: false, stopPropagation() { this.stopped = true; } };
  registrations[1].listener(event);
  assert.equal(event.stopped, true);
  assert.equal(target.addEventListener.name, "addEventListener");
});

test("preview control patch is idempotent and keeps the original prototype", () => {
  const { context } = createContext();
  const patched = context.THREE.EditorControls;

  vm.runInNewContext(patchSource, context);

  assert.equal(context.THREE.EditorControls, patched);
  assert.equal(Object.getPrototypeOf(new patched({}, {
    addEventListener() {},
  })), patched.prototype);
});
