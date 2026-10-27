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
      echo: { echoes: 3, delay: 2 }, timedifference: { offset: 0.1 }, ccwidetime: { forwardSteps: 2, backwardSteps: 2 },
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
    for (const property of data.customProperties || []) {
      if (property.properties?.name === "wipePercent") Object.assign(property, scalar(0.25, 0.75));
      if (effect.id.includes("-transitions-")) {
        const settings = { borderWidth: 0.04, borderSoftness: 0.01, gradAdd: 0.2, edgeSoftness: 0.02 };
        if (Object.hasOwn(settings, property.properties?.name)) Object.assign(property, scalar(settings[property.properties.name]));
      }
    }
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
        data.characterProperties = { ...(data.characterProperties || {}), shakeAmplitude: scalar(0.25),
          charRotation: vector([0, 0, 0], [0, 0, 0.4]), delayPerCharacter: scalar(2),
          lastPosition: vector([0, 2, 0], [0, 6, 0]), amount: scalar(0, 1) };
        if (String(data.type).endsWith("character-material")) {
          data.frontMaterial = { type: "singlecolor", properties: { color: vector([0.1, 0.8, 0.3]) } };
          data.sideMaterial = { type: "singlecolor", properties: { color: vector([0.8, 0.1, 0.6]) } };
        }
      }
      if (folder === "scene-plus") {
        data.objects = [box()];
        data.properties = { ...data.properties, angle: scalar(0.2, 1.1), amount: scalar(2, 8),
          offsetPosition: vector([0, 0, 0], [3, 5, 0]) };
      }
      if (folder === "optical-flares") data.properties = { position: vector([-8, 0, 0], [8, 4, 0]) };
      const objects = [data];
      if (folder === "trapcode-suite" && String(data.type).includes("light")) {
        data.properties = { ...data.properties, position: vector([0, 0, 30]), target: vector([0, 0, 0]),
          intensity: scalar(8), width: scalar(60), height: scalar(60) };
        const subject = box(); subject.material.type = "custom"; objects.push(subject);
      }
      add(m.id, entry.name, project(objects));
    }
  }
  for (const type of [7, 8, 9]) add("effector-plus", "legacy-type-" + type,
    project([{ type, objects: [box()], properties: { angle: scalar(0.2, 1.1), amount: scalar(2, 8) }, repeaterProperties: {} }]));
  for (const fixture of result) {
    fixture.requiredPlugin = fixture.plugin === "effector-plus" ? "repeater" : fixture.plugin;
    if (fixture.plugin === "ccfx-shader-pack") fixture.requiredPlugin = null;
    fixture.prefetch = !fixture.liveOnly && (fixture.name === result.find(item => item.plugin === fixture.plugin)?.name ||
      /echo|smartmotionblur|timedisplacement|ccwidetime|timedifference|Shake|Delay|Particular|Form|Plexus/.test(fixture.name));
  }
  add(native.id, "unrelated-bundle-error", project(), {
    bundleFailure: "easing-plus", prefetch: true, requirePrefetch: true,
  });
  const video = project();
  video.assets["oracle-video"] = { sha256: "oracle-video", source: 1, filename: "oracle-video.webm" };
  video.sequence.length = 360;
  video.sequence.videoTracks.push({ type: 0, clips: [{ start: 300, length: 30,
    properties: { media: "oracle-video" }, object: { type: 0, properties: {}, effects: [] } }] });
  add(native.id, "video-outside-prefetch-window", video, {
    syntheticVideo: true, prefetch: true, requirePrefetch: true,
  });
  return result;
}

// Runs in the actual staged CM3 editor. No copied renderer or pixel emulation.
async function compareFixture(fixture) {
  const editor = globalThis.CM, cache = globalThis.ZoidiumFrameCache;
  const temporal = globalThis.PZ.zoidium.temporal;
  cache.debug.assertKeys = true;
  const mismatches = cache.debug.keyMismatches;
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  let videoBlob = null, pluginError = null;
  if (fixture.bundleFailure) {
    const manager = globalThis.ZoidiumPluginManagerInternals;
    const state = manager.pluginStates.get(fixture.bundleFailure);
    if (!state || state.activationStarted !== false) throw new Error("Failure fixture must start before activation");
    await manager.enablePlugin(state, false);
    pluginError = PZ.zoidium.getDebugPlugins().find(plugin => plugin.id === fixture.bundleFailure);
    if (!pluginError?.lastError || pluginError.activationStarted || pluginError.phase !== "error") {
      throw new Error("Fixture did not produce a bundle failure before activation");
    }
  }
  if (fixture.syntheticVideo) {
    // Generated locally from a canvas. No user media or external fixture files.
    const canvas = document.createElement("canvas");
    canvas.width = 16; canvas.height = 16;
    const context = canvas.getContext("2d");
    context.fillStyle = "#e04020"; context.fillRect(0, 0, 16, 16);
    const stream = canvas.captureStream(10), chunks = [];
    const recorder = new MediaRecorder(stream, { mimeType: "video/webm;codecs=vp8" });
    recorder.ondataavailable = event => chunks.push(event.data);
    const stopped = new Promise(resolve => { recorder.onstop = resolve; });
    recorder.start(); await pause(150); recorder.stop(); await stopped;
    for (const track of stream.getTracks()) track.stop();
    videoBlob = new Blob(chunks, { type: "video/webm" });
    if (!videoBlob.size) throw new Error("Synthetic video recording is empty");
  }
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
    const data = JSON.parse(JSON.stringify(fixture.data));
    if (videoBlob) data.assets["oracle-video"].file = videoBlob;
    project.load(data);
    editor.project = project;
    await project._zoidiumPluginActivationPending;
    await resources(editor.project.sequence);
    await document.fonts.ready;
    cache.debug.prefetchDisabled = true;
    cache.clear();
    const viewport = editor.mainViewport;
    if (!viewport.__zoidiumPlayerPlusPaused) throw new Error("Pause drawing must stay enabled");
    const requirements = JSON.parse(JSON.stringify(editor.project)).plugins || [];
    if (fixture.requiredPlugin && !requirements.some(item => item.id === fixture.requiredPlugin)) {
      throw new Error("Fixture does not require its plugin: " + JSON.stringify(requirements));
    }
    if (pluginError && requirements.some(item => item.id === pluginError.id)) throw new Error("Failed plugin is required");
    if (fixture.syntheticVideo && !project.sequence.videoSchedules.some(schedule =>
      schedule.items.some(item => item.media && item.start === 300))) throw new Error("Video schedule is missing");
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

    for (let attempt = 0; attempt < 250; attempt++) {
      const hits = cache.debug.hits;
      viewport.__zoidiumPlayerPlusRenderOnce = true;
      viewport.lastFrame = NaN;
      viewport._render();
      // Read synchronously while the default framebuffer is still preserved.
      let bytes = viewport.lastFrame === frame ? pixels() : null;
      if (capture && cache.debug.hits > hits) return bytes || pixels();
      const runtime = temporal.frameSamplerRuntimes?.get(viewport.compositor);
      if (!capture && bytes && !runtime?.previewPending) return bytes;
      const controller = viewport.__zoidiumOutputFrames;
      if (capture && controller?.reason?.includes("validation is deferred")) await pause(1550);
      else {
        // Wait for preparation without driving another viewport draw each tick.
        for (let wait = 0; wait < 1000; wait++) {
          const pending = temporal.frameSamplerRuntimes?.get(viewport.compositor)?.previewPending ||
            controller?.settling || controller?.readying;
          if (!pending) break;
          await pause(8);
        }
        await pause(8);
      }

    }
    throw new Error("Frame " + frame + " did not complete: " + cache.usage().reason);
  }
  async function replay(frame) {
    const viewport = editor.mainViewport, stores = cache.debug.stores;
    editor.playback.currentFrame = frame;
    for (let attempt = 0; attempt < 3; attempt++) {
      const hits = cache.debug.hits;
      viewport.__zoidiumPlayerPlusRenderOnce = true;
      viewport._render();
      // A live recapture would no longer test the original retained pixels.
      if (cache.debug.stores !== stores) throw new Error("Replay unexpectedly recaptured frame " + frame);
      if (cache.debug.hits === hits + 1) return pixels();
      if (!cache.usage().reason?.includes("validation is deferred")) break;
      await pause(1550);
    }
    throw new Error("Expected cache hit at " + frame + ": " + cache.usage().reason);
  }
  const frames = fixture.full ? [11] : fixture.prefetch ? [0, 1, 11, 37] : [0, 11, 37];
  const references = new Map();
  for (const frame of frames) { await load(); references.set(frame, await draw(frame, false)); }
  await load();
  const checks = [];
  let warmPasses = 0;
  do {
    // Resource completion can invalidate entries captured earlier in this pass.
    // Retain the whole window before asserting replay hits. Every capture is
    // read back only after the actual cache display path reports a hit.
    for (const frame of [...frames].reverse()) {
      const live = await draw(frame, !fixture.liveOnly);
      equal(references.get(frame), live, "fresh vs seek " + frame);
      checks.push("fresh-seek-" + frame);
    }
    warmPasses++;
  } while (!fixture.liveOnly && cache.debug.entries < frames.length && warmPasses < 4);
  if (!fixture.liveOnly && cache.debug.entries < frames.length) throw new Error("Cache window did not settle");
  const order = fixture.full ? [11] : [11, 37, 0, 37, 11, 0];
  for (const frame of order) {
    let bytes;
    if (fixture.liveOnly) bytes = await draw(frame, false);
    else bytes = await replay(frame);
    equal(references.get(frame), bytes, "cached vs fresh " + frame);
    checks.push("replay-" + frame);
  }
  // Fresh live draws after other seeks also have to match the cold references.
  for (const frame of frames) {
    equal(references.get(frame), await draw(frame, false), "history vs fresh " + frame);
    checks.push("history-" + frame);
  }
  let prefetch = "not selected", prefetchFrame = null, privateVideos = 0;
  if (fixture.prefetch && !fixture.full) {
    cache.clear();
    await draw(0, true);
    const before = cache.debug.prefetched;
    cache.debug.prefetchDisabled = false;
    const viewport = editor.mainViewport;
    viewport.__zoidiumPlayerPlusRenderOnce = true; viewport._render();
    for (let attempt = 0; attempt < 400 && cache.debug.prefetched === before; attempt++) {
      if (viewport.__zoidiumOutputFrames.unsupported) break;
      await pause(8);
    }
    cache.debug.prefetchDisabled = true;
    // Let any in-flight capture finish before a seek invalidates its graph.
    while (viewport.__zoidiumOutputFrames.prefetching) await pause(8);
    if (cache.debug.prefetched > before) {
      if (fixture.syntheticVideo) {
        const schedules = viewport.__zoidiumOutputFrames.snapshot?.project.sequence.videoSchedules || [];
        const videos = schedules.filter(schedule => schedule.items.some(item => item.media));
        privateVideos = videos.length;
        if (!privateVideos || videos.some(schedule => schedule.currentItem || schedule.el?.getAttribute("src") ||
            schedule.__zoidiumVideoExportState)) throw new Error("Private video decoder started outside its window");
      }
      let frame = 1;
      while (viewport.__zoidiumOutputFrames.prefetchSkipped.has(frame)) frame++;
      const cached = await replay(frame);
      if (!references.has(frame)) { await load(); references.set(frame, await draw(frame, false)); }
      equal(references.get(frame), cached, "private prefetch vs fresh " + frame);
      checks.push("prefetch-" + frame); prefetch = "matched"; prefetchFrame = frame;
    } else prefetch = viewport.__zoidiumOutputFrames.unsupported ? "serialization gate" : "not produced";
    if (fixture.requirePrefetch && prefetch !== "matched") throw new Error("Required prefetch comparison: " + prefetch);
  }
  const referenceDigests = [];
  for (const [frame, bytes] of references) referenceDigests.push([frame,
    Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), b => b.toString(16).padStart(2, "0")).join("")]);
  if (cache.debug.keyMismatches !== mismatches) throw new Error("Project key changed without invalidation");
  if (fixture.liveOnly && cache.debug.entries !== 0) throw new Error("Plain time operator unexpectedly retained frames");
  const colorsOf = bytes => {
    const values = new Set();
    for (let i = 0; i < bytes.length; i += 4) values.add(bytes.slice(i, i + 4).join(","));
    return values.size;
  };
  // Transition endpoints may be fully transparent or a solid fill. Require
  // visible detail somewhere in the fixture, while comparing every sampled frame.
  const sample = [...references.values()].sort((a, b) => colorsOf(b) - colorsOf(a))[0];
  const corrupted = sample.slice(); corrupted[0] ^= 1;
  let detected = false;
  try { equal(sample, corrupted, "oracle control"); } catch (_error) { detected = true; }
  if (!detected) throw new Error("Byte mismatch control failed");
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", sample)), b => b.toString(16).padStart(2, "0")).join("");
  const colors = colorsOf(sample);
  if (colors < 2) throw new Error("Fixture has no visible content");
  return { checks: checks.length, warmPasses, prefetch, prefetchFrame, privateVideos,
    pluginError: pluginError && { id: pluginError.id, phase: pluginError.phase, activationStarted: pluginError.activationStarted },
    referenceDigests, bytes: sample.length, colors, digest,
    entries: cache.debug.entries, liveOnly: !!fixture.liveOnly };
}
module.exports = { fixtures, compareFixture };
