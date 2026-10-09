"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const test = require("node:test");
const source = fs.readFileSync(require.resolve("../plugins/plugin-manager.js"), "utf8");
const plain = (value) => JSON.parse(JSON.stringify(value));
function harness(mediaMutates = false) {
  class Layer {
    constructor() { this.type = 2; this.properties = { name: "Layer" }; }
    load(data) { this.properties.name = data.properties?.name || "Layer"; }
    toJSON() { return { type: this.type, properties: this.properties, effects: [] }; }
  }
  class Composite extends Layer {
    constructor() { super(); this.objects = []; }
    load(data) { super.load(data); this.objects = data.objects || []; }
    toJSON() { return { ...super.toJSON(), objects: this.objects }; }
  }
  Layer.composite = Composite;
  class Media {
    constructor() { this.properties = { name: "Media" }; this.data = []; }
    async load(data) { data = await data; if (mediaMutates) data.comp.id = "host-mutated"; this.data = data.data; this.properties.name = data.properties.name; }
    toJSON() { return { data: this.data, properties: this.properties }; }
  }
  class Clip {
    constructor() { this.length = 0; this.properties = { name: "Clip" }; }
    load(data) { this.length = data.length; }
    toJSON() { return { length: this.length, properties: this.properties }; }
  }
  const PZ = { layer: Layer, clip: Clip, media: Media };
  const start = source.indexOf("  function installSerializedFieldPreservation() {");
  const end = source.indexOf("  function installProjectPluginHooks() {", start);
  vm.runInNewContext(source.slice(start, end) + "\ninstallSerializedFieldPreservation();", { PZ, cloneJson: plain });
  return PZ;
}
test("disabled composition fields survive, are cloned, and leave current host state intact", async () => {
  const PZ = harness();
  const data = { properties: { name: "Intro", pluginValue: { seed: 2 } }, data: [], comp: { id: "comp-1", clipLinks: { links: {} } } };
  const media = new PZ.media();
  await media.load(data);
  data.comp.id = "mutated";
  const layer = new PZ.layer.composite();
  layer.load({ type: 2, properties: { name: "Comp" }, effects: [], objects: [], compId: "comp-1", offset: 12, custom: { seed: 3 } });
  layer.properties.name = "Edited";
  layer.objects.push({ type: 4 });
  assert.deepEqual(plain(media.toJSON()).comp, { id: "comp-1", clipLinks: { links: {} } });
  assert.deepEqual(plain(media.toJSON()).properties.pluginValue, { seed: 2 });
  const output = plain(layer.toJSON());
  assert.equal(output.properties.name, "Edited");
  assert.equal(output.compId, "comp-1");
  assert.equal(output.offset, 12);
  assert.deepEqual(output.objects, [{ type: 4 }]);
  output.custom.seed = 99;
  assert.equal(plain(layer.toJSON()).custom.seed, 3);
  layer.offset = 28;
  assert.equal(plain(layer.toJSON()).offset, 28);
  layer.load({ properties: { name: "Replacement" }, objects: [] });
  assert.equal(plain(layer.toJSON()).compId, undefined);
});
test("unknown clip fields survive while host edits and removed array items win", () => {
  const PZ = harness();
  const clip = new PZ.clip();
  clip.load({ length: 10, properties: { name: "Clip", extra: [1, 2] }, plugin: { mode: 3 } });
  clip.length = 20;
  assert.equal(plain(clip.toJSON()).length, 20);
  assert.deepEqual(plain(clip.toJSON()).plugin, { mode: 3 });
  assert.deepEqual(plain(clip.toJSON()).properties.extra, [1, 2]);
});
test("async media inputs retain metadata and an enabled extension's serializer wins", async () => {
  const PZ = harness();
  const media = new PZ.media();
  await media.load(Promise.resolve({ properties: { name: "Async" }, data: [], comp: { id: "saved" } }));
  const original = media.toJSON;
  media.toJSON = function () { return { ...original.call(this), comp: { id: "live" } }; };
  assert.equal(plain(media.toJSON()).comp.id, "live");
});
test("save dependency scans serialize runtime children without reading THREE getters", () => {
  const project = { sequence: {
    properties: { type: 8 },
    target: { get type() { throw new Error("deprecated getter read"); } },
    toJSON() { return { properties: { resolution: [320, 180] }, videoTracks: [] }; },
  } };
  const begin = source.indexOf("    const originalProjectToJSON = projectPrototype.toJSON;");
  const end = source.indexOf("    const originalProjectLoad =", begin);
  const prototype = { toJSON() { return project; } };
  let scanned;
  vm.runInNewContext(source.slice(begin, end), {
    projectPrototype: prototype, collectProjectPlugins: () => [], cloneJson: plain,
    projectPluginRequirements(data) { scanned = data; return []; }, serializeProjectPlugins: (value) => value,
  });
  prototype.toJSON();
  assert.deepEqual(scanned.sequence, { properties: { resolution: [320, 180] }, videoTracks: [] });
});


test("promise inputs are cloned before the async host mutates their extra fields", async () => {
  const PZ = harness(true);
  const media = new PZ.media();
  const data = { properties: { name: "Async" }, data: [], comp: { id: "original" } };
  await media.load(Promise.resolve(data));
  assert.equal(data.comp.id, "host-mutated");
  assert.equal(plain(media.toJSON()).comp.id, "original");
});
