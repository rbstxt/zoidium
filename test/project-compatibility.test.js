"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const { migrateProject, installTextMode } = require("../zoidium/project-compatibility.js");

function project(versions) {
  const data = { sequence: { videoTracks: [{ clips: [{ object: { type: 3, objects: [
    { type: "zoidium:text-plus/text-plus", objects: [{ type: 1, material: { type: "pbrplus" } }] },
    { type: "zoidium:repeater/twist", properties: { curveQuality: 1, polygonCount: 7 } },
    { type: 8, properties: { curveQuality: 1, polygonCount: 7 } },
    { type: 1, properties: { arbitrary: { type: 1 } } },
  ] } }] }] } };
  if (versions) data.plugins = Object.entries(versions).map(([id, version]) => ({ id, version }));
  return data;
}
const objects = data => data.sequence.videoTracks[0].clips[0].object.objects;

for (const [name, versions] of [
  ["old plugin versions", { "material-plus": "9", "text-plus": "22", repeater: "15" }],
  ["no descriptors", null],
  ["plugin versions saved after the behavior changes", { "material-plus": "16", "text-plus": "23", repeater: "27" }],
]) test(`saved objects without a mode load as legacy with ${name}`, () => {
  const input = project(versions), before = JSON.stringify(input);
  const output = migrateProject(input), items = objects(output);
  assert.equal(items[0].objects[0].material.zoidiumUvMode, "legacy");
  assert.equal(items[0].objects[0].zoidiumTextScaleMode, "legacy");
  assert.equal(items[1].zoidiumSubdivisionMode, "legacy");
  assert.equal(items[2].zoidiumSubdivisionMode, "legacy");
  assert.equal(items[3].zoidiumTextScaleMode, "legacy");
  assert.equal(items[3].properties.arbitrary.zoidiumTextScaleMode, undefined);
  assert.equal(JSON.stringify(input), before, "do not mutate the caller's document");
  assert.deepEqual(migrateProject(JSON.parse(JSON.stringify(output))), output);
});

test("explicit object modes are kept on load, copy and undo snapshots", () => {
  const migrated = migrateProject(project());
  const items = objects(migrated);
  items[0].objects[0].material.zoidiumUvMode = "current";
  items[1].zoidiumSubdivisionMode = "current";
  assert.deepEqual(migrateProject(JSON.parse(JSON.stringify(migrated))), migrated);
});

test("native Text modes serialize for new objects, load, duplicate and history reload", () => {
  class Text {
    load(data) { this.value = data?.value || 0; }
    toJSON() { return { type: 1, value: this.value }; }
  }
  installTextMode({ object3d: { text: Text } });
  const added = new Text();
  added.load({ type: 1 });
  assert.equal(added.toJSON().zoidiumTextScaleMode, "current");
  for (const mode of ["legacy", "current"]) {
    const loaded = new Text();
    loaded.load({ zoidiumTextScaleMode: mode });
    const duplicate = new Text();
    duplicate.load(JSON.parse(JSON.stringify(loaded)));
    assert.equal(duplicate.toJSON().zoidiumTextScaleMode, mode);
    loaded.load(added.toJSON());
    assert.equal(loaded.toJSON().zoidiumTextScaleMode, "current");
    loaded.load(duplicate.toJSON());
    assert.equal(loaded.toJSON().zoidiumTextScaleMode, mode);
  }
});

test("migration preserves embedded composition modes and does not copy unrelated asset data", () => {
  const pixels = [1, 2, 3, 4];
  const input = { media: [{ baseType: "object3d", data: { type: "zoidium:text-plus/text-plus", objects: [{ type: 1 }] } }],
    assets: [{ id: "sample", data: pixels }] };
  const output = migrateProject(input);
  assert.equal(output.media[0].data.objects[0].zoidiumTextScaleMode, "legacy");
  assert.equal(output.assets, input.assets);
  assert.equal(migrateProject(output), output, "explicit decisions require no additional document copy");
});

test("project load marks saved objects before dependency inference and host deserialization", () => {
  const vm = require("node:vm"), fs = require("node:fs");
  const compatibility = require("../zoidium/project-compatibility.js");
  class Project { load(data) { this.loaded = data; return "host result"; } toJSON() { return {}; } }
  const manager = { pluginStates: new Map(), registryReady: Promise.resolve(),
    projectPluginRequirements(data) {
      assert.equal(objects(data)[0].objects[0].material.zoidiumUvMode, "legacy");
      return [];
    }, refreshPluginUsageLocks() {} };
  const context = { window: { ZoidiumPluginManagerInternals: manager, ZoidiumProjectCompatibility: compatibility, addEventListener() {} },
    PZ: { project: Project }, document: { dispatchEvent() {} }, CustomEvent: class {}, console };
  vm.runInNewContext(fs.readFileSync("zoidium/plugin-manager-projects.js", "utf8"), context);
  manager.installProjectPluginHooks();
  const loaded = new Project(), data = project({ "material-plus": "9", "text-plus": "22", repeater: "15" });
  assert.equal(loaded.load(data), "host result");
  assert.equal(objects(loaded.loaded)[1].zoidiumSubdivisionMode, "legacy");
  assert.equal(objects(data)[1].zoidiumSubdivisionMode, undefined);
});

test("native scenes and samplers migrate without versions, including composites and disabled payloads", () => {
  const scene = mode => ({ type: 4, ...(mode ? { zoidiumShadowMode: mode } : {}),
    objects: [{ type: 4, properties: {} }], effects: [
      { type: "echo" }, { type: "timedisplacement", zoidiumTemporalMode: "current" },
      { type: 0, objects: [{ type: "ccwidetime" }, { type: "timedifference", zoidiumTemporalMode: "legacy" }] },
    ] });
  const input = { plugins: [{ id: "core", version: "999" }, { id: "native-fx", version: "999" }],
    sequence: { videoTracks: [{ clips: [{ object: { type: 2, objects: [scene(), scene("current")] } }] }] },
    media: [{ baseType: "layer", data: scene() }, { baseType: "effect", data: { type: "echo" } }],
    arbitrary: { type: 4, settings: { type: "echo" } } };
  const output = migrateProject(input);
  for (const [layer, mode] of [
    [output.sequence.videoTracks[0].clips[0].object.objects[0], "legacy"],
    [output.sequence.videoTracks[0].clips[0].object.objects[1], "current"],
    [output.media[0].data, "legacy"],
  ]) {
    assert.equal(layer.zoidiumShadowMode, mode);
    assert.equal(layer.objects[0].zoidiumShadowMode, undefined, "3D objects also use numeric type 4");
    assert.deepEqual(layer.effects.map(effect => effect.zoidiumTemporalMode), ["legacy", "current", undefined]);
    assert.equal(layer.effects[2].objects[0].zoidiumTemporalMode, "legacy");
    assert.equal(layer.effects[2].objects[1].zoidiumTemporalMode, "legacy");
  }
  assert.equal(output.media[1].data.zoidiumTemporalMode, "legacy");
  assert.equal(output.arbitrary, input.arbitrary);
  assert.deepEqual(migrateProject(JSON.parse(JSON.stringify(output))), output);
  assert.equal(migrateProject(output), output);
});
