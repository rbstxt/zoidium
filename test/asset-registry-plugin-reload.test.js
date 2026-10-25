"use strict";
require("./migrate-test-apis.js").ensureMainRealmApis();
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { fixture } = require("./asset-registry-fixture.js");
const read = (plugin, file) => fs.readFileSync(path.join(__dirname, "../plugins", plugin, file), "utf8");

test("Material+ graph Reload clears sampled pixels and changes the bake dependency without refcount changes", async () => {
  const create = require("../plugins/material-plus/graph-runtime.js");
  const asset = { key: "image", data: { image: { index: 1 }, loading: Promise.resolve() } };
  let holds = 0;
  const PZ = { asset: { image: class {
    constructor(value) { this.asset = value; this.data = value.data; }
    get loading() { return this.data.loading; }
    getImage() { return this.data.image; }
  } } };
  const runtime = create(PZ, null);
  const material = { parentProject: { assets: { load() { holds++; return asset; }, unload() { holds--; } } } };
  const graph = runtime.parse({ nodes: [{ id: "image", type: "image", params: { asset: "image" } }], links: [] });
  await runtime.prepareImages(graph, material);
  const entry = runtime.getImageCache(material).image, revision = entry.revision;
  entry.sample = { pixels: "stale" };
  asset.data.image = { index: 2 };
  assert.equal(await runtime.reloadImages(material, "image", asset), true);
  assert.equal(entry.canvas.index, 2); assert.equal(entry.sample, null); assert.ok(entry.revision > revision);
  assert.equal(holds, 1); assert.equal(await runtime.reloadImages(material, "other", asset), false);
});

test("Trapcode Reload rebuilds ready and failed AssetCache entries and invalidates source PCM", async () => {
  const PZ = {};
  new Function("PZ", "THREE", read("trapcode-suite", "trapcode-common.js"))(PZ, {});
  new Function("PZ", read("trapcode-suite", "trapcode-audio.js"))(PZ);
  const T = PZ.trapcode;
  let fail = true, reads = 0, settled = 0;
  const cache = new T.AssetCache(() => { settled++; });
  const loader = () => { reads++; return fail ? null : { pixels: reads }; };
  await cache.request("mask", "image", loader).promise;
  assert.equal(cache.status("mask", "image"), "failed");
  fail = false; await T.reloadAssetCaches("image"); assert.equal(cache.ready("mask", "image").pixels, 2);
  await T.reloadAssetCaches("image"); assert.equal(cache.ready("mask", "image").pixels, 3);
  assert.equal(settled, 3);
  T.audioAnalysis.register("audio", { length: 1, sampleRate: 1, getChannelData: () => new Float32Array(1) });
  T.audioAnalysis.levelAt("audio", 0);
  assert.equal(T.audioAnalysis.invalidate("audio"), true); assert.equal(T.audioAnalysis.has("audio"), false);
  assert.equal(T.audioAnalysis.levelAt("audio", 0), null);
});

test("a stale Trapcode audio decode cannot repopulate PCM after source invalidation", async () => {
  const completions = [];
  const oldWindow = global.window;
  global.window = { OfflineAudioContext: class { decodeAudioData(_bytes, resolve) { completions.push(resolve); } } };
  try {
    const PZ = {}; new Function("PZ", read("trapcode-suite", "trapcode-audio.js"))(PZ);
    const analysis = PZ.trapcode.audioAnalysis;
    const project = { assets: { load: () => ({ file: { arrayBuffer: async () => new ArrayBuffer(4) } }) } };
    const stale = analysis.load(project, "audio"); await Promise.resolve(); await Promise.resolve();
    analysis.invalidate("audio"); const current = analysis.load(project, "audio"); await Promise.resolve(); await Promise.resolve();
    completions[0]({ index: "old" }); assert.equal(await stale, false); assert.equal(analysis.has("audio"), false);
    const buffer = { index: "current" };
    completions[1](buffer); assert.equal((await current).buffer, buffer); assert.equal(analysis.has("audio"), true);
  } finally { global.window = oldWindow; }
});

test("Magic Looks Reload rebuilds its LUT atlas and clears errors with the existing native hold", async () => {
  const Looks = {};
  for (const file of ["looks-cube.js", "looks-lut-assets.js"]) new Function("Looks", read("magic-looks", file))(Looks);
  let valid = false, holds = 0;
  const rows = [];
  for (let b = 0; b < 2; b++) for (let g = 0; g < 2; g++) for (let r = 0; r < 2; r++) rows.push([r, g, b].join(" "));
  const asset = { file: { size: 100, text: async () => valid ? "LUT_3D_SIZE 2\n" + rows.join("\n") : "broken cube" } };
  const vector = { set() {} };
  const uniforms = Object.fromEntries(["u_lutConfig", "u_lutDomMin", "u_lutDomMax"].map(key => [key, { value: vector }]));
  for (const channel of ["R", "G", "B"]) uniforms["u_lutAtlas" + channel] = { value: null };
  const effect = { properties: { lutData: { get: () => "lut" }, lutName: { get: () => "Custom" } },
    pass: { uniforms }, parentProject: { assets: { load() { holds++; return asset; }, unload() { holds--; } } } };
  const THREE = { DataTexture: class { dispose() { this.disposed = true; } } };
  const cache = Looks.lutAssets.create(effect, {}, THREE);
  await cache.prepare(0); assert.match(effect._looksCubeError, /LUT_3D_SIZE/);
  valid = true; await cache.reload("lut", asset); assert.ok(effect._looksCubeAtlas); assert.equal(effect._looksCubeError, null); assert.equal(holds, 1);
  const texture = uniforms.u_lutAtlasR.value;
  await cache.reload("lut", asset); assert.equal(texture.disposed, true); assert.equal(holds, 1);
  cache.dispose(); assert.equal(holds, 0);
});

test("Optical Flares Reload refreshes same-key custom texture without unloading the native asset", async () => {
  const { buildEnv } = require("./optical-flares-fixture.js");
  const { PZ, THREE } = buildEnv();
  const flare = new PZ.object3d.optflares(); flare.load({ objectType: 0 });
  const asset = { key: "custom" }; let unloaded = 0;
  flare.tryGetParentOfType = () => ({ assets: { load: () => asset, unload() { unloaded++; } } });
  PZ.asset.image = class { constructor(value) { this.asset = value; this.loading = Promise.resolve(); } getTexture() { return new THREE.DataTexture(); } };
  flare.updateCustomTexture({ get: () => "custom" }, "uCustom1", 0);
  const previous = flare.material.uniforms.uCustom1.value;
  await flare.reloadCustomTexture("custom", asset);
  assert.equal(previous.disposed, true); assert.notEqual(flare.material.uniforms.uCustom1.value, previous);
  assert.equal(unloaded, 0); assert.equal(flare._customValues.uCustom1, "custom");
  flare.unload();
});

test("GIF Reload replaces records and textures so old frame records cannot restore stale pixels", async () => {
  const { loadGifSupport, makeFakeCanvas, gifArrayBuffer } = require("./gif-support-fixture.js");
  const f = fixture();
  class ImageAsset {
    constructor(asset) { this.asset = asset; if (!asset.data.has(ImageAsset)) asset.data.set(ImageAsset, { image: null, loading: null }); this.data = asset.data.get(ImageAsset); }
    decodeBrowser() {}
    getImage() { if (!this.data.image) this.decodeBrowser(); return this.data.image; }
    getTexture() { return { image: this.getImage(), addEventListener() {} }; }
    get loading() { return this.data.loading; }
  }
  const PZ = { asset: { image: ImageAsset }, layer: class { update() {} }, compositor: class { renderSequence() {} } };
  const { GifSupport } = loadGifSupport({ fetch: async () => ({ ok: true, arrayBuffer: async () => gifArrayBuffer() }) });
  const disposers = [];
  await GifSupport.activate({ PZ, document: { createElement: () => makeFakeCanvas() }, window: { ZoidiumAssets: f.api }, lifecycle: { onDispose: fn => disposers.push(fn) } });
  const asset = f.asset("gif", { filename: "anim.gif" });
  const wrapper = new ImageAsset(asset), texture = wrapper.getTexture(); await wrapper.loading;
  const old = wrapper.data.gif;
  wrapper.data.image = null; wrapper.data.gif = null; wrapper.data.loading = null;
  wrapper.getImage(); await wrapper.loading;
  assert.notEqual(wrapper.data.gif, old); assert.equal(texture.image, wrapper.data.gif.frames[0].canvas);
  const current = wrapper.data.image;
  new PZ.compositor().renderSequence(0); assert.equal(wrapper.data.image, current);
  for (const dispose of disposers.reverse()) dispose();
});
