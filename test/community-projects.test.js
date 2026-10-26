"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const Projects = require("../zoidium/community-projects");
const { migrateProject } = require("../zoidium/project-compatibility");
const manifest = require("../examples/community-filter/manifest.json");
const type = manifest.effects[0].id, id = manifest.id;
const hash = "sha256-" + "A".repeat(43) + "=";
const clone = Projects.clone;
function record() {
  return { type, properties: { name: "Saved effect", arbitrary: { expression: "do not evaluate" } },
    community: { schemaVersion: 999, packageId: id, packageHash: hash, dataSchema: "future" },
    state: { objects: [{ type: 1 }], effects: [{ type: "echo" }], material: { type: "pbrplus" } },
    future: JSON.parse('{"__proto__":{"value":1},"constructor":"data","nested":[null,false,0,"text"]}') };
}
function harness(enabled = true) {
  const notices = [], calls = [];
  class Effect {
    constructor(type) { this.type = type; this.properties = {
      add(key, def) { this[key] = { value: def.value, set() { calls.push("property write"); } }; },
    }; }
    static fnList = {};
    static create(type) { calls.push(type); return new Effect(type); }
  }
  class Project {
    load(data) {
      this.data = clone(data);
      this.effects = (data.sequence.effects || []).map(data => {
        const effect = Effect.create(data.type); effect.parentProject = this;
        effect.loading = Promise.resolve(Effect.fnList[data.type]).then(factory => {
          factory.call(effect); return effect.load(data);
        });
        return effect;
      });
      this.loading = Promise.all(this.effects.map(effect => effect.loading));
    }
    toJSON() {
      const data = clone(this.data);
      data.sequence.effects = this.effects.map(effect => effect.toJSON());
      return data;
    }
  }
  const sandbox = { console, PZ: { effect: Effect, project: Project, property: { type: { TEXT: 7 } } },
    localStorage: { getItem: () => enabled ? "1" : null }, addEventListener() {},
    document: { dispatchEvent() {} }, CustomEvent: class {},
    ZoidiumUI: { notify: value => notices.push(value), confirm() { throw new Error("No privileged approval allowed"); } },
    ZoidiumProjectCompatibility: { migrateProject, installTextMode() {}, installText2D() {} },
    ZoidiumPluginApis: { props: { cloneJson: clone } },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  function run(file) { vm.runInContext(fs.readFileSync(file, "utf8"), sandbox, { filename: file }); }
  run("zoidium/plugin-manager-state.js");
  const manager = sandbox.ZoidiumPluginManagerInternals;
  manager.registryReady = Promise.resolve();
  for (const name of ["community-projects", "community-effect-host", "plugin-manager-scanners", "plugin-manager-factories", "plugin-manager-projects"]) run(`zoidium/${name}.js`);
  manager.installProjectPluginHooks();
  sandbox.ZoidiumCommunityEffectHost.installGuards(sandbox.PZ);
  return { sandbox, manager, calls, notices, Project, Effect };
}
for (const state of ["missing", "disabled", "quarantined", "updated", "unapproved"]) {
  test(`${state} packages retain exact opaque effects through project reopen, copy, paste, undo, and redo`, async () => {
    const h = harness(), payload = record();
    if (state !== "missing") h.manager.pluginStates.set(id, {
      plugin: { id, name: "Installed replacement", version: "900" },
      quarantine: state === "quarantined" ? "Failed" : "", enabled: false,
    });
    const input = { assets: {}, media: [{ baseType: "layer", data: [{ effects: [payload] }] }],
      sequence: { effects: [payload] }, plugins: [{ id, name: "Saved plugin", version: "2", effects: [type],
        approvals: [hash], code: "must not persist", requirements: [{ effect: type, packageHash: hash, dataSchema: "future", schemaVersion: 999 }] }] };
    const project = new h.Project(); project.load(input); await project.loading;
    await project._zoidiumPluginActivationPending;
    const saved = clone(project.toJSON());
    assert.equal(JSON.stringify(saved.sequence.effects[0]), JSON.stringify(payload));
    assert.equal(JSON.stringify(saved.media[0].data[0].effects[0]), JSON.stringify(payload));
    assert.equal(saved.plugins[0].name, "Saved plugin"); assert.equal(saved.plugins[0].version, "2");
    assert.deepEqual(saved.plugins[0].requirements, [{ effect: type, packageHash: hash, dataSchema: "future", schemaVersion: 999 }]);
    assert.equal(saved.plugins[0].approvals, undefined); assert.equal(saved.plugins[0].code, undefined);
    const reopened = new h.Project(); reopened.load(saved); await reopened.loading;
    assert.equal(JSON.stringify(reopened.toJSON()), JSON.stringify(saved));
    const copied = h.Effect.create(type); (await h.Effect.fnList[type]).call(copied); copied.load(clone(payload));
    const undo = clone(copied.toJSON()), edited = clone(undo); edited.future.nested.push("changed");
    copied.load(edited); const redo = clone(copied.toJSON()); copied.load(undo);
    assert.equal(JSON.stringify(copied.toJSON()), JSON.stringify(payload));
    copied.load(redo); assert.equal(JSON.stringify(copied.toJSON()), JSON.stringify(edited));
    assert.equal(h.calls.filter(call => call === "property write").length, 0);
    assert.equal(h.manager.trackedNativeEffects.size, 0, "no privileged factory or tracker owns community data");
    copied.unload(); for (const p of [project, reopened]) p.effects.forEach(e => e.unload());
  });
}
test("closed compositions and unresolved descriptors retain several hashes and schemas for one type", async () => {
  const h = harness(), first = record(), second = record(); second.community.packageHash = "other hash"; second.community.dataSchema = 123;
  const project = new h.Project(); project.load({ sequence: {}, media: [{ data: { effects: [first, second] } }],
    plugins: [{ id, name: "Closed plugin", effects: [type] }] }); await project.loading;
  const saved = clone(project.toJSON());
  assert.equal(saved.plugins[0].requirements.length, 2);
  assert.deepEqual(saved.media[0].data.effects, [first, second]);
  assert.equal(saved.plugins.length, 1, "opaque internals do not claim native Echo, PBR, or Text dependencies");
  const again = new h.Project(); again.load(saved); await again.loading;
  assert.equal(JSON.stringify(again.toJSON()), JSON.stringify(saved));
});
test("an unknown isolated payload is outside native compatibility migration", () => {
  const payload = record(), project = { sequence: { effects: [payload] } };
  assert.equal(migrateProject(project), project);
  assert.equal(JSON.stringify(project.sequence.effects[0]), JSON.stringify(payload));
});
test("no-community projects save byte-identically with the preview flag off and on", async () => {
  const input = { assets: {}, media: [], sequence: { effects: [], controls: [1, 2, 3] } };
  const saves = [];
  for (const enabled of [false, true]) {
    const h = harness(enabled), p = new h.Project(); p.load(input); await p.loading;
    saves.push(JSON.stringify(p.toJSON()));
  }
  assert.deepEqual(saves, [JSON.stringify(input), JSON.stringify(input)]);
});
test("requirement metadata rejects executable and approval fields without interpreting unknown schemas", () => {
  const out = Projects.normalizeRequirements([{ effect: type, dataSchema: "next", schemaVersion: 300, packageHash: hash,
    approvals: [hash], guest: "execute()", assets: { "guest.js": "code" } }]);
  assert.deepEqual(out, [{ effect: type, packageHash: hash, dataSchema: "next", schemaVersion: 300 }]);
  assert.match(Projects.warning({ id, name: "Named package" }), /Named package/);
});
