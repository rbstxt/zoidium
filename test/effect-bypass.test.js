"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

function setup() {
  class Effect {
    constructor() { this.parent = null; this.prepared = 0; }
    get parentObject() { return this.parent?.parent || null; }
    getAddress() { return [0]; }
    load() {}
    prepare() { this.prepared++; }
    toJSON() { return { type: this.type }; }
  }
  class Group extends Effect { constructor() { super(); this.objects = []; this.enabled = true; } }
  Effect.group = Group;
  Effect.create = type => { const effect = type === "group" ? new Group() : new Effect(); effect.type = type; return effect; };
  class Edit { generateListItem() {} }
  class Compositor { renderEffects(effects) { for (const effect of effects) {
    if (effect instanceof Group) { if (effect.enabled) this.renderEffects(effect.objects); }
    else effect.pass?.render();
  } } }
  const window = { PZ: { effect: Effect, ui: { edit: Edit }, compositor: Compositor }, WeakRef };
  for (const file of ["effect-bypass.js", "effect-bypass-render.js"]) {
    vm.runInNewContext(fs.readFileSync(`plugins/core/${file}`, "utf8"), { window });
  }
  return window;
}

test("state round trips, old effects stay active, and group bypass covers children", () => {
  const w = setup(), E = w.PZ.effect, api = w.PZ.zoidium.effectBypass;
  const group = E.create("group"), child = E.create("child");
  child.parent = { parent: group }; group.objects.push(child);
  group.load({}); child.load({});
  assert.equal(api.bypassed(child), false);
  group.zoidiumBypassed = true;
  assert.equal(api.bypassed(child), true);
  child.prepare(); assert.equal(child.prepared, 0);
  const saved = JSON.parse(JSON.stringify(group));
  const restored = E.create("group"); restored.load(saved);
  assert.equal(restored.zoidiumBypassed, true);
  assert.equal(JSON.parse(JSON.stringify(E.create("old"))).zoidiumBypassed, undefined);
});

test("toggle creates one reversible history operation and invalidates edits", () => {
  const w = setup(), effect = w.PZ.effect.create("test"), api = w.PZ.zoidium.effectBypass;
  let signal = 0, command;
  w.ZoidiumEditSignals = { touch() { signal++; } };
  const history = { operation: null, startOperation() { this.operation = []; },
    pushCommand(fn, data) { command = { fn, data }; }, finishOperation() { this.operation = null; } };
  const editor = { history, project: { addressLookup() { return effect; } } };
  assert.equal(api.toggle(editor, effect), true);
  assert.equal(effect.zoidiumBypassed, true);
  command.fn(command.data);
  assert.equal(effect.zoidiumBypassed, false);
  command.fn(command.data);
  assert.equal(effect.zoidiumBypassed, true);
  assert.equal(signal, 3);
});

test("compositor skips bypassed effects and groups", () => {
  const w = setup(), E = w.PZ.effect, compositor = new w.PZ.compositor();
  const group = E.create("group"), child = E.create("child"), effect = E.create("other");
  let renders = 0;
  child.parent = { parent: group }; group.objects.push(child);
  child.pass = effect.pass = { render() { renders++; } };
  compositor.renderEffects([group, effect]); assert.equal(renders, 2);
  group.zoidiumBypassed = true; effect.zoidiumBypassed = true;
  compositor.renderEffects([group, effect]); assert.equal(renders, 2);
});

test("time operators ignore bypass while retaining their own enabled state", () => {
  const previous = global.PZ;
  try {
    global.PZ = { zoidium: { effectBypass: { bypassed: effect => effect.zoidiumBypassed === true } } };
    const layers = require("../plugins/core/temporal-layers.js");
    const effect = { _zoidiumTemporal: { getOperator: () => ({ kind: "time-offset", enabled: false }) } };
    assert.equal(layers.readTemporalOperators({ effects: [effect] }, 0).length, 1);
    effect.zoidiumBypassed = true;
    assert.equal(layers.readTemporalOperators({ effects: [effect] }, 0).length, 0);
  } finally { global.PZ = previous; }
});

test("export preparation skips bypassed group children", async () => {
  const calls = [];
  class Group { async prepare() {} }
  const PZ = { effect: { group: Group }, zoidium: { effectBypass: { bypassed: effect => effect.zoidiumBypassed } } };
  const sandbox = { PZ, console };
  vm.runInNewContext(fs.readFileSync("plugins/core/temporal-export.js", "utf8"), sandbox);
  sandbox.__zoidiumTemporalParts.exportPreparation.installPreparationPolicy();
  const group = new Group();
  group.objects = [{ prepare: async () => calls.push("active") },
    { zoidiumBypassed: true, prepare: async () => calls.push("bypassed") }];
  await group.prepare(0, { exportPolicy: {} });
  assert.deepEqual(calls, ["active"]);
});
