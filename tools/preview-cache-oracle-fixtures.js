"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { root } = require("./preview-cache-approvals");
const copy = value => JSON.parse(JSON.stringify(value));
const scalar = (value, end) => ({ animated: end !== undefined, keyframes: [
  { frame: 0, value, tween: 1 }, ...(end === undefined ? [] : [{ frame: 48, value: end, tween: 1 }]),
] });
const vector = (value, end) => ({ objects: value.map((v, i) => scalar(v, end?.[i])) });
function box() {
  return { type: 0, objectType: 1, properties: { geometryProperties: { box_size: [24, 16, 10] },
    position: vector([-15, 0, 0], [15, 6, 0]), rotation: vector([12, 20, 0], [12, 80, 25]) },
  material: { type: "singlecolor", properties: { color: vector([0.8, 0.25, 0.12]) } } };
}
function project(objects = [box()], effects = [], adjustment = false) {
  const clip = object => ({ start: 0, length: 60, properties: {}, object });
  const tracks = [{ type: 0, clips: [clip({ type: 4, properties: { background: [0.03, 0.06, 0.11] },
    effects: adjustment ? [] : effects, objects: [{ type: 6, objectType: 1 }, ...objects] })] }];
  if (adjustment) tracks.push({ type: 0, clips: [clip({ type: 1, effects })] });
  return { assets: {}, media: [], sequence: { properties: { resolution: [1280, 720], rate: 30 },
    length: 60, videoTracks: tracks, audioTracks: [], clipLinks: { links: {}, seed: 0 } } };
}
function fixtures() {
  const result = [];
  const add = (plugin, name, data, extra = {}) => result.push({ plugin, name, data, ...extra });
  const manifest = folder => JSON.parse(fs.readFileSync(path.join(root, "plugins", folder, "manifest.json"), "utf8"));
  const native = manifest("native-fx");
  for (const effect of native.nativeEffects) {
    const properties = { enabled: scalar(1) };
    const overrides = { timeoffset: { offset: 3 }, posterizetime: { rate: 12 },
      echo: { echoes: 3, delay: 2 }, ccwidetime: { forwardSteps: 2, backwardSteps: 2 },
      smartmotionblur: { amount: 0.5 }, cardwipe: { transition: 35 }, ccpageturn: { foldPosition: 0.4 } };
    for (const [key, value] of Object.entries(overrides[effect.id] || {})) properties[key] = scalar(value);
    add(native.id, effect.id, project([box()], [{ type: effect.id, properties }], true), {
      liveOnly: ["timeoffset", "posterizetime"].includes(effect.id),
    });
  }
  for (const mode of [1, 2]) {
    add(native.id, "smartmotionblur-mode-" + mode, project([box()], [{ type: "smartmotionblur",
      properties: { reconstruction: scalar(mode), amount: scalar(0.5), quality: scalar(0) } }], true));
  }
  const ccfx = manifest("ccfx");
  const shaderData = effect => {
    const data = JSON.parse(fs.readFileSync(path.join(root, effect.preset.split("?")[0]), "utf8"));
    const shader = fs.readFileSync(path.join(root, effect.shader.split("?")[0]), "utf8");
    data.properties.fragShader = shader + "\n// @zoidium-plugin " + JSON.stringify({
      id: ccfx.id, name: ccfx.name, author: ccfx.author, version: ccfx.version, effect: effect.id,
    });
    return data;
  };
  for (const effect of ccfx.effects) add(ccfx.id, effect.id, project([box()], [shaderData(effect)]));
  for (const folder of ["text-plus", "scene-plus", "trapcode-suite", "optical-flares"]) {
    const m = manifest(folder);
    const entries = m.objectTypes.flatMap(group => group.list || []);
    for (const entry of entries) {
      const data = { ...copy(entry.data || {}), type: entry.type };
      if (folder === "text-plus") {
        data.objects = [{ type: 1, properties: { text: "CACHE", detail: 2 },
          material: { type: "singlecolor", properties: { color: vector([0.2, 0.65, 1]) } } }];
        data.characterProperties = { ...(data.characterProperties || {}), shakeAmplitude: scalar(3) };
      }
      if (folder === "scene-plus") data.objects = [box()];
      add(m.id, entry.name, project([data]));
    }
  }
  for (const type of [7, 8, 9]) add("effector-plus", "legacy-type-" + type,
    project([{ type, objects: [box()], properties: {}, repeaterProperties: {} }]));
  return result;
}

// Runs in the actual staged CM3 editor. No copied renderer or pixel emulation.
async function compareFixture(fixture) {
  const editor = globalThis.CM, cache = globalThis.ZoidiumFrameCache;
  const temporal = globalThis.PZ.zoidium.temporal;
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  async function resources(object, seen = new Set()) {
    if (!object || typeof object !== "object" || seen.has(object)) return;
    seen.add(object);
    await object.loading; await object.loadShaders;
    if (object.font) { await object.font.loading; await object.font.loading3d; }
    if (object.image) await object.image.loading;
    if (object.texture) await object.texture.loading;
    for (const child of object.children || []) {
      for (const item of Array.isArray(child) ? child : [child]) await resources(item, seen);
    }
  }
  async function load() {
    const project = new globalThis.PZ.project();
    project.load(JSON.parse(JSON.stringify(fixture.data)));
    editor.project = project;
    await project._zoidiumPluginActivationPending;
    await resources(editor.project.sequence);
    await document.fonts.ready;
    cache.debug.prefetchDisabled = true;
    cache.clear();
    const viewport = editor.mainViewport;
    if (!viewport.__zoidiumPlayerPlusPaused) throw new Error("Pause drawing must stay enabled");
    const requirements = JSON.parse(JSON.stringify(editor.project)).plugins || [];
    if (!requirements.some(item => item.id === fixture.plugin)) {
      throw new Error("Fixture does not require its plugin: " + JSON.stringify(requirements));
    }
  }
  function pixels() {
    const renderer = editor.mainViewport.renderer, gl = renderer.context;
    renderer.setRenderTarget(null);
    const bytes = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
    gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
    if (gl.getError() !== gl.NO_ERROR) throw new Error("WebGL readback failed");
    return bytes;
  }
  function equal(a, b, label) {
    if (a.length !== b.length) throw new Error(label + ": size differs");
    let count = 0, first = -1, max = 0;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) {
      count++; if (first < 0) first = i; max = Math.max(max, Math.abs(a[i] - b[i]));
    }
    if (count) throw new Error(label + ": " + count + " unequal bytes, first " + first + ", max " + max);
  }
  async function draw(frame, capture) {
    const viewport = editor.mainViewport;
    editor.playback.currentFrame = frame;
    cache.debug.disabled = !capture;
    await editor.project.sequence.prepare(frame, { sequence: editor.project.sequence });
    const initialStores = cache.debug.stores;
    for (let attempt = 0; attempt < 250; attempt++) {
      const stores = cache.debug.stores;
      viewport.__zoidiumPlayerPlusRenderOnce = true;
      viewport.lastFrame = NaN;
      viewport._render();
      // Read synchronously while the default framebuffer is still preserved.
      let bytes = viewport.lastFrame === frame ? pixels() : null;
      if (capture && cache.debug.stores > stores) return bytes || pixels();
      const runtime = temporal.frameSamplerRuntimes?.get(viewport.compositor);
      if (!capture && bytes && !runtime?.previewPending) return bytes;
      await pause(8);
      // Temporal completion happens asynchronously. Render once again to
      // display its prepared result in this task before reading the canvas.
      if (capture && cache.debug.stores > initialStores && viewport.lastFrame === frame) {
        viewport.__zoidiumPlayerPlusRenderOnce = true;
        viewport._render();
        return pixels();
      }
    }
    throw new Error("Frame " + frame + " did not complete: " + cache.usage().reason);
  }
  const frames = fixture.full ? [11] : [0, 11, 37];
  const references = new Map();
  for (const frame of frames) { await load(); references.set(frame, await draw(frame, false)); }
  await load();
  const checks = [];
  for (const frame of [...frames].reverse()) {
    const live = await draw(frame, !fixture.liveOnly);
    equal(references.get(frame), live, "fresh vs seek " + frame);
    checks.push("fresh-seek-" + frame);
  }
  const order = fixture.full ? [11] : [11, 37, 0, 37, 11, 0];
  for (const frame of order) {
    const hits = cache.debug.hits;
    const viewport = editor.mainViewport;
    editor.playback.currentFrame = frame;
    viewport.__zoidiumPlayerPlusRenderOnce = true;
    viewport._render();
    if (!fixture.liveOnly && cache.debug.hits !== hits + 1) throw new Error("Expected cache hit at " + frame);
    equal(references.get(frame), pixels(), "cached vs fresh " + frame);
    checks.push("replay-" + frame);
  }
  // Fresh live draws after other seeks also have to match the cold references.
  for (const frame of frames) {
    equal(references.get(frame), await draw(frame, false), "history vs fresh " + frame);
    checks.push("history-" + frame);
  }
  const sample = references.get(frames[0]);
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", sample)), b => b.toString(16).padStart(2, "0")).join("");
  const colors = new Set(); for (let i = 0; i < sample.length; i += 4) colors.add(sample.slice(i, i + 4).join(","));
  if (colors.size < 2) throw new Error("Fixture has no visible content");
  return { checks: checks.length, bytes: sample.length, colors: colors.size, digest,
    entries: cache.debug.entries, liveOnly: !!fixture.liveOnly };
}
module.exports = { fixtures, compareFixture };
