"use strict";

// Regression coverage for multi-entry objectTypes manifests: every picker
// entry a pack declares for the same target must register (the Rowbyte &
// Red Giant Suite declares Particular, Form, Plexus, and the Light
// replacement), exactly once, with replace/restore bookkeeping intact.
// Runs the real registration loop sliced from plugins/plugin-manager.js.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const projectRoot = path.resolve(__dirname, "..");

function loadRegistrationLoop() {
  const source = fs.readFileSync(path.join(projectRoot, "plugins/plugin-manager.js"), "utf8");
  const startMarker = "for (const definition of manifest.objectTypes";
  const endMarker = "const objectClasses = manifest.objectClasses";
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, "registration loop anchors moved");
  const loop = source.slice(start, end).trimEnd();
  assert.ok(loop.endsWith("}"), "registration loop slice is truncated");
  return loop;
}

function createStore() {
  const vanillaLight = {
    name: "Light",
    desc: "Creates light and shadows in a scene.",
    type: 3,
    hidelist: true,
    list: [{ name: "Spot light", type: 3, data: { objectType: 1 } }],
  };
  const store = { object3d: [{ name: "Shape", type: 0, list: [] }, vanillaLight] };
  return {
    store,
    vanillaLight,
    state: { replacedObjectTypes: [] },
    getObjectTypes: (target) => store[target],
  };
}

function runLoop(manifest, harness) {
  const sandbox = {
    manifest,
    plugin: { id: manifest.id },
    getObjectTypes: harness.getObjectTypes,
    state: harness.state,
  };
  vm.createContext(sandbox);
  vm.runInContext(loadRegistrationLoop(), sandbox);
}

const manifest = JSON.parse(
  fs.readFileSync(path.join(projectRoot, "plugins/trapcode-suite/manifest.json"), "utf8")
);

test("every objectTypes entry of one pack registers on the same target", () => {
  const harness = createStore();
  runLoop(manifest, harness);
  const names = harness.store.object3d.map((entry) => entry.name);
  assert.ok(names.includes("Trapcode Particular"), "Particular entry missing: " + names.join(","));
  assert.ok(names.includes("Trapcode Form"), "Form entry missing: " + names.join(","));
  assert.ok(names.includes("Plexus"), "Plexus entry missing: " + names.join(","));
  const lights = harness.store.object3d.find((entry) => entry.name === "Trapcode Lights");
  assert.ok(lights, "Trapcode Lights entry missing");
  // Six C4D types are offered; legacy IES (6) and Portal (8) still load but are not listed.
  assert.equal(lights.list.length, 8, "Trapcode Lights must carry the 8 C4D entries, IES and Portal included");
  assert.equal(lights._zoidiumPluginId, "trapcode-suite");
  // The stock Light entry is never displaced: Trapcode lights are separate types.
  assert.ok(harness.store.object3d.includes(harness.vanillaLight), "stock Light entry must stay");
  assert.equal(harness.state.replacedObjectTypes.length, 0);
});

test("re-running registration adds no duplicates", () => {
  const harness = createStore();
  runLoop(manifest, harness);
  const before = JSON.stringify(harness.store.object3d);
  runLoop(manifest, harness);
  assert.equal(JSON.stringify(harness.store.object3d), before);
  assert.equal(harness.state.replacedObjectTypes.length, 0);
});
