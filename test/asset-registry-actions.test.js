"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const { fixture } = require("./asset-registry-fixture.js");
const { assetCompletion } = require("../plugins/core/output-frame-store.js");
const plain = value => JSON.parse(JSON.stringify(value));
const flush = async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); };
function decodedFixture(extra = {}) {
  return fixture({ globals: {
    Image: class {
      constructor() { this.width = this.height = this.naturalWidth = this.naturalHeight = 0; this.complete = false; }
      set src(value) {
        this.url = value;
        queueMicrotask(() => { this.width = this.height = this.naturalWidth = this.naturalHeight = 16; this.complete = true; this.onload?.(); });
      }
    },
    THREE: { BufferGeometryLoader: class { parse(value) { return { parsed: value }; } } },
    ...extra,
  }, setup({ PZ }) {
    function wrapper(field, initial, methods) {
      return class {
        constructor(asset) {
          this.asset = asset;
          if (!asset.data.has(this.constructor)) asset.data.set(this.constructor, { [field]: initial, loading: null });
          this.data = asset.data.get(this.constructor);
          Object.assign(this, methods);
        }
        get loading() { return this.data.loading; }
      };
    }
    PZ.asset.image = wrapper("image", null);
    Object.assign(PZ.asset.image.prototype, { decodeBrowser() {}, getImage() { if (!this.data.image) this.decodeBrowser(); return this.data.image; },
      getTexture() { const texture = { image: this.getImage() }; this.loading.then(() => { texture.needsUpdate = true; }); return texture; } });
    PZ.asset.geometry = wrapper("geometry", null);
    PZ.asset.geometry.prototype.getGeometry = function () {};
    PZ.asset.shader = wrapper("shader", "");
    PZ.asset.shader.prototype.getShader = function () {};
    PZ.asset.lut = wrapper("lut", null);
    PZ.asset.lut.prototype.getLUT = function () {};
    PZ.asset.lut.prototype.parseCubeLUT = text => text === "valid cube" ? { type: "3D", size: 2 } : null;
  } });
}

test("capabilities distinguish missing FILEs, attached bytes and reference adapters", () => {
  const f = fixture();
  f.asset("missing", { file: null }); f.asset("attached");
  f.asset("preset", { source: 3, filename: "texture.png", url: "/texture.png", file: null });
  f.properties(f.child(f.project.sequence, new f.Obj("Layer")), { image: new f.Property("Image", "preset") });
  f.api.registerReferences({ id: "embedded", collect(_p, emit) { emit({ key: "adapter", item: { source: "embedded", kind: "custom" } }); }, reload() {} });
  const items = f.api.snapshot().items;
  assert.deepEqual(plain(f.api.capabilities(items.find(i => i.id === "missing"))), { reload: true, locate: true, exportFile: false });
  assert.deepEqual(plain(f.api.capabilities(items.find(i => i.id === "attached"))), { reload: true, locate: false, exportFile: true });
  assert.deepEqual(plain(f.api.capabilities(items.find(i => i.id === "preset"))), { reload: true, locate: false, exportFile: true });
  assert.deepEqual(plain(f.api.capabilities(items.find(i => i.id === "adapter"))), { reload: true, locate: false, exportFile: false });
});

test("Reload updates existing image textures and shared clone data without ownership or history writes", async () => {
  const f = decodedFixture(), asset = f.asset("image", { references: 4, mediaReferences: 1 });
  const wrapper = new f.PZ.asset.image(asset), texture = wrapper.getTexture(); await wrapper.loading;
  const clone = { ...asset }; const shared = clone.data.get(f.PZ.asset.image);
  const old = texture.image, revision = JSON.stringify(assetCompletion(asset, () => 0));
  const seen = []; f.api.subscribe(s => seen.push(s.items.find(i => i.id === "image")?.status)); f.flush();
  const calls = []; f.api.registerReloader({ id: "cache", reload(key, source) { calls.push([key, source]); assert.notEqual(texture.image, old); } });
  const result = await f.api.reload("image"); await flush(); f.flush();
  assert.equal(result.ok, true); assert.equal(result.status, "ready"); assert.notEqual(texture.image, old);
  assert.equal(wrapper.data, shared); assert.equal(texture.image, shared.image); assert.equal(texture.needsUpdate, true);
  assert.notEqual(JSON.stringify(assetCompletion(asset, () => 0)), revision);
  assert.equal(asset.references, 4); assert.equal(asset.mediaReferences, 1); assert.equal(calls[0][1], asset);
  assert.ok(seen.includes("ready"));
});

for (const [kind, filename, bytes, method] of [["geometry", "mesh.json", '{"vertices":[1]}', "getGeometry"],
  ["lut", "grade.cube", "valid cube", "getLUT"], ["shader", "shader.frag", "void main() {}", "getShader"]]) {
  test("Reload redecodes " + kind + " and rebuilds native consumers", async () => {
    const f = decodedFixture(), file = new Blob([bytes]), asset = f.asset(kind, { file, filename });
    const Type = f.PZ.asset[kind], wrapper = new Type(asset);
    await wrapper[method](); const previous = wrapper.data[kind];
    let rebuilt = 0;
    const node = f.child(f.project.sequence, new f.Obj("Consumer"));
    if (kind === "geometry") { node.customGeometry = wrapper; node.generatePresetGeometry = () => { rebuilt++; }; }
    if (kind === "lut") { node.lut = wrapper; node.updateTexture = data => { assert.equal(data, wrapper.data.lut); rebuilt++; }; }
    if (kind === "shader") { node.fragShader = wrapper; node.pass = { material: { fragmentShader: "old" } }; }
    const result = await f.api.reload(kind); assert.equal(result.ok, true, result.error);
    if (kind !== "shader") { assert.notEqual(wrapper.data[kind], previous); assert.equal(rebuilt, 1); }
    else { assert.equal(node.pass.material.fragmentShader, bytes); assert.equal(node.pass.material.needsUpdate, true); }
  });
}

test("same-hash Locate uses native attachment, rebuilds consumers and never writes history", async () => {
  const f = decodedFixture(), asset = f.asset("matching", { file: null });
  new f.PZ.asset.image(asset);
  let locates = 0;
  f.PZ.asset.hash = async file => file.key;
  f.project.assets.locate = async file => { locates++; asset.file = file; asset.url = "blob:attached"; f.project.assets.onAssetCreated.update(); };
  const file = Object.assign(new Blob(["bytes"]), { key: "matching", name: "image.png" });
  assert.deepEqual(plain(await f.api.locate("matching", file)), { ok: true, reason: null, error: null });
  assert.equal(locates, 1); assert.equal(asset.file, file); assert.equal(f.api.snapshot().items[0].status, "ready");
  assert.equal((await f.api.locate("matching", file)).reason, "not-missing");
});

test("different-hash Locate leaves bytes, decoder data, metadata and ownership untouched", async () => {
  const f = decodedFixture(), asset = f.asset("expected", { file: null, references: 2 });
  const data = new f.PZ.asset.image(asset).data;
  f.PZ.asset.hash = async () => "different";
  f.project.assets.locate = () => { throw new Error("Mismatched bytes reached native locate"); };
  const before = { ...asset };
  assert.equal((await f.api.locate("expected", new Blob(["other"]))).reason, "different");
  assert.deepEqual(asset, before); assert.equal(new f.PZ.asset.image(asset).data, data);
});

test("missing file Reload fails promptly and reloader registrations dispose", async () => {
  const f = fixture(); f.asset("missing", { file: null });
  let called = 0; const stop = f.api.registerReloader({ id: "cache", reload() { called++; } });
  assert.throws(() => f.api.registerReloader({ id: "cache", reload() {} }), /already registered/);
  assert.equal((await f.api.reload("missing")).ok, false); assert.equal(called, 0);
  stop(); assert.doesNotThrow(() => f.api.registerReloader({ id: "cache", reload() {} }));
});

test("export returns attached bytes and embedded IES text including closed composition references", async () => {
  const f = fixture(), file = new Blob([new Uint8Array([0, 1, 2, 255])]);
  f.asset("image", { file, filename: "exact.png" });
  const result = await f.api.exportFile("image"); assert.equal(result.blob, file); assert.equal(result.filename, "exact.png");
  const ies = 'IESNA:LM-63-2002\nTILT=NONE\n';
  f.api.registerReferences({ id: "ies", collect(_p, emit) { emit({ key: "ies:test", bytes: ies, composition: { id: "intro" },
    item: { kind: "ies", source: "embedded", name: "light", mime: "text/plain" } }); } });
  const embedded = await f.api.exportFile("ies:test"); assert.equal(await embedded.blob.text(), ies); assert.equal(embedded.filename, "light.ies");
  assert.equal(await f.api.exportFile("absent"), null);
});

test("preset export fetches same-origin bytes and rejects foreign URLs without object URLs", async () => {
  const expected = new Uint8Array([9, 7, 6]); let requests = 0;
  const f = decodedFixture({ fetch: async () => { requests++; return { ok: true, arrayBuffer: async () => expected.buffer }; } });
  f.asset("preset", { file: null, source: 3, url: "/assets/fonts/test.ttf", filename: "test.ttf" });
  f.properties(f.child(f.project.sequence, new f.Obj("Text")), { font: new f.Property("Font", "preset") });
  const result = await f.api.exportFile("preset"); assert.equal(result.filename, "test.ttf");
  assert.deepEqual(new Uint8Array(await result.blob.arrayBuffer()), expected); assert.equal(requests, 1);
  f.project.assets.list.preset.url = "https://elsewhere.test/font.ttf";
  assert.equal(await f.api.exportFile("preset"), null); assert.equal(requests, 1);
});

test("transient preset fetches retry, but parse failures do not retry", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let requests = 0;
  const f = decodedFixture({ setTimeout: (...args) => setTimeout(...args), clearTimeout: id => clearTimeout(id),
    fetch: async () => { requests++; return { ok: requests > 2, status: 503, arrayBuffer: async () => new TextEncoder().encode("bad json").buffer }; } });
  const asset = f.asset("mesh", { source: 3, url: "/mesh.json", filename: "mesh.json", file: null });
  const wrapper = new f.PZ.asset.geometry(asset);
  const operation = wrapper.getGeometry(); await flush(); assert.equal(requests, 1);
  t.mock.timers.tick(2000); await flush(); assert.equal(requests, 2);
  t.mock.timers.tick(6000); await flush(); assert.equal(requests, 3);
  assert.equal(await operation, null); assert.match(wrapper.data.zoidiumDecodeError, /JSON/);
  t.mock.timers.tick(60000); await flush(); assert.equal(requests, 3);
});

for (const kind of ["video", "audio"]) test(kind + " Reload rebinds the native schedule and updates decode subscribers", async () => {
  const statuses = new Map();
  const f = decodedFixture({ ZoidiumVideoDecodeStatus: { get: asset => statuses.get(asset), set: (asset, status) => statuses.set(asset, status) } });
  const asset = f.asset("media", { filename: "media." + (kind === "video" ? "mp4" : "wav"), file: new Blob(["bytes"], { type: kind + "/test" }) });
  statuses.set(asset, "failed");
  const listeners = new Map(); let loads = 0;
  const el = { currentTime: 1.5, duration: 4, addEventListener: (key, fn) => listeners.set(key, fn), removeEventListener: key => listeners.delete(key),
    load() { loads++; queueMicrotask(() => listeners.get("loadeddata")?.()); } };
  const schedule = { el, texture: {}, items: [{ media: asset }], currentItem: { media: asset }, __zoidiumVideoExportState: { old: true }, lastFrame: 10 };
  f.project.sequence[kind === "video" ? "videoSchedules" : "audioSchedules"] = [schedule];
  const result = await f.api.reload("media");
  assert.equal(result.ok, true, result.error); assert.equal(loads, 1); assert.equal(el.src, asset.url);
  assert.equal(el.currentTime, 1.5); assert.equal(schedule.texture.needsUpdate, true);
  assert.equal(schedule.__zoidiumVideoExportState, undefined); assert.equal(schedule.lastFrame, -1);
  assert.equal(statuses.get(asset), "ready"); assert.equal(f.api.snapshot().items[0].status, "ready");
});

test("reference adapter Reload reports statuses to subscribers and concurrent native Reload shares one operation", async () => {
  const f = decodedFixture(); f.asset("image");
  let calls = 0, finish;
  f.api.registerReloader({ id: "delayed", reload() { calls++; return new Promise(resolve => { finish = resolve; }); } });
  const seen = []; f.api.subscribe(s => seen.push(s.items.find(i => i.id === "image")?.status)); f.flush();
  const first = f.api.reload("image"), second = f.api.reload("image"); assert.equal(first, second);
  await flush(); f.flush(); assert.equal(calls, 1); assert.ok(seen.includes("loading"));
  finish(); assert.equal((await first).ok, true); await flush(); f.flush(); assert.ok(seen.includes("ready"));
  let reloaded = 0;
  f.api.registerReferences({ id: "custom", collect(_project, emit) { emit({ key: "custom", item: { kind: "custom", source: "embedded" } }); }, reload(key) { assert.equal(key, "custom"); reloaded++; } });
  assert.equal((await f.api.reload("custom")).ok, true); assert.equal(reloaded, 1);
});

test("embedded adapter failures and recovery publish failed and ready statuses", async () => {
  const f = fixture(); let fail = true;
  f.api.registerReferences({ id: "embedded", collect(_project, emit) { emit({ key: "item", item: { kind: "custom", source: "embedded" } }); },
    reload() { if (fail) throw new Error("Invalid adapter bytes"); } });
  const failed = await f.api.reload("item"); assert.equal(failed.ok, false); assert.equal(failed.status, "failed");
  assert.equal(f.api.snapshot().items[0].status, "failed");
  fail = false; assert.equal((await f.api.reload("item")).ok, true); assert.equal(f.api.snapshot().items[0].status, "ready");
});


test("image Reload reads attached bytes even when its old Blob URL is unavailable", async () => {
  const f = decodedFixture(), file = new Blob(["image"]);
  f.asset("image", { file, url: null });
  assert.equal((await f.api.reload("image")).ok, true);
  assert.equal(f.api.snapshot().items[0].status, "ready");
});

test("a pre-reload geometry read cannot overwrite the new decoded geometry", async () => {
  const f = decodedFixture(); let reads = 0, finish;
  const file = { size: 20, text() { return ++reads === 1 ? new Promise(resolve => { finish = resolve; }) : Promise.resolve('{"revision":2}'); } };
  const asset = f.asset("geometry", { filename: "mesh.json", file });
  const wrapper = new f.PZ.asset.geometry(asset), old = wrapper.getGeometry();
  assert.equal((await f.api.reload("geometry")).ok, true);
  const current = wrapper.data.geometry; finish('{"revision":1}'); await old;
  assert.equal(wrapper.data.geometry, current); assert.equal(current.parsed.revision, 2);
});


test("embedded preset URLs export their bytes without creating object URLs", async () => {
  const f = decodedFixture({ fetch: async () => ({ ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer }) });
  f.asset("sprite", { source: 3, file: null, url: "data:image/png;base64,AQID", filename: "sprite.png" });
  f.properties(f.child(f.project.sequence, new f.Obj("Particles")), { texture: new f.Property("Texture", "sprite") });
  assert.equal(f.api.capabilities(f.api.snapshot().items[0]).exportFile, true);
  const result = await f.api.exportFile("sprite");
  assert.equal(result.filename, "sprite.png"); assert.deepEqual(new Uint8Array(await result.blob.arrayBuffer()), new Uint8Array([1, 2, 3]));
});
