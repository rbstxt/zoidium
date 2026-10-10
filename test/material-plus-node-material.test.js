"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const crypto = require("node:crypto");
const NodeMaterial = require("../plugins/material-plus/node-material");
const Pbr = require("../plugins/material-plus/pbr-plus");
const ImagePlus = require("../plugins/material-plus/image-plus");
function harness() {
  class Vector { constructor(...v) { this.set(...v); } set(...v) { this.values = v; return this; } }
  class Color { setRGB(...v) { this.values = v; return this; } }
  class Texture { constructor(image) { this.image = image; for (const k of ["repeat", "offset", "center"]) this[k] = new Vector(); } dispose() { this.disposed = true; } }
  class Physical { constructor(options) { Object.assign(this, options); this.color = new Color(); this.emissive = new Color(); this.normalScale = new Vector(); this.defines = {}; } dispose() { this.disposed = true; } }
  const THREE = { MeshPhysicalMaterial: Physical, MeshStandardMaterial: Physical, MeshBasicMaterial: Physical, Vector2: Vector, Vector3: Vector, CanvasTexture: Texture, DataTexture: class extends Texture { constructor(data) { super({ data }); } }, ClampToEdgeWrapping: 1, RepeatWrapping: 2, MirroredRepeatWrapping: 3 };
  const PZ = { property: { type: Object.fromEntries(["TEXT", "GRADIENT", "NUMBER", "OPTION", "COLOR", "VECTOR2", "VECTOR3", "ASSET"].map(k => [k, k])) }, asset: { type: { IMAGE: "image" }, image: class { constructor(asset) { this.asset = asset; this.loading = Promise.resolve(); } getTexture() { return new Texture(); } getImage() { return { width: 8, height: 8 }; } } }, material: { fnList: {} } };
  const document = { createElement() { const canvas = { width: 0, height: 0 }; canvas.getContext = () => ({ createImageData(w, h) { return { data: new Uint8ClampedArray(w * h * 4) }; }, putImageData(image) { canvas.data = image.data.slice(); }, drawImage() {}, getImageData() { return { data: new Uint8ClampedArray(canvas.width * canvas.height * 4) }; } }); return canvas; } };
  const dispose = [], editors = [], panels = [];
  const context = { PZ, window: { PZ, THREE, document }, document, plugin: { id: "material-plus", version: "6" }, lifecycle: { onDispose(fn) { dispose.push(fn); } }, getAsset(type, name) { return fs.readFileSync(name.replace(/^\.\//, "").split("?")[0], "utf8"); }, ui: { registerEditor(spec) { editors.push(spec); }, registerAttributePanel(spec) { panels.push(spec); } } };
  const unloaded = [];
  function material(type) {
    const material = { type, parentProject: { assets: { load: key => ({ key }), unload: asset => unloaded.push(asset) }, sequence: { properties: { rate: { get: () => 30 } } } }, parentLayer: {} };
    material.properties = { addAll(defs) { for (const [key, def] of Object.entries(defs)) {
      const value = def.group ? def.objects.map(o => o.value) : def.value;
      this[key] = { ...def, value, parentObject: material, _loaded: !def.dynamic, get() { if (!this._loaded) throw new Error("Dynamic property read before native load"); return this.value; }, set(value) { this._loaded = true; this.value = value; def.changed?.call(this); } };
    } }, load(data) { for (const value of Object.values(this)) if (value && typeof value === "object" && "_loaded" in value) value._loaded = true; if (data) for (const [key, value] of Object.entries(data)) this[key]?.set(value); } };
    return material;
  }
  return { context, PZ, material, dispose, editors, panels, unloaded };
}
const hash = material => crypto.createHash("sha256").update(material.pzGraphTextures.color.image.data).digest("hex");
test("Node Material prepares exact frames, survives seeking and releases owned resources", async () => {
  const h = harness(); NodeMaterial.activate(h.context);
  try {
    const m = h.material("nodes"); (await h.PZ.material.fnList.nodes).call(m); m.load();
    m.properties.bakeResolution.set(0);
    const graph = h.context.window.ZoidiumMaterialPlus.nodes.defaultGraph(); graph.nodes[0].params.speedX = 1;
    m.properties.graph.set(JSON.stringify(graph));
    await m.prepare(1.5); const cold = hash(m);
    await m.prepare(3); await m.prepare(0); await m.prepare(1.5);
    assert.equal(hash(m), cold);
    assert.equal(h.editors[0].match(m), true);
    assert.equal(h.panels.length, 2);
    const texture = m.pzGraphTextures.color;
    m.unload(); assert.ok(texture.disposed);
  } finally { for (const fn of h.dispose.reverse()) fn(); }
  assert.equal(h.PZ.material.fnList.nodes, undefined);
  assert.equal(h.context.window.ZoidiumMaterialPlus, undefined);
});
test("PBR+ retains map keys and exposes optional surface controls with neutral defaults", async () => {
  const h = harness(); NodeMaterial.activate(h.context); Pbr.activate(h.context);
  try {
    const m = h.material("pbrplus"); (await h.PZ.material.fnList.pbrplus).call(m); m.load(); await m.prepare(0);
    for (const key of ["rampEnabled", "bumpNoise", "fresnel", "aoEnabled", "celEnabled", "reflReflection", "useNodeGraph"]) assert.equal(m.properties[key].get(), 0, key);
    for (const key of ["texture", "emissiveMap", "roughnessMap", "metalnessMap", "normalMap", "alphaMap", "alphaTest", "reflectionIntensity"]) assert.ok(m.properties[key], key);
    m.properties.color.set([.2, .3, .4]); m.update(2);
    assert.deepEqual(m.pzUniforms.uPzColor.value.values, [.2, .3, .4]);
    m.unload();
  } finally { for (const fn of h.dispose.reverse()) fn(); }
});
test("Image+ reads opacity at the requested frame and leaves native material factories alone", async () => {
  const h = harness(); const native = h.PZ.material.fnList.texture = {};
  ImagePlus.activate(h.context);
  try {
    const m = h.material("imageplus"); (await h.PZ.material.fnList.imageplus).call(m); m.load();
    m.properties.opacity.get = frame => frame / 10;
    m.properties.transparent.set(1);
    m.update(5); assert.equal(m.threeObj.opacity, .5); assert.equal(m.threeObj.transparent, true);
    m.update(0); m.update(5); assert.equal(m.threeObj.opacity, .5);
    m.unload(); assert.equal(h.PZ.material.fnList.texture, native);
  } finally { for (const fn of h.dispose.reverse()) fn(); }
  assert.equal(h.PZ.material.fnList.imageplus, undefined);
});
test("graph worker queues only the latest frame and stays idle for PBR+ with graphs off", async () => {
  const h = harness();
  const pure = new Function(fs.readFileSync("plugins/material-plus/graph-runtime.js", "utf8"))()({}, null);
  let created = 0, concurrent = 0, maximum = 0, terminated = 0;
  h.context.window.Blob = class {};
  h.context.window.URL = { createObjectURL: () => "blob:graph", revokeObjectURL() {} };
  h.context.window.Worker = class {
    constructor() { created++; }
    postMessage(job) {
      concurrent++; maximum = Math.max(maximum, concurrent);
      setImmediate(() => {
        const outputs = pure.evaluate(job.graph, job.size, job.time, { images: job.images });
        concurrent--;
        this.onmessage({ data: { id: job.id, outputs } });
      });
    }
    terminate() { terminated++; }
  };
  NodeMaterial.activate(h.context); Pbr.activate(h.context);
  try {
    const pbr = h.material("pbrplus"); (await h.PZ.material.fnList.pbrplus).call(pbr); pbr.load(); await pbr.prepare(0);
    assert.equal(created, 0);
    const node = h.material("nodes"); (await h.PZ.material.fnList.nodes).call(node); node.load();
    node.properties.bakeResolution.set(0);
    const graph = h.context.window.ZoidiumMaterialPlus.nodes.defaultGraph(); graph.nodes[0].params.speedX = 1;
    node.properties.graph.set(JSON.stringify(graph));
    node.update(30); node.update(60); await node.prepare(90);
    const expected = pure.evaluate(graph, 128, 3, { images: {} }).color;
    assert.deepEqual(node.pzGraphTextures.color.image.data, expected);
    assert.equal(maximum, 1);
    assert.equal(created, 1);
    node.unload(); pbr.unload(); assert.equal(terminated, 1);
  } finally { for (const fn of h.dispose.reverse()) fn(); }
});
test("a frame-rate change invalidates a bake at the same project frame", async () => {
  const h = harness(); NodeMaterial.activate(h.context);
  try {
    const m = h.material("nodes"); (await h.PZ.material.fnList.nodes).call(m); m.load(); m.properties.bakeResolution.set(0);
    const graph = h.context.window.ZoidiumMaterialPlus.nodes.defaultGraph(); graph.nodes[0].params.speedX = 1;
    m.properties.graph.set(JSON.stringify(graph));
    await m.prepare(15); const first = hash(m);
    m.parentProject.sequence.properties.rate.get = () => 60;
    await m.prepare(15); assert.notEqual(hash(m), first);
    m.unload();
  } finally { for (const fn of h.dispose.reverse()) fn(); }
});
test("the first prepared luminance bake enables emission immediately", async () => {
  const h = harness(); NodeMaterial.activate(h.context);
  try {
    const m = h.material("nodes"); (await h.PZ.material.fnList.nodes).call(m); m.load(); m.properties.bakeResolution.set(0);
    const graph = h.context.window.ZoidiumMaterialPlus.nodes.defaultGraph();
    graph.links.push({ from: "noise", fromPort: "out", to: "output", toPort: "luminance" });
    m.properties.graph.set(JSON.stringify(graph));
    await m.prepare(0);
    assert.ok(m.threeObj.emissiveMap);
    assert.deepEqual(m.threeObj.emissive.values, [1, 1, 1]);
    m.unload();
  } finally { for (const fn of h.dispose.reverse()) fn(); }
});
test("unloading during a worker bake settles preparation and terminates the worker", async () => {
  const h = harness(); let started, terminated = false;
  const submitted = new Promise(resolve => { started = resolve; });
  h.context.window.Blob = class {};
  h.context.window.URL = { createObjectURL: () => "blob:graph", revokeObjectURL() {} };
  h.context.window.Worker = class { postMessage() { started(); } terminate() { terminated = true; } };
  NodeMaterial.activate(h.context);
  try {
    const m = h.material("nodes"); (await h.PZ.material.fnList.nodes).call(m); m.load();
    const preparing = m.prepare(0);
    await submitted;
    m.unload();
    await preparing;
    assert.equal(terminated, true);
  } finally { for (const fn of h.dispose.reverse()) fn(); }
});
