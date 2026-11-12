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
  const sampleDefinition = require("../plugins/shader-plus/kinds.js").KINDS.timeSample.create();
  const sampleShader = "precision highp float;\nuniform sampler2D Past;\nvarying vec2 vUvScaled;\nvoid main(){gl_FragColor=texture2D(Past,vUvScaled);}";
  for (const adjustment of [false, true]) {
    const data = project([box()], [{ type: 1, properties: { fragShader: sampleShader }, customProperties: [
      { type: copy(sampleDefinition), properties: { name: "Past" }, ...scalar(-2, 2) },
    ] }], adjustment);
    add("shader-plus", adjustment ? "time-sample-adjustment" : "time-sample", data);
  }
  for (const kind of ["slider", "gradient", "curve", "palette", "text", "timeSample"]) {
    const definition = require("../plugins/shader-plus/kinds.js").KINDS[kind].create();
    const texture = ["gradient", "curve", "text", "timeSample"].includes(kind);
    const source = "precision highp float;\nuniform sampler2D tDiffuse;\nuniform " + (texture ? "sampler2D" : kind === "palette" ? "vec4" : "float") +
      " Input" + (kind === "palette" ? "[16]" : "") + ";\nvarying vec2 vUvScaled;\nvoid main(){gl_FragColor=" +
      (texture ? kind === "text" ? "texture2D(tDiffuse,vUvScaled)*texture2D(Input,vUvScaled).a" : "texture2D(Input,vUvScaled)" : kind === "palette" ? "texture2D(tDiffuse,vUvScaled)*Input[0]" : "texture2D(tDiffuse,vUvScaled)*Input") + ";}";
    add("shader-plus", kind === "timeSample" ? "zero-offset" : "legacy-" + kind,
      project([box()], [{ type: 1, properties: { fragShader: source }, customProperties: [
        { type: copy(definition), properties: { name: "Input" }, ...(definition.dynamic ? scalar(definition.value) : { value: definition.value }) },
      ] }]));
  }
  const { effectorEntryDefs } = require("../plugins/expresstext-plus/expresstext-properties");
  const propertyTypes = { NUMBER: 0, VECTOR3: 2, OPTION: 6, TEXT: 7 };
  const expressEntries = effectorEntryDefs({ property: { type: propertyTypes } });
  const expressSection = (name, values) => {
    const type = copy(expressEntries.find(entry => entry.name === name).type);
    return { type, objects: type.objects.map(definition => copy(values[definition.effectorKey] || {})) };
  };
  for (const folder of ["text-plus", "scene-plus", "trapcode-suite", "optical-flares", "expresstext-plus"]) {
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
      if (folder === "expresstext-plus") {
        data.objects = [{ type: 1, properties: { text: "CACHE", detail: 2 },
          material: { type: "singlecolor", properties: { color: vector([0.2, 0.65, 1]) } } }];
        data.customProperties = [
          expressSection("Plain", { plainPosition: { objects: [scalar(0), { animated: true, keyframes: [
            { frame: 0, value: 0, tween: 1 }, { frame: 7, value: 0, tween: 1 },
            { frame: 8, value: 6, tween: 1 },
          ] }, scalar(0)] } }),
          expressSection("Delay", { delayStrength: scalar(100), delayMode: scalar(0) }),
        ];
      }
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
  const camera = { type: "zoidium:camera-plus/camera", properties: {
    position: vector([-8, 0, 80], [8, 4, 80]), rotation: vector([0, 0, 0]),
  } };
  add("camera-plus", "scene-camera-animation", project([camera, box()]), { cameraCheck: "scene" });
  const sharedCamera = project();
  sharedCamera.sequence.videoTracks[0].track3d = true;
  sharedCamera.sequence.videoTracks.push({ type: 0, clips: [{ start: 0, length: 60,
    properties: {}, object: { type: 9, objects: [copy(camera)], effects: [] } }] });
  add("camera-plus", "shared-camera-animation", sharedCamera, { cameraCheck: "shared" });

  const source = project();
  source.sequence.videoTracks[0].clips[0].object.objects[1].material.properties.color = vector([0.1, 0.8, 0.3]);
  source.sequence.videoTracks[0].clips[0].object.objects[1].properties.position = vector([-35, 12, 0], [-5, 18, 0]);
  source.sequence.videoTracks[0]._zoidiumLayerInputId = "oracle-source";
  source.sequence.videoTracks.push({ type: 0, _zoidiumLayerInputId: "oracle-consumer", clips: [{
    start: 0, length: 60, properties: {}, object: { type: 4, properties: { background: [0.2, 0.05, 0.1] },
      objects: [{ type: 6, objectType: 1 }, box()], effects: [{ type: "layerinput",
      properties: { source: "track:id:oracle-source", opacity: scalar(0.7) } }] },
  }] });
  add("layer-input", "animated-source", source, { sourceEdit: true });
  const nested = copy(source);
  nested.media.push({ properties: { name: "Oracle nested" }, assets: [], data: [copy(nested.sequence.videoTracks[0])],
    comp: { id: "oracle-nested", clipLinks: null } });
  nested.sequence.videoTracks[0].clips[0].object = { type: 2, compId: "oracle-nested", offset: 0,
    properties: {}, effects: [], objects: [] };
  add("layer-input", "nested-source", nested, { nestedEdit: true });
  const displacement = copy(source);
  displacement.sequence.videoTracks[0].clips[0].object.properties.background = [1, 1, 1];
  const detail = displacement.sequence.videoTracks[1].clips[0].object.objects;
  for (let i = 0; i < 8; i++) {
    const stripe = box();
    stripe.properties.geometryProperties.box_size = [3, 36, 10];
    stripe.properties.position = vector([-35 + i * 10, 0, 0]);
    detail.push(stripe);
  }
  displacement.sequence.videoTracks[1].clips[0].object.effects = [{ type: "layerinputdisplacement",
    properties: { source: "track:id:oracle-source", amount: scalar(0.7), wrap: 1 } }];
  add("layer-input", "displacement-track", displacement, { sourceEdit: true });
  const timeDisplacement = copy(source);
  timeDisplacement.sequence.videoTracks[1].clips[0].object.effects = [{ type: "timedisplacement",
    properties: { source: "track:id:oracle-source", maxTime: scalar(0.5), resolution: scalar(4) } }];
  add("layer-input", "time-displacement-track", timeDisplacement, { sourceEdit: true });
  const material = copy(source);
  const consumerScene = material.sequence.videoTracks[1].clips[0].object;
  consumerScene.effects = [];
  consumerScene.objects[1].material = { type: "layersource", properties: { source: "track:id:oracle-source" } };
  add("layer-input", "material-track", material, { sourceEdit: "material" });
  for (const [name, base, kind] of [
    ["effect-image", source, "effect"], ["displacement-image", displacement, "effect"],
    ["time-displacement-image", timeDisplacement, "effect"], ["material-image", material, "material"],
  ]) {
    const data = copy(base);
    for (const id of ["oracle-image-a", "oracle-image-b"]) {
      data.assets[id] = { sha256: id, source: 1, filename: id + ".png" };
    }
    const scene = data.sequence.videoTracks[1].clips[0].object;
    const consumer = kind === "material" ? scene.objects[1].material : scene.effects[0];
    consumer.properties.source = "image";
    consumer.properties.sourceImage = "oracle-image-a";
    add("layer-input", name, data, { imageEdit: kind });
  }
  for (const mode of ["source", "masks", "effects-masks"]) {
    const shader = copy(source);
    shader.sequence.videoTracks[1].clips[0].object.effects = [{ type: 1,
      properties: { fragShader: "precision highp float; uniform sampler2D Input; varying vec2 vUvScaled; void main(){gl_FragColor=texture2D(Input,vUvScaled);}" },
      customProperties: [{ type: { custom: true, type: 9, value: "", items: [],
        _zoidiumLayerSource: true, _zoidiumShaderLayerSource: true, _zoidiumLayerInputMode: mode },
      properties: { name: "Input" }, value: "track:id:oracle-source" }] }];
    add("layer-input", "shader-" + mode, shader, { sourceEdit: "shader", sourceMode: mode });
  }

  const expr = project();
  expr.sequence.videoTracks[0].clips[0].object.objects[1].properties.position.objects[0] = {
    ...scalar(0), expression: "seedRandom(42); value + random() * 10 + time * fps",
  };
  add("expressions-plus", "seeded-time-fps", expr);
  const stateful = copy(expr);
  stateful.sequence.videoTracks[0].clips[0].object.objects[1].properties.position.objects[0].expression =
    "Math.counter = (Math.counter || 0) + 1; Math.counter";
  add("expressions-plus", "mutable-realm", stateful);
  for (const fixture of result) {
    fixture.requiredPlugin = fixture.plugin === "effector-plus" ? "repeater" : fixture.plugin;
    if (fixture.name === "time-displacement-image") fixture.requiredPlugin = "native-fx";
    if (fixture.plugin === "ccfx-shader-pack" || fixture.name === "legacy-slider") fixture.requiredPlugin = null;
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
  const imageBlobs = {};
  if (fixture.imageEdit) {
    const canvas = document.createElement("canvas");
    canvas.width = 64; canvas.height = 64;
    const context = canvas.getContext("2d");
    for (const [id, inverse] of [["oracle-image-a", false], ["oracle-image-b", true]]) {
      for (let y = 0; y < 64; y += 8) for (let x = 0; x < 64; x += 8) {
        context.fillStyle = ((x + y) / 8 % 2 === 0) !== inverse ? "#ffffff" : "#101020";
        context.fillRect(x, y, 8, 8);
      }
      imageBlobs[id] = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
    }
  }
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
    for (const [id, blob] of Object.entries(imageBlobs)) data.assets[id].file = blob;
    project.load(data);
    editor.project = project;
    await project._zoidiumPluginActivationPending;
    await resources(editor.project.sequence);
    if (fixture.imageEdit) {
      const scene = project.sequence.videoTracks[1].clips[0].object;
      const consumer = fixture.imageEdit === "material" ? scene.objects[1].material : scene.effects[0];
      await consumer._zoidiumSourceImage?.loading;
    }
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
  const frames = fixture.full ? [11] : fixture.plugin === "expresstext-plus" ? [0, 1, 8, 11, 37] :
    fixture.prefetch ? [0, 1, 11, 37] : [0, 11, 37];
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
  if (fixture.cameraCheck) {
    const tracks = editor.project.sequence.videoTracks;
    const scene = tracks[0].clips[0].object;
    const camera = fixture.cameraCheck === "scene" ? scene.objects[1] : tracks[1].clips[0].object.objects[0];
    if (scene.pass.camera !== camera.threeObj) throw new Error("Fixture did not select Camera+");
    checks.push("camera-selected");
  }
  if (fixture.sourceEdit && !fixture.full) {
    const tracks = editor.project.sequence.videoTracks;
    const scene = tracks.find(track => track._zoidiumLayerInputId === "oracle-consumer").clips[0].object;
    const effect = fixture.sourceEdit === "material" ? scene.objects[1].material : scene.effects[0];
    const sourceProperty = fixture.sourceEdit === "shader" ? effect.customProperties[0] : undefined;
    if (fixture.sourceMode && PZ.layerInput.getSourceMode(effect, sourceProperty) !== fixture.sourceMode) throw new Error("Shader source mode was not restored");
    if (PZ.layerInput.getSourceToken(effect, sourceProperty) !== "track:id:oracle-source") throw new Error("Layer source was not resolved");
    const before = await draw(11, false);
    const toggle = fixture.sourceEdit === "material" ? effect.properties.opacity : effect.properties.enabled;
    toggle.set(0, 11);
    const withoutSource = await draw(11, false);
    let contributed = false;
    try { equal(before, withoutSource, "source contribution control"); } catch (_error) { contributed = true; }
    if (!contributed) throw new Error("Layer source did not change pixels");
    toggle.set(1, 11);
    const sourceBox = tracks.find(track => track._zoidiumLayerInputId === "oracle-source").clips[0].object.objects[1];
    async function checkEdit(label, edit) {
      const original = await draw(11, true);
      await replay(11);
      edit();
      document.dispatchEvent(new Event("input", { bubbles: true }));
      const edited = await draw(11, false);
      let changed = false;
      try { equal(original, edited, label + " control"); } catch (_error) { changed = true; }
      if (!changed) throw new Error(label + " did not change pixels");
      equal(edited, await draw(11, true), label + " vs cached");
      equal(edited, await replay(11), label + " replay");
      const data = fixture.data;
      try {
        fixture.data = JSON.parse(JSON.stringify(editor.project));
        await load();
        equal(edited, await draw(11, false), label + " vs fresh project");
      } finally { fixture.data = data; }
      checks.push(label + "-invalidation");
    }
    await checkEdit("source-property", () => sourceBox.material.properties.color.set([0.8, 0.1, 0.9], 11));
    const currentSource = editor.project.sequence.videoTracks.find(track => track._zoidiumLayerInputId === "oracle-source");
    const position = currentSource.clips[0].object.objects[1].properties.position.objects[0];
    await checkEdit("source-keyframe", () => {
      const keys = JSON.stringify(position.keyframes);
      position.set(40, 11);
      if (JSON.stringify(position.keyframes) === keys) throw new Error("Source keyframes did not change");
    });
    await load();
  }
  if (fixture.imageEdit && !fixture.full) {
    const scene = editor.project.sequence.videoTracks[1].clips[0].object;
    const consumer = fixture.imageEdit === "material" ? scene.objects[1].material : scene.effects[0];
    if (consumer.properties.source.get() !== "image") throw new Error("Image source was not restored");
    const before = await draw(11, false);
    const toggle = fixture.imageEdit === "material" ? consumer.properties.opacity : consumer.properties.enabled;
    toggle.set(0, 11);
    const disabled = await draw(11, false);
    let changed = false;
    try { equal(before, disabled, "image contribution"); } catch (_error) { changed = true; }
    if (!changed) throw new Error("Image source did not change pixels");
    toggle.set(1, 11);
    const retained = await draw(11, true);
    await replay(11);
    consumer.properties.sourceImage.set("oracle-image-b");
    await consumer._zoidiumSourceImage?.loading;
    document.dispatchEvent(new Event("input", { bubbles: true }));
    const edited = await draw(11, false);
    changed = false;
    try { equal(retained, edited, "image swap"); } catch (_error) { changed = true; }
    if (!changed) throw new Error("Image swap did not change pixels");
    equal(edited, await draw(11, true), "image swap vs cached");
    equal(edited, await replay(11), "image swap replay");
    const data = fixture.data;
    try {
      fixture.data = JSON.parse(JSON.stringify(editor.project));
      await load();
      equal(edited, await draw(11, false), "image swap vs fresh project");
    } finally { fixture.data = data; }
    checks.push("image-swap-invalidation");
    await load();
  }
  if (fixture.nestedEdit && !fixture.full) {
    const scene = editor.project.sequence.videoTracks[1].clips[0].object;
    const effect = scene.effects[0];
    if (PZ.layerInput.getSourceToken(effect) !== "track:id:oracle-source") throw new Error("Nested source was not resolved");
    const before = await draw(11, false);
    effect.properties.enabled.set(0, 11);
    const disabled = await draw(11, false);
    let changed = false;
    try { equal(before, disabled, "nested contribution"); } catch (_error) { changed = true; }
    if (!changed) throw new Error("Nested source did not change pixels");
    effect.properties.enabled.set(1, 11);
    for (const kind of ["property", "keyframe"]) {
      const retained = await draw(11, true);
      await replay(11);
      const opened = PZ.precomp.openComp(editor, "oracle-nested");
      if (!opened.ok) throw new Error("Could not open nested composition: " + opened.message);
      await resources(editor.project.sequence);
      const box = editor.project.sequence.videoTracks[0].clips[0].object.objects[1];
      if (kind === "property") box.material.properties.color.set([0.8, 0.1, 0.9], 11);
      else {
        const position = box.properties.position.objects[0], keys = JSON.stringify(position.keyframes);
        position.set(40, 11);
        if (JSON.stringify(position.keyframes) === keys) throw new Error("Nested keyframes did not change");
      }
      const closed = PZ.precomp.openComp(editor, "main");
      if (!closed.ok) throw new Error("Could not return to main: " + closed.message);
      document.dispatchEvent(new Event("input", { bubbles: true }));
      const edited = await draw(11, false);
      changed = false;
      try { equal(retained, edited, "nested edit"); } catch (_error) { changed = true; }
      if (!changed) throw new Error("Nested " + kind + " edit did not change pixels");
      equal(edited, await draw(11, true), "nested " + kind + " vs cached");
      equal(edited, await replay(11), "nested " + kind + " replay");
      const data = fixture.data;
      try {
        fixture.data = JSON.parse(JSON.stringify(editor.project));
        await load();
        equal(edited, await draw(11, false), "nested " + kind + " vs fresh project");
      } finally { fixture.data = data; }
      checks.push("nested-" + kind + "-invalidation");
    }
    await load();
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
