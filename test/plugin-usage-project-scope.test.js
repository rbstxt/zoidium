"use strict";

// Regression coverage for switch locks after File > New Project: native items
// tracked from the previous project must not keep a plugin in use. Runs the
// real usage functions sliced from plugins/plugin-manager.js.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../plugins/plugin-manager.js"), "utf8");

// Returns one top-level (two-space indented) function declaration by name.
function sliceFunction(name) {
  const start = source.indexOf("\n  function " + name + "(");
  assert.ok(start >= 0, "missing function " + name);
  const end = source.indexOf("\n  }\n", start);
  assert.ok(end > start, "unterminated function " + name);
  return source.slice(start + 1, end + 5);
}

const FUNCTIONS = [
  "debugItemBelongsToProject",
  "activeEditorProject",
  "ownedByActiveProject",
  "setPluginUsageUi",
  "syncUsageTooltip",
  "pluginIsEnabled",
  "pluginUsageReason",
  "refreshPluginUsageLocks",
  "updateNativeFxUsageUi",
  "updatePluginObjectUsageUi",
  "updatePluginResourceUsageUi",
];
const DEFAULT_REASON = source.match(/const DEFAULT_IN_USE_REASON = [^\n]*\n/)[0];

function createHost() {
  const oldProject = { name: "old" };
  const newProject = { name: "new" };
  const pluginStates = new Map();
  const sandbox = {
    window: { CM: { project: oldProject } },
    NATIVE_FX_PLUGIN_ID: "native-fx",
    pluginStates,
    trackedNativeEffects: new Set(),
    missingNativeEffects: new Set(),
    trackedPluginMaterials: new Set(),
    missingPluginMaterials: new Set(),
    trackedPluginObjects: new Set(),
    missingPluginObjects: new Set(),
    trackedPluginResources: new Set(),
    missingPluginResources: new Set(),
    console,
  };
  vm.createContext(sandbox);
  vm.runInContext(
    DEFAULT_REASON + FUNCTIONS.map(sliceFunction).join("\n") + "\nthis.__api = { refreshPluginUsageLocks, updateNativeFxUsageUi, updatePluginObjectUsageUi, updatePluginResourceUsageUi, pluginUsageReason };",
    sandbox,
  );
  function addState(id, name) {
    const state = {
      plugin: { id, name },
      card: { dataset: { phase: "enabled" }, querySelector: () => null },
      toggle: { disabled: false, checked: true },
      usageReason: "",
      runtimeModules: [],
    };
    pluginStates.set(id, state);
    return state;
  }
  return {
    sandbox,
    api: sandbox.__api,
    oldProject,
    newProject,
    addState,
    setProject(project) {
      sandbox.window.CM.project = project;
    },
  };
}

test("effects from the previous project no longer lock the native FX switch after New Project", () => {
  const host = createHost();
  const state = host.addState("native-fx", "Native effects");
  const effect = { parentProject: host.oldProject, _zoidiumPluginMetadata: { id: "magic-looks", effect: "looks", effectName: "Looks" } };
  host.sandbox.trackedNativeEffects.add(effect);
  host.api.updateNativeFxUsageUi();
  assert.equal(state.toggle.disabled, true, "item of the active project locks the switch");

  host.setProject(host.newProject);
  host.api.refreshPluginUsageLocks();
  assert.equal(state.toggle.disabled, false, "the new project has no items, so the switch unlocks");
  assert.equal(state.usageReason, "");
});

test("a plugin with a Magic Looks effect in the old project is not in use in the new one", () => {
  const host = createHost();
  host.addState("magic-looks", "Magic Looks");
  const effect = { parentProject: host.oldProject, _zoidiumPluginMetadata: { id: "magic-looks", effect: "looks", effectName: "Looks" } };
  host.sandbox.trackedNativeEffects.add(effect);
  assert.notEqual(host.api.pluginUsageReason(host.sandbox.pluginStates.get("magic-looks")), "");
  host.setProject(host.newProject);
  assert.equal(host.api.pluginUsageReason(host.sandbox.pluginStates.get("magic-looks")), "");
});

test("object and resource items from the previous project do not lock their plugin", () => {
  const host = createHost();
  const camera = host.addState("camera-plus", "Camera+");
  host.sandbox.trackedPluginObjects.add({
    parentProject: host.oldProject,
    _zoidiumPluginMetadata: { id: "camera-plus", object: "camera", objectName: "Camera" },
  });
  host.api.updatePluginObjectUsageUi("camera-plus");
  assert.equal(camera.toggle.disabled, true);

  host.setProject(host.newProject);
  host.api.refreshPluginUsageLocks();
  assert.equal(camera.toggle.disabled, false);

  const scene = host.addState("scene-plus", "Scene+");
  host.sandbox.trackedPluginResources.add({
    parentProject: host.newProject,
    _zoidiumPluginResourceMetadata: { id: "scene-plus", sprite: "dot", spriteName: "Dot" },
  });
  host.api.updatePluginResourceUsageUi("scene-plus");
  assert.equal(scene.toggle.disabled, true, "a resource of the active project still locks");
  assert.match(host.api.pluginUsageReason(scene), /in use by the project/);
});

test("items of the active project keep their lock across a refresh", () => {
  const host = createHost();
  const state = host.addState("magic-looks", "Magic Looks");
  host.sandbox.trackedNativeEffects.add({
    parentProject: host.newProject,
    _zoidiumPluginMetadata: { id: "magic-looks", effect: "looks", effectName: "Looks" },
  });
  host.setProject(host.newProject);
  host.api.refreshPluginUsageLocks();
  assert.equal(state.toggle.disabled, true);
  assert.equal(state.usageReason.length > 0, true);
});

test("a detached item (no parent project) does not count as in use", () => {
  const host = createHost();
  const state = host.addState("magic-looks", "Magic Looks");
  const detached = {
    get parentProject() { throw new Error("detached"); },
    _zoidiumPluginMetadata: { id: "magic-looks", effect: "looks", effectName: "Looks" },
  };
  host.sandbox.trackedNativeEffects.add(detached);
  host.api.refreshPluginUsageLocks();
  assert.equal(state.toggle.disabled, false);
});

test("without a known project every tracked item still counts (conservative)", () => {
  const host = createHost();
  const state = host.addState("magic-looks", "Magic Looks");
  host.sandbox.trackedNativeEffects.add({
    parentProject: host.oldProject,
    _zoidiumPluginMetadata: { id: "magic-looks", effect: "looks", effectName: "Looks" },
  });
  host.sandbox.window.CM.project = null;
  host.api.refreshPluginUsageLocks();
  assert.equal(state.toggle.disabled, true);
});

test("a loading card is left to its own enable or disable transition", () => {
  const host = createHost();
  const state = host.addState("magic-looks", "Magic Looks");
  state.card.dataset.phase = "loading";
  state.toggle.disabled = true;
  host.api.refreshPluginUsageLocks();
  assert.equal(state.toggle.disabled, true);
});

test("an effect pack switch unlocks as soon as its last native effect is removed", () => {
  const host = createHost();
  const legacy = host.addState("openzoid-legacy", "OpenZoid Legacy");
  const nativeFx = host.addState("native-fx", "Native FX");
  const effect = {
    parentProject: host.oldProject,
    _zoidiumPluginMetadata: { id: "openzoid-legacy", effect: "ascii", effectName: "ASCII" },
  };
  host.sandbox.trackedNativeEffects.add(effect);
  host.api.updateNativeFxUsageUi();
  assert.equal(legacy.toggle.disabled, true, "the pack is locked while its effect exists");
  assert.equal(nativeFx.toggle.disabled, true, "Native FX hosts every native effect");

  host.sandbox.trackedNativeEffects.delete(effect);
  host.api.updateNativeFxUsageUi();
  assert.equal(legacy.toggle.disabled, false, "removing the last effect unlocks the pack");
  assert.equal(nativeFx.toggle.disabled, false);
});
