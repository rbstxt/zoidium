"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const vm = require("node:vm");
function harness() {
  const clips = [], listeners = new Map();
  let records, theme = null;
  const model = require("../zoidium/theme-model.js");
  function element(clip) {
    const properties = new Map();
    const handles = [{}, {}];
    return { pz_object: clip, dataset: {}, handles, classList: { contains: (name) => name === "clip" },
      style: { setProperty: (k, v) => properties.set(k, v), removeProperty: (k) => properties.delete(k) }, properties };
  }
  class AudioClip {} class Audio {} class Layer {}
  Layer.texture = class {};
  const proto = { createClipElement(clip) { const el = element(clip); clips.push(el); return el; } };
  const window = {
    PZ: { clip: { audio: AudioClip }, audio: Audio, layer: Layer, ui: { objectTypes: new Map([[Layer, [{ type: 7, name: "Text" }, { type: 4, name: "Scene" }]]]), timeline: { tracks: { prototype: proto } } } },
    CM: { project: { media: [{ preset: true, properties: { name: { get: () => "Camera" } }, data: [{ clips: [{ object: { type: 9 } }] }] }] } },
    document: { body: {}, querySelectorAll: () => clips },
    ZoidiumUIBuilder: { themeModel: model, themeEditor: { selected: () => theme, palette: () => model.presetPalette("panzoid") } },
    addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: (name) => listeners.delete(name), dispatchEvent() {},
  };
  class Observer { constructor(fn) { records = fn; } observe() {} disconnect() {} }
  vm.runInNewContext(fs.readFileSync(require.resolve("../zoidium/theme-clips.js"), "utf8"), { window, MutationObserver: Observer, CustomEvent: class {} });
  return { window, proto, adapter: window.ZoidiumUIBuilder.themeClips, element, clips, listeners,
    setTheme(value) { theme = value; }, records: (value) => records(value) };
}
test("timeline wrapper preserves native nodes and handles, changes only theme properties", () => {
  const h = harness();
  const node = h.proto.createClipElement({ object: { type: 7 } });
  const handles = node.handles;
  assert.equal(node.dataset.zoidiumLayerType, "cm3:7");
  assert.equal(node.properties.get("--zoidium-clip-label"), "#2c323f");
  h.setTheme({ clips: { "cm3:7": "#000000" } }); h.adapter.refresh();
  assert.equal(node.properties.get("--zoidium-layer-clip"), "#000000");
  assert.equal(node.properties.get("--zoidium-clip-label"), "#f4f4f4");
  assert.equal(node.handles, handles);
  h.setTheme(null); h.adapter.refresh();
  assert.equal(node.properties.has("--zoidium-layer-clip"), false);
});
test("native drag proxies are tagged on addition without replacing nodes", () => {
  const h = harness(), proxy = h.element({ object: { type: 4 } });
  proxy.nodeType = 1;
  h.records([{ addedNodes: [proxy] }]);
  assert.equal(proxy.dataset.zoidiumLayerType, "cm3:4");
});
test("registered plugin legacy aliases and media display names resolve consistently", () => {
  const h = harness();
  const remove = h.adapter.register({ id: "camera-plus/camera", type: 9, legacyType: 9 });
  const camera = h.proto.createClipElement({ object: { type: 9 } });
  assert.equal(camera.dataset.zoidiumLayerType, "zoidium:camera-plus/camera");
  const types = h.adapter.types();
  assert.equal(types.find((t) => t.key === "zoidium:camera-plus/camera").name, "Camera");
  assert.ok(types.find((t) => t.key === "audio"));
  assert.ok(types.find((t) => t.key === "cm3:0"));
  remove();
  h.listeners.get("pagehide")();
  assert.equal(h.listeners.has("zoidium:theme-changed"), false);
});
