"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");

const source = fs.readFileSync(path.join(__dirname, "../plugins/core/font-load.js"), "utf8");
function fixture(options = {}) {
  const cleanup = [], notifications = [], reads = [];
  const metrics = { familyName: "Example", glyphs: { A: { ha: 20, o: "" } },
    resolution: 1000, boundingBox: { yMin: -10, yMax: 100 }, underlineThickness: 1 };
  class Font {
    constructor(asset) {
      this.asset = asset;
      this.data = asset.data.get(Font);
      if (!this.data) {
        this.data = { font3d: null, font3dLoading: null, fontFamilyName: "" };
        asset.data.set(Font, this.data);
      }
    }
    get loading3d() { return this.data.font3dLoading; }
    get font3d() { return this.data.font3d; }
    get3DFont() { throw new Error("native loader"); }
    readFile() { return options.remoteRead ? options.remoteRead() : Promise.resolve("ttf"); }
  }
  class Text {
    constructor(font) {
      this.font = font; this.fontNeedsUpdate = true; this.geometryNeedsUpdate = true;
      this.threeObj = { visible: true, geometry: { vertices: [], dispose() {} } };
      this.materialPrepared = 0;
    }
    updateFont() {
      const wrapper = this.font;
      if (wrapper) wrapper.get3DFont().then(() => { if (this.font === wrapper) this.geometryNeedsUpdate = true; });
    }
    updateGeometry() { if (this.font?.font3d) this.threeObj.geometry = { vertices: [1, 2, 3], dispose() {} }; }
    update() {
      if (this.fontNeedsUpdate) { this.updateFont(); this.fontNeedsUpdate = false; }
      if (this.geometryNeedsUpdate) { this.updateGeometry(); this.geometryNeedsUpdate = false; }
    }
    async prepare() { if (this.font) await this.font.loading3d; this.materialPrepared += 1; }
    unload() { this.unloaded = true; }
  }
  class Reader {
    readAsArrayBuffer(file) {
      reads.push(this);
      const complete = () => {
        if (file.error) { this.error = file.error; this.onerror(); }
        else if (file.abort) this.onabort();
        else { this.result = file.bytes || "ttf"; this.onload(); }
      };
      if (file.delayed) file.complete = complete;
      else queueMicrotask(complete);
    }
  }
  class AssetList {
    constructor() { this.list = {}; this.events = []; this.onAssetCreated = { update: a => this.events.push(a) }; }
    load(key) {
      const asset = this.list[key] || (this.list[key] = { file: null, source: 1, key, sha256: key, data: new Map(), references: 0, mediaReferences: 0 });
      asset.references += 1; return asset;
    }
    removeIfUnused(asset) { if (asset.references <= 0 && asset.mediaReferences <= 0) delete this.list[asset.key]; }
  }
  const originalAssetList = { load: AssetList.prototype.load, removeIfUnused: AssetList.prototype.removeIfUnused };
  const PZ = { assetList: AssetList, asset: { font: Font, source: { FILE: 1 } }, object3d: { text: Text } };
  const originals = Object.fromEntries(["get3DFont", "font3d", "loading3d"].map(k => [k, Object.getOwnPropertyDescriptor(Font.prototype, k)]));
  const originalText = Object.fromEntries(["update", "prepare", "updateGeometry", "unload"].map(k => [k, Text.prototype[k]]));
  const host = { URL: { createObjectURL: () => "blob:restored" }, FileReader: Reader, TextDecoder: class { decode(value) { return value; } },
    ZoidiumUI: { notify(value) { if (options.notifyThrows) throw new Error("notification renderer"); notifications.push(value); } },
    THREE: { TTFLoader: class { parse(bytes) { if (bytes === "ttf") return metrics; throw new Error("Invalid TTF"); } },
      Font: class { constructor(data) { this.data = data; } }, Geometry: class { constructor() { this.vertices = []; } } } };
  if (options.retry) {
    Object.assign(host, { AbortController, setTimeout: (...args) => setTimeout(...args), clearTimeout: id => clearTimeout(id) });
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../plugins/core/asset-registry-fetch.js"), "utf8"), host);
  }
  const sandbox = { module: { exports: {} } };
  vm.runInNewContext(source, sandbox);
  sandbox.module.exports.activate({ PZ, window: host, lifecycle: { onDispose(fn) { cleanup.push(fn); } } });
  const asset = (file = { bytes: "ttf" }) => ({ file, source: 1, sha256: "key", key: "key", filename: "Example.ttf", references: 0, mediaReferences: 0, data: new Map() });
  return { Font, Text, AssetList, asset, reads, metrics, host, notifications, originals, originalText, originalAssetList,
    dispose: () => cleanup.forEach(fn => fn()) };
}
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

test("missing font settles to null once and native preparation continues", async () => {
  const f = fixture(), wrapper = new f.Font(f.asset(null)), text = new f.Text(wrapper);
  text.update(); await text.prepare(); text.update();
  assert.equal(await wrapper.loading3d, null);
  assert.equal(wrapper.font3d, null);
  assert.equal(wrapper.data.zoidiumFont3dState, "failed");
  assert.equal(wrapper.data.zoidiumFont3dError.stage, "font read");
  assert.equal(text.materialPrepared, 1);
  assert.equal(text.threeObj.visible, false);
  assert.equal(f.notifications.length, 1);
  assert.match(f.notifications[0].message, /Example.ttf.*key.*font read/);
  assert.equal(await wrapper.get3DFont(), null);
  assert.equal(f.notifications.length, 1);
});

for (const [name, file, stage] of [
  ["invalid TTF", { bytes: "broken font" }, "font parse"],
  ["invalid JSON", { bytes: '{"familyName":' }, "font parse"],
  ["JSON lacking glyph metrics", { bytes: '{"familyName":"Font", "glyphs":{}}' }, "font parse"],
  ["file read failure", { error: new Error("Unreadable bytes") }, "font read"],
  ["file read abort", { abort: true }, "font read"],
]) test(`${name} resolves failure without leaving preparation pending`, async () => {
  const f = fixture(), font = new f.Font(f.asset(file));
  assert.equal(await font.get3DFont(), null);
  assert.equal(font.data.zoidiumFont3dError.stage, stage);
  assert.equal(await font.loading3d, null);
  assert.equal(f.notifications.length, 1);
});

test("valid TTF shares one parse and its native family name", async () => {
  const f = fixture(), asset = f.asset(), first = new f.Font(asset), second = new f.Font(asset);
  const a = first.get3DFont(), b = second.get3DFont();
  assert.equal(a, b); assert.equal(a, first.loading3d);
  const font = await a;
  assert.equal(font.data, f.metrics);
  assert.equal(second.font3d, font);
  assert.equal(first.data.fontFamilyName, "example");
  assert.equal(first.data.zoidiumFont3dState, "ready");
  assert.equal(f.reads.length, 1); assert.equal(f.notifications.length, 0);
});

test("valid JSON uses the native Three Font representation", async () => {
  const f = fixture(), font = new f.Font(f.asset({ bytes: JSON.stringify(f.metrics) }));
  assert.deepEqual(JSON.parse(JSON.stringify((await font.get3DFont()).data)), f.metrics);
  assert.equal(f.notifications.length, 0);
});

test("older typeface JSON without line metrics still loads with defaults", async () => {
  const f = fixture();
  const { boundingBox: _bounds, underlineThickness: _thickness, ...older } = f.metrics;
  const font = new f.Font(f.asset({ bytes: JSON.stringify(older) }));
  const data = (await font.get3DFont()).data;
  assert.equal(data.underlineThickness, 0);
  assert.deepEqual(JSON.parse(JSON.stringify(data.boundingBox)), { yMin: 0, yMax: 1000 });
  assert.equal(f.notifications.length, 0);
});

test("a delayed valid read stays pending and silent until it finishes", async () => {
  const f = fixture(), file = { delayed: true }, font = new f.Font(f.asset(file));
  const operation = font.get3DFont(); let settled = false; operation.then(() => { settled = true; });
  await flush(); assert.equal(settled, false); assert.equal(f.notifications.length, 0);
  assert.equal(font.get3DFont(), operation);
  file.complete(); assert.ok(await operation); assert.equal(f.notifications.length, 0);
});

test("an inherited valid font load remains pending and retains its native result", async () => {
  const f = fixture(), file = { delayed: true }, font = new f.Font(f.asset(file));
  let resolve; const inherited = new Promise(r => { resolve = r; }); font.data.font3dLoading = inherited;
  const bridge = font.get3DFont(); let settled = false; bridge.then(() => { settled = true; });
  await flush(); assert.equal(settled, false); assert.equal(font.font3d, null);
  file.complete(); await flush(); assert.equal(settled, false); assert.equal(font.font3d, null);
  const nativeFont = { data: f.metrics }; font.data.font3d = nativeFont; resolve(nativeFont);
  assert.equal(await bridge, nativeFont); assert.equal(f.notifications.length, 0);
});

test("inherited native missing and invalid loads settle through the bridge", async () => {
  for (const file of [null, { bytes: "invalid" }]) {
    const f = fixture(), font = new f.Font(f.asset(file));
    font.data.font3dLoading = new Promise(() => {});
    assert.equal(await font.get3DFont(), null); assert.equal(await font.loading3d, null);
    assert.equal(f.notifications.length, 1);
  }
});

test("disposal also settles an inherited load after its valid byte check", async () => {
  const f = fixture(), font = new f.Font(f.asset()); font.data.font3dLoading = new Promise(() => {});
  const bridge = font.get3DFont(); await flush(); f.dispose(); assert.equal(await bridge, null);
});

test("attaching bytes to the same asset resets all wrappers and rebuilds Text", async () => {
  const f = fixture(), asset = f.asset(null), font = new f.Font(asset), other = new f.Font(asset), text = new f.Text(font);
  text.update(); await text.prepare(); assert.equal(font.font3d, null);
  asset.file = { bytes: "ttf" };
  text.update(); await text.prepare(); text.update();
  assert.ok(font.font3d); assert.equal(other.font3d, font.font3d);
  assert.equal(font.data.zoidiumFont3dError, null);
  assert.equal(text.threeObj.geometry.vertices.length, 3);
  assert.equal(text.threeObj.visible, true);
});

test("replacing loaded bytes empties stale geometry and clears 2D/family state", async () => {
  const f = fixture(), asset = f.asset(), font = new f.Font(asset), text = new f.Text(font);
  text.update(); await text.prepare(); text.update();
  font.data.font2d = {}; font.data.font2dLoading = Promise.resolve({});
  asset.file = { bytes: "invalid" };
  text.update(); await text.prepare(); text.update();
  assert.equal(text.threeObj.geometry.vertices.length, 0); assert.equal(text.threeObj.visible, false);
  assert.equal(font.data.fontFamilyName, ""); assert.equal(font.data.font2d, null); assert.equal(font.data.font2dLoading, null);
});

test("native font-property undo and redo rebuild valid and failing Text", async () => {
  const f = fixture(), bad = new f.Font(f.asset({ bytes: "invalid" })), good = new f.Font(f.asset()), text = new f.Text(bad);
  text.update(); await text.prepare(); text.update();
  text.font = good; text.update(); await text.prepare(); text.update(); assert.equal(text.threeObj.geometry.vertices.length, 3);
  text.font = bad; text.update(); await text.prepare(); text.update(); assert.equal(text.threeObj.geometry.vertices.length, 0);
  text.font = good; text.update(); await text.prepare(); text.update(); assert.equal(text.threeObj.geometry.vertices.length, 3);
  assert.equal(f.notifications.length, 1);
});

test("late completion from old bytes cannot replace the new font", async () => {
  const f = fixture(), file = { delayed: true }, asset = f.asset(file), font = new f.Font(asset);
  const stale = font.get3DFont(); await flush(); asset.file = { bytes: "invalid" };
  const current = font.get3DFont(); assert.equal(await stale, null); assert.equal(await current, null);
  file.complete(); await flush(); assert.equal(font.font3d, null); assert.equal(f.notifications.length, 1);
});

test("remote failures settle, and changing URL permits recovery", async () => {
  let failing = true; const f = fixture({ remoteRead: () => failing ? Promise.reject(new Error("Network failure")) : Promise.resolve("ttf") });
  const asset = f.asset(null); asset.source = 3; asset.url = "/font.ttf"; const font = new f.Font(asset);
  assert.equal(await font.get3DFont(), null); failing = false; asset.url = "/replacement.ttf";
  assert.ok(await font.get3DFont()); assert.equal(f.notifications.length, 1);
});

test("recreating a local blob URL does not reload unchanged bytes", async () => {
  const f = fixture(), asset = f.asset(), font = new f.Font(asset); const original = await font.get3DFont();
  asset.url = "blob:restored"; assert.equal(await font.get3DFont(), original); assert.equal(f.reads.length, 1);
});

test("notification failure cannot leave the font pending", async () => {
  const f = fixture({ notifyThrows: true }), font = new f.Font(f.asset(null));
  assert.equal(await font.get3DFont(), null);
});

test("disposal restores every descriptor, visibility, and pending operation", async () => {
  const f = fixture(), file = { delayed: true }, font = new f.Font(f.asset(file)), text = new f.Text(font);
  text.update(); await flush(); const pending = font.loading3d;
  f.dispose(); assert.equal(await pending, null); assert.equal(text.threeObj.visible, true);
  for (const [key, descriptor] of Object.entries(f.originals)) assert.deepEqual(Object.getOwnPropertyDescriptor(f.Font.prototype, key), descriptor);
  for (const [key, original] of Object.entries(f.originalText)) assert.equal(f.Text.prototype[key], original);
  for (const [key, original] of Object.entries(f.originalAssetList)) assert.equal(f.AssetList.prototype[key], original);
  file.complete(); await flush(); assert.equal(font.font3d, null); assert.equal(f.notifications.length, 0);
  assert.equal(font.data.zoidiumFont3dState, undefined);
});

test("disposal clears a failed cached operation so the native loader can retry", async () => {
  const f = fixture(), font = new f.Font(f.asset(null)); await font.get3DFont(); f.dispose();
  assert.equal(font.data.font3dLoading, null); assert.equal(font.data.zoidiumFont3dError, undefined);
});

test("disposal preserves foreign replacement patches and originally hidden Text", async () => {
  const f = fixture(), font = new f.Font(f.asset(null)), text = new f.Text(font);
  text.threeObj.visible = false; text.update(); await text.prepare();
  const replacement = () => {}; f.Text.prototype.update = replacement; f.dispose();
  assert.equal(f.Text.prototype.update, replacement); assert.equal(text.threeObj.visible, false);
});

test("retired preset fonts remain reusable for native history", async () => {
  const f = fixture(), list = new f.AssetList(), asset = f.asset();
  asset.source = 3; asset.url = "/preset.ttf";
  list.list[asset.key] = asset; const wrapper = new f.Font(asset); const parsed = await wrapper.get3DFont();
  list.removeIfUnused(asset); assert.equal(list.list[asset.key], undefined);
  const restored = list.load(asset.key); assert.equal(restored, asset); assert.equal(restored.file, asset.file);
  assert.equal(restored.url, "/preset.ttf"); assert.equal(new f.Font(restored).font3d, parsed);
  assert.equal(list.events.length, 1); restored.references = 0; list.removeIfUnused(restored);
  assert.equal(list.load(asset.key), asset);
});

test("retired font caches stay within their asset list and leave other assets alone", () => {
  const f = fixture(), first = new f.AssetList(), second = new f.AssetList(), font = f.asset(), image = f.asset();
  new f.Font(font); first.list[font.key] = font; first.removeIfUnused(font);
  assert.notEqual(first.load(font.key), font);
  assert.notEqual(second.load(font.key), font);
  image.key = "image"; image.sha256 = "image"; first.list.image = image; first.removeIfUnused(image);
  assert.notEqual(first.load("image"), image);
});

test("foreign wrappers retaining a Core method become native after disposal", async () => {
  const f = fixture(), font = new f.Font(f.asset()), text = new f.Text(font);
  const update = f.Text.prototype.update, getter = f.Font.prototype.get3DFont;
  f.Text.prototype.update = function () { return update.apply(this, arguments); };
  f.Font.prototype.get3DFont = function () { return getter.apply(this, arguments); };
  f.dispose(); text.fontNeedsUpdate = false; text.geometryNeedsUpdate = false;
  text.threeObj.visible = true; text.update(); assert.equal(text.threeObj.visible, true);
  assert.throws(() => font.get3DFont(), /native loader/);
});


test("public reset reloads identical input and rearms the one-time warning", async () => {
  let failing = true;
  const f = fixture({ remoteRead: () => failing ? Promise.reject(new Error("Network failure")) : Promise.resolve("ttf") });
  const asset = f.asset(null); asset.source = 3; asset.url = "/font.ttf";
  const font = new f.Font(asset), other = new f.Font(asset), text = new f.Text(font);
  text.update(); await text.prepare(); assert.equal(f.notifications.length, 1);
  await font.reset(); assert.equal(f.notifications.length, 2);
  failing = false; assert.ok(await font.reset()); text.update(); await text.prepare(); text.update();
  assert.equal(other.font3d, font.font3d); assert.equal(text.threeObj.visible, true);
  assert.equal(text.threeObj.geometry.vertices.length, 3);
});

test("transient font requests retry at 2, 6 and 18 seconds while prepare keeps waiting", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let reads = 0, prepared = false;
  const f = fixture({ retry: true, remoteRead: () => {
    reads++; return reads <= 3 ? Promise.reject(Object.assign(new Error("HTTP 503"), { status: 503 })) : Promise.resolve("ttf");
  } });
  const asset = f.asset(null); asset.source = 3; asset.url = "/font.ttf";
  const font = new f.Font(asset), text = new f.Text(font);
  text.update(); const preparation = text.prepare().then(() => { prepared = true; }); await flush();
  assert.equal(reads, 1); assert.equal(prepared, false);
  for (const [delay, expected] of [[2000, 2], [6000, 3], [18000, 4]]) {
    t.mock.timers.tick(delay - 1); await flush(); assert.equal(reads, expected - 1);
    t.mock.timers.tick(1); await flush(); assert.equal(reads, expected);
  }
  await preparation; assert.equal(prepared, true); assert.ok(font.font3d); assert.equal(f.notifications.length, 0);
});

test("retry exhaustion stays failed until reset and disposal cancels retry timers", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let reads = 0;
  const f = fixture({ retry: true, remoteRead: () => { reads++; return Promise.reject(new TypeError("Failed to fetch")); } });
  const asset = f.asset(null); asset.source = 3; asset.url = "/font.ttf";
  const font = new f.Font(asset), operation = font.get3DFont(); await flush();
  for (const delay of [2000, 6000, 18000]) { t.mock.timers.tick(delay); await flush(); }
  assert.equal(await operation, null); assert.equal(reads, 4); assert.equal(f.notifications.length, 1);
  t.mock.timers.tick(60000); await flush(); assert.equal(reads, 4); assert.equal(await font.get3DFont(), null);
  const again = font.reset(); await flush(); assert.equal(reads, 5); f.dispose(); assert.equal(await again, null);
  t.mock.timers.tick(60000); await flush(); assert.equal(reads, 5);
});

test("missing files, parse errors and HTTP 404 never schedule font retries", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  for (const failure of ["missing", "parse", "http"]) {
    let reads = 0;
    const f = fixture({ retry: true, remoteRead: () => { reads++; return failure === "http" ? Promise.reject(new Error("HTTP 404")) : Promise.resolve("invalid"); } });
    const asset = f.asset(null); if (failure !== "missing") { asset.source = 3; asset.url = "/font.ttf"; }
    const font = new f.Font(asset); assert.equal(await font.get3DFont(), null);
    t.mock.timers.tick(60000); await flush(); assert.equal(reads, failure === "missing" ? 0 : 1);
  }
});


test("private clone font wrappers share retries without extra reads or stale completion after reset", async () => {
  let resolve, reads = 0;
  const f = fixture({ remoteRead: () => { reads++; return reads === 1 ? new Promise(r => { resolve = r; }) : Promise.resolve("ttf"); } });
  const asset = f.asset(null); asset.source = 3; asset.url = "/font.ttf";
  const font = new f.Font(asset), clone = new f.Font({ ...asset });
  const first = font.get3DFont(); await flush();
  assert.equal(clone.get3DFont(), first); assert.equal(reads, 1);
  assert.ok(await font.reset()); assert.equal(await first, null);
  resolve("invalid"); await flush();
  assert.equal(font.data.zoidiumFont3dState, "ready"); assert.equal(f.notifications.length, 0);
  assert.equal(await clone.get3DFont(), font.font3d);
});
