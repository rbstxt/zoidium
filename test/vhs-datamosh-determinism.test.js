"use strict";

// Determinism coverage for the VHS and Datamosh effects. The real
// zoidium/plugin-apis.js (defineFrameSampler) and the real effect sources run
// against a mocked THREE/PZ and a mocked frame-sampler host. The host mirrors
// buildFrameSamplePlan in plugins/core/temporal-render.js. Each render records
// its draws, so tests can compare draws across render histories and check that
// no pass reads a texture it has not written in the same render call.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const MAX_FRAME_SAMPLES = 16;
const SOURCE_LENGTH = 100000;

function read(relative) {
  return fs.readFileSync(path.join(root, relative), "utf8");
}

// Same arithmetic as buildFrameSamplePlan in plugins/core/temporal-render.js.
function buildPlan(outputFrame, count, offsetFrames, startOpacity, decay) {
  const total = Math.min(MAX_FRAME_SAMPLES, Math.max(0, Math.round(Number(count) || 0)));
  const samples = [];
  const clamp01 = (v) => Math.min(1, Math.max(0, Number(v) || 0));
  for (let index = 1; index <= total; index += 1) {
    const frame = Math.min(SOURCE_LENGTH, Math.max(0, outputFrame + offsetFrames * index));
    samples.push({
      frame,
      index,
      opacity: clamp01(startOpacity) * Math.pow(clamp01(decay), index - 1),
    });
  }
  return samples;
}

function createSandbox({ adjustmentLayer = true } = {}) {
  let targetCounter = 0;

  class Vector2 {
    constructor(x = 0, y = 0) {
      this.x = x;
      this.y = y;
    }
    set(x, y) {
      this.x = x;
      this.y = y;
      return this;
    }
  }
  class Scene {
    constructor() {
      this.children = [];
    }
    add(object) {
      this.children.push(object);
    }
  }
  class Mesh {
    constructor(geometry, material) {
      this.geometry = geometry;
      this.material = material;
      this.frustumCulled = true;
    }
  }
  class ShaderMaterial {
    constructor(options) {
      this.uniforms = options.uniforms;
      this.vertexShader = options.vertexShader;
      this.fragmentShader = options.fragmentShader;
    }
    dispose() {}
  }
  class WebGLRenderTarget {
    constructor(width, height) {
      targetCounter += 1;
      this.width = width;
      this.height = height;
      this.texture = { id: `target:${targetCounter}`, generateMipmaps: true };
    }
    setSize(width, height) {
      this.width = width;
      this.height = height;
    }
    dispose() {}
  }
  class PlaneBufferGeometry {
    constructor(width, height) {
      this.width = width;
      this.height = height;
    }
    dispose() {}
  }
  function Pass() {
    this.enabled = true;
    this.needsSwap = true;
    this.clear = false;
    this.renderToScreen = false;
  }
  class OrthographicCamera {}

  // Host: resolves samples the same way the compositor does. Source frames
  // are named after their frame index so tests can see which frames were read.
  const host = {
    resolveFrameSamples(effect) {
      if (!adjustmentLayer) return [];
      const descriptor = effect._zoidiumFrameSampler;
      const controlFrame = effect._zoidiumFrameSamplerFrame;
      const request = descriptor.getRequest(effect, controlFrame);
      if (!request || request.enabled === false) return [];
      return buildPlan(controlFrame, request.count, request.offsetFrames,
        request.startOpacity, request.decay).map((item) => ({
        frame: item.frame,
        index: item.index,
        opacity: item.opacity,
        texture: { id: `source:${item.frame}` },
      }));
    },
  };

  const sandbox = {
    console,
    PZ: {
      property: { type: { NUMBER: 0, VECTOR2: 1, OPTION: 9, LIST: 10, TEXT: 15 } },
      expression: function Expression(source) {
        this.source = source;
      },
      layer: { adjustment: class Adjustment {} },
      zoidium: { temporal: host },
    },
    THREE: {
      Vector2,
      Scene,
      Mesh,
      ShaderMaterial,
      WebGLRenderTarget,
      PlaneBufferGeometry,
      Pass,
      OrthographicCamera,
      LinearFilter: 1,
      NearestFilter: 2,
      RGBAFormat: 3,
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(read("zoidium/plugin-apis.js"), sandbox, { filename: "plugin-apis.js" });
  return sandbox;
}

function createPropertyList() {
  const list = {};
  Object.defineProperties(list, {
    addAll: {
      value(definitions) {
        for (const key of Object.keys(definitions)) {
          const definition = definitions[key];
          let value = typeof definition.value === "function" ? 0 : definition.value;
          list[key] = {
            definition,
            get() {
              return value;
            },
            set(next) {
              value = next;
            },
            getAddress() {
              return key;
            },
            frameOffset: 0,
          };
        }
      },
    },
    load: {
      value(data) {
        if (!data) return;
        for (const key of Object.keys(list)) {
          if (data[key] === undefined) continue;
          const saved = data[key];
          const number = typeof saved === "number" ? saved : saved && saved.value;
          if (typeof number === "number") list[key].set(number);
        }
      },
    },
  });
  return list;
}

function instantiate(sandbox, relative, type) {
  const instance = { type, properties: createPropertyList(), parent: {}, parentLayer: null };
  sandbox.instance = instance;
  vm.runInContext(`(function () {\n${read(relative)}\n}).call(instance);`, sandbox, {
    filename: relative,
  });
  return instance;
}

function createDatamosh(options) {
  const sandbox = createSandbox(options);
  const effect = instantiate(sandbox, "plugins/openzoid-legacy/effects/datamosh.js", "datamosh");
  effect.load({});
  return effect;
}

function createVhs(options) {
  const sandbox = createSandbox(options);
  const effect = instantiate(sandbox, "plugins/openzoid-legacy/effects/vhs.js", "vhs");
  effect.load({});
  return effect;
}

// Texture or target names are canonical within one pass, so they compare across
// separate instances. Source frames keep their frame-based names.
function canonicalObject(pass, object) {
  for (const key of Object.keys(pass)) {
    const value = pass[key];
    if (value === object) return key;
    if (Array.isArray(value)) {
      const index = value.indexOf(object);
      if (index >= 0) return `${key}[${index}]`;
    }
  }
  return null;
}

function canonicalTexture(pass, texture) {
  if (!texture || typeof texture.id !== "string") return texture;
  if (texture.id.startsWith("source:")) return texture.id;
  const owner = Object.keys(pass).reduce((found, key) => {
    if (found) return found;
    const value = pass[key];
    if (value && value.texture === texture) return key;
    if (Array.isArray(value)) {
      const index = value.findIndex((item) => item && item.texture === texture);
      if (index >= 0) return `${key}[${index}]`;
    }
    return null;
  }, null);
  return owner ? `${owner}.texture` : texture.id;
}

function snapshotUniforms(pass, uniforms) {
  const out = {};
  for (const name of Object.keys(uniforms).sort()) {
    const value = uniforms[name].value;
    if (value && typeof value.id === "string") {
      out[name] = canonicalTexture(pass, value);
    } else if (value && typeof value.x === "number") {
      out[name] = [value.x, value.y];
    } else {
      out[name] = value;
    }
  }
  return out;
}

// Renders one output frame and returns its draws. The renderer records each
// draw as { program, target, uniforms }.
function renderFrame(effect, frame, size = { width: 64, height: 48 }) {
  effect.update(frame);
  const pass = effect.pass;
  const readBuffer = {
    width: size.width,
    height: size.height,
    texture: { id: `source:${frame}` },
  };
  const writeBuffer = {
    width: size.width,
    height: size.height,
    texture: { id: "output:" + frame },
  };
  const draws = [];
  const renderer = {
    autoClear: true,
    render(scene, camera, target) {
      const material = scene.children[0].material;
      draws.push({
        program: canonicalObject(pass, material),
        target: canonicalObject(pass, target) || "output",
        uniforms: snapshotUniforms(pass, material.uniforms),
        reads: Object.values(material.uniforms)
          .map((uniform) => uniform.value)
          .filter((value) => value && typeof value.id === "string")
          .map((value) => canonicalTexture(pass, value)),
      });
    },
  };
  pass.render(renderer, writeBuffer, readBuffer);
  return draws;
}

// Every read must be a source frame or a target written earlier in this call.
// The output buffer must never be read, which rules out feedback.
function assertNoFeedback(draws) {
  const written = new Set();
  for (const draw of draws) {
    for (const read of draw.reads) {
      if (read.startsWith("source:")) continue;
      const name = read.replace(/\.texture$/, "");
      assert.ok(name !== "output", "a pass read the output buffer");
      assert.ok(written.has(name), `read of ${name} before it was written this call`);
    }
    written.add(draw.target);
  }
}

function setProperties(effect, values) {
  for (const key of Object.keys(values)) effect.properties[key].set(values[key]);
}

// --- Datamosh --------------------------------------------------------------

test("datamosh: keyframe frames pass the source through with no samples", () => {
  const effect = createDatamosh();
  setProperties(effect, { algorithm: 0, interval: 30, samples: 6 });
  const draws = renderFrame(effect, 60);
  assert.equal(draws.length, 1, "only the warp pass runs");
  assert.equal(draws[0].program, "materialWarp");
  assert.equal(draws[0].uniforms.hasSamples, 0);
});

test("datamosh: request windows stay inside the segment and within the sample cap", () => {
  const effect = createDatamosh();
  setProperties(effect, { algorithm: 0, interval: 30, samples: 6 });
  for (let t = 0; t < 200; t += 1) {
    const request = effect._zoidiumFrameSampler.getRequest(effect, t);
    const segmentStart = Math.floor(t / 30) * 30;
    const age = t - segmentStart;
    if (!request.enabled) {
      assert.equal(age, 0, `frame ${t} disabled only at a keyframe`);
      continue;
    }
    assert.ok(request.count >= 1 && request.count <= 15, `count bounded at ${t}`);
    const samples = buildPlan(t, request.count, request.offsetFrames, 1, 1);
    assert.equal(samples.length, request.count);
    const frames = samples.map((sample) => sample.frame);
    assert.ok(Math.min(...frames) >= segmentStart, `no sample before segment start at ${t}`);
    assert.ok(Math.max(...frames) < t, `no sample at or after t at ${t}`);
    if (age <= 6) {
      assert.equal(Math.min(...frames), segmentStart, `anchor is the segment start at ${t}`);
    }
  }
});

test("datamosh: same frame renders identically regardless of render history", () => {
  const initial = createDatamosh();
  setProperties(initial, { algorithm: 0 });
  const fresh = renderFrame(initial, 40);
  assert.ok(fresh.length > 1, "the segment frame runs motion passes");

  const used = createDatamosh();
  setProperties(used, { algorithm: 0 });
  for (const frame of [3, 17, 41, 39, 12, 99]) renderFrame(used, frame);
  assert.deepEqual(renderFrame(used, 40), fresh);

  const reversed = createDatamosh();
  setProperties(reversed, { algorithm: 0 });
  for (let frame = 80; frame >= 40; frame -= 1) renderFrame(reversed, frame);
  assert.deepEqual(renderFrame(reversed, 40), fresh);
});

test("datamosh: repeated renders of one frame do not change the result", () => {
  const effect = createDatamosh();
  const first = renderFrame(effect, 50);
  for (let i = 0; i < 4; i += 1) renderFrame(effect, 51 + i);
  assert.deepEqual(renderFrame(effect, 50), first);
});

test("datamosh: no pass reads a texture it did not write in the same call", () => {
  const effect = createDatamosh();
  for (let frame = 0; frame < 120; frame += 7) {
    assertNoFeedback(renderFrame(effect, frame));
  }
});

test("datamosh: an unavailable sampler falls back to the current frame", () => {
  const effect = createDatamosh({ adjustmentLayer: false });
  const draws = renderFrame(effect, 45);
  assert.equal(draws.length, 1);
  assert.equal(draws[0].uniforms.hasSamples, 0);
});

test("datamosh: legacy Davidium properties migrate to the new keys", () => {
  const effect = createDatamosh();
  effect.load({
    properties: {
      enabled: 1,
      amount: 0.5,
      algorithm: 11,
      hold: 0.3,
      speed: 2,
      time: { animated: true, expression: "time", keyframes: [] },
      intensity: 0.9,
    },
  });
  assert.equal(effect.properties.motion.get(), 8, "Algorithm 11 (Random) maps to Random");
  assert.equal(effect.properties.amount.get(), 0.5);
  assert.equal(effect.properties.intensity.get(), 0.9);
  assert.equal(effect.properties.interval.get(), 30, "new keys keep their defaults");
  assert.equal(effect.properties.hold.get(), 0.3);
  assert.equal(effect.properties.speed.get(), 2);
  assert.ok(effect.properties.time);
  assert.equal(effect.properties.algorithm.get(), 12, "old Algorithm 11 keeps the Random look");
});

test("datamosh: motion-mode indexes stay within the nine modes", () => {
  const effect = createDatamosh();
  for (const legacy of [0, 1, 3, 5, 8, 10, 16, 20, 33, 45, 60, 79]) {
    effect.load({ properties: { algorithm: legacy } });
    const motion = effect.properties.motion.get();
    assert.ok(Number.isInteger(motion) && motion >= 0 && motion <= 8, `legacy ${legacy}`);
  }
});

test("datamosh: all donor looks are available and skip unnecessary motion search", () => {
  const effect = createDatamosh();
  assert.equal(effect.properties.algorithm.definition.items.length, 81);
  for (let look = 1; look <= 80; look += 1) {
    setProperties(effect, { algorithm: look, hold: 0.35, speed: 2 });
    const first = renderFrame(effect, 47);
    assert.equal(first.length, 1, "analytic looks only draw the warp pass");
    assert.equal(first[0].uniforms.algorithm, look);
    assertNoFeedback(first);
    renderFrame(effect, 3);
    assert.deepEqual(renderFrame(effect, 47), first);
  }
});

test("datamosh: current saved look indices survive a reload without shifting", () => {
  const effect = createDatamosh();
  effect.load({ properties: { algorithm: 43, interval: 40, hold: 0.2, speed: 1.5 } });
  assert.equal(effect.properties.algorithm.get(), 43);
  assert.equal(effect.properties.interval.get(), 40);
  assert.equal(effect.properties.hold.get(), 0.2);
  assert.equal(effect.properties.speed.get(), 1.5);
});

// --- VHS -------------------------------------------------------------------

test("vhs: trail requests use one-frame offsets and stay in the past", () => {
  const effect = createVhs();
  for (const persistence of [0, 0.25, 0.9]) {
    setProperties(effect, { persistence });
    for (let t = 0; t < 40; t += 1) {
      const request = effect._zoidiumFrameSampler.getRequest(effect, t);
      assert.equal(request.offsetFrames, -1);
      assert.ok(request.count >= 2 && request.count <= 10);
    }
  }
});

test("vhs: trails are disabled when the mix is zero", () => {
  const effect = createVhs();
  setProperties(effect, { amount: 0 });
  assert.equal(effect._zoidiumFrameSampler.getRequest(effect, 10).enabled, false);
  const draws = renderFrame(effect, 10);
  assert.equal(draws.some((draw) => draw.program === "materialAccumulate"), false);
});

test("vhs: same frame renders identically regardless of render history", () => {
  const fresh = renderFrame(createVhs(), 30);
  assert.ok(fresh.some((draw) => draw.program === "materialAccumulate"), "trail averaging runs");

  const used = createVhs();
  for (const frame of [5, 29, 31, 2, 77]) renderFrame(used, frame);
  assert.deepEqual(renderFrame(used, 30), fresh);

  const reversed = createVhs();
  for (let frame = 60; frame >= 30; frame -= 1) renderFrame(reversed, frame);
  assert.deepEqual(renderFrame(reversed, 30), fresh);
});

test("vhs: trails average source frames, never the previous output", () => {
  const effect = createVhs();
  const draws = renderFrame(effect, 30);
  const sampled = draws
    .filter((draw) => draw.program === "materialAccumulate")
    .map((draw) => draw.uniforms.tSample);
  assert.ok(sampled.every((name) => name.startsWith("source:")), "samples are source frames");
  assert.ok(sampled.length >= 2);
  const signal = draws.find((draw) => draw.program === "materialSignal");
  assert.equal(signal.uniforms.hasHistory, 1);
  assert.equal(signal.uniforms.tPrev, "trailTargets[" + ((sampled.length - 1) % 2) + "].texture");
});

test("vhs: clip-sized inputs retain their active pixel size through the signal and trail passes", () => {
  const effect = createVhs();
  effect.pass.uniforms.uvScale.value.set(0.5, 0.25);
  const draws = renderFrame(effect, 30, { width: 128, height: 192 });
  const signal = draws.find(draw => draw.program === "materialSignal");
  assert.deepEqual(signal.uniforms.resolution, [64, 48]);
  assert.deepEqual(signal.uniforms.uvScale, [0.5, 0.25]);
  assert.ok(draws.filter(draw => draw.program === "materialAccumulate")
    .every(draw => draw.uniforms.uvScale[0] === 0.5 && draw.uniforms.uvScale[1] === 0.25));
  assert.match(effect.pass.materialAccumulate.fragmentShader, /texture2D\(tBase, vUv \* uvScale\)/);
  assert.match(effect.pass.materialSignal.fragmentShader, /texture2D\(tPrev,.*\* uvScale\)/);
});

test("vhs: an unavailable sampler still renders the signal without a trail", () => {
  const effect = createVhs({ adjustmentLayer: false });
  const draws = renderFrame(effect, 30);
  assert.deepEqual(draws.map((draw) => draw.program), ["materialSignal", "materialTube"]);
  assert.equal(draws[0].uniforms.hasHistory, 0);
  assert.equal(draws[0].uniforms.tPrev, "source:30");
});

test("vhs: no pass reads a texture it did not write in the same call", () => {
  const effect = createVhs();
  for (let frame = 0; frame < 60; frame += 5) {
    assertNoFeedback(renderFrame(effect, frame));
  }
});

test("vhs: stateless signal still changes with time", () => {
  const effect = createVhs({ adjustmentLayer: false });
  const a = renderFrame(effect, 10)[0].uniforms.time;
  const b = renderFrame(effect, 11)[0].uniforms.time;
  assert.notEqual(a, b);
  assert.equal(renderFrame(effect, 10)[0].uniforms.time, a, "same time, same uniform");
});

// --- Shader contracts ------------------------------------------------------

test("shader uniforms match the JS uniform objects and braces balance", () => {
  const effects = {
    vhs: createVhs(),
    datamosh: createDatamosh(),
  };
  for (const [name, effect] of Object.entries(effects)) {
    renderFrame(effect, 50);
    const pass = effect.pass;
    for (const key of Object.keys(pass)) {
      const material = pass[key];
      if (!material || !material.fragmentShader) continue;
      const source = material.fragmentShader;
      assert.equal(source.split("{").length, source.split("}").length, `${name} ${key} braces`);
      assert.equal(source.split("(").length, source.split(")").length, `${name} ${key} parens`);
      const declared = [...source.matchAll(/uniform\s+\w+\s+(\w+)\s*;/g)].map((m) => m[1]);
      for (const uniform of declared) {
        assert.ok(uniform in material.uniforms, `${name} ${key} provides ${uniform}`);
      }
    }
  }
});


test("frame sampler effects restore the context dropped by CM3 layer.prepare", async () => {
  for (const type of ["vhs", "datamosh"]) {
    const sandbox = createSandbox();
    const effect = instantiate(sandbox, "plugins/openzoid-legacy/effects/" + type + ".js", type);
    const sequence = { properties: { rate: { get: () => 30 } } };
    effect.parentProject = { sequence };
    let received;
    sandbox.PZ.zoidium.temporal.prepareFrameSamples = async (_effect, frame, context) => {
      received = { frame, context };
    };
    await effect.prepare(17);
    assert.equal(received.frame, 17);
    assert.equal(received.context.sequence, sequence);
    const supplied = { sequence, export: true };
    await effect.prepare(18, supplied);
    assert.equal(received.context, supplied, "an export context is kept intact");
  }
});


test("datamosh: motion search stays bounded at 1080p and 4K with tiny blocks", () => {
  const effect = createDatamosh();
  setProperties(effect, { blockSize: 2, samples: 15 });
  for (const size of [{ width: 1920, height: 1080 }, { width: 3840, height: 2160 }]) {
    renderFrame(effect, 17, size);
    const grid = effect.pass.motionUniforms.blocks.value;
    assert.ok(grid.x <= 64 && grid.y <= 36);
    assert.equal(effect.pass.warpUniforms.searchBlockSize.value, effect.pass.motionUniforms.blockSize.value);
  }
});


test("datamosh: analytic donor looks request only their segment anchor", () => {
  const effect = createDatamosh();
  setProperties(effect, { algorithm: 43, interval: 30, samples: 15 });
  const request = effect._zoidiumFrameSampler.getRequest(effect, 47);
  assert.equal(request.count, 1);
  assert.equal(request.offsetFrames, -17);
});

test("new temporal damage effects use clip-local seconds and a numeric offset", () => {
  for (const make of [createDatamosh, createVhs]) {
    const effect = make();
    effect.parentProject = { sequence: { properties: { rate: { get: () => 24 } } } };
    assert.equal(effect.properties.time.definition.name, "Time Offset");
    assert.equal(effect.properties.time.definition.value, 0);
    effect.properties.time.set(0.5);
    effect.update(48);
    const uniforms = effect.pass.warpUniforms || effect.pass.signalUniforms;
    assert.equal(uniforms.time.value, 2.5);
    effect.update(24);
    assert.equal(uniforms.time.value, 1.5);
    effect.update(48);
    assert.equal(uniforms.time.value, 2.5);
  }
});

test("saved explicit clocks remain absolute and save their compatibility mode", () => {
  for (const make of [createDatamosh, createVhs]) {
    const effect = make();
    effect.load({ properties: { time: { value: 7, animated: true, expression: "time * 2" } } });
    effect.update(48);
    const uniforms = effect.pass.warpUniforms || effect.pass.signalUniforms;
    assert.equal(uniforms.time.value, 7);
    assert.equal(effect.properties.timeMode.get(), 0);
    effect.load({ properties: { time: 7, timeMode: 0 } });
    effect.update(90);
    assert.equal((effect.pass.warpUniforms || effect.pass.signalUniforms).time.value, 7);
  }
});

test("old default time expressions become offsets and new Datamosh defaults keep the donor intent", () => {
  for (const make of [createDatamosh, createVhs]) {
    const effect = make();
    effect.load({ properties: { time: { animated: true, expression: "time", keyframes: [] } } });
    assert.equal(effect.properties.time.get(), 0);
    assert.equal(effect.properties.time.expression, null);
    effect.update(60);
    assert.equal((effect.pass.warpUniforms || effect.pass.signalUniforms).time.value, 2);
  }
  const effect = createDatamosh();
  assert.equal(effect.properties.algorithm.get(), 12);
  assert.equal(effect.properties.hold.get(), 0.15);
  assert.equal(effect.properties.samples.get(), 4);
  const options = effect.properties.algorithm.definition.items;
  assert.equal(options.find(o => o.value === 12).name, "Random");
  assert.equal(new Set(options.map(o => o.value)).size, 81);
  assert.deepEqual([...new Set(options.map(o => o.group))], ["", "Motion", "Multiply", "Wave", "Random", "Average", "Mirror", "Sweep"]);
  assert.equal(createVhs().properties.persistence.definition.max, 1);
});

test("legacy expression-only clocks gain a numeric keyframe when their expression is removed", () => {
  for (const type of ["datamosh", "vhs"]) {
    const sandbox = createSandbox();
    sandbox.PZ.keyframe = class { constructor(value, frame) { Object.assign(this, { value, frame }); } };
    const effect = instantiate(sandbox, "plugins/openzoid-legacy/effects/" + type + ".js", type);
    effect.properties.time.keyframes = [];
    effect.load({ properties: { time: { expression: "time", animated: true, keyframes: [] } } });
    assert.equal(effect.properties.time.keyframes.length, 1);
    assert.equal(effect.properties.time.keyframes[0].value, 0);
    effect.update(30);
    assert.equal((effect.pass.warpUniforms || effect.pass.signalUniforms).time.value, 1);
    effect.load({ properties: { time: { expression: "time", animated: true,
      keyframes: [{ value: 7, frame: 10 }] } } });
    assert.equal(effect.properties.timeMode.get(), 0, "custom saved animation is preserved");
  }
});
