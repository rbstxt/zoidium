"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs");
const { nativeHost, host: expressionHost, core } = require("./expressions-plus-harness.js");
const { KINDS, MAX_TIME_SAMPLES } = require("../plugins/shader-plus/kinds.js");
const { GUARD, readSamples } = require("../plugins/shader-plus/time-samples.js");
const { installRuntime } = require("../plugins/shader-plus/runtime.js");
const { forHost } = require("../plugins/core/shader-pipeline.js");
const source = "precision highp float;\nuniform sampler2D Past; varying vec2 vUvScaled; void main(){gl_FragColor=texture2D(Past,vUvScaled);}";
function setup() {
  const host = nativeHost(), { PZ, THREE, patch } = host, dispose = [];
  let releases = 0, prepares = 0, samples = [{ texture: { sampled: true } }];
  const sequence = { properties: { rate: { get: () => 30 } } };
  PZ.zoidium = { temporal: {
    releaseFrameSamplerTargets() { releases++; },
    async prepareFrameSamples() { prepares++; },
    resolveFrameSamples() { return samples; },
  } };
  const pipeline = forHost(PZ, patch);
  const runtime = installRuntime({ PZ, THREE, patch, pipeline, onDispose: fn => dispose.push(fn), curves: {}, doc: {}, editor: () => null, presetFont: () => null });
  async function effect(properties = [record(-1)], shader = source) {
    const fx = new PZ.effect.shader();
    Object.defineProperty(fx, "parentProject", { value: { sequence } });
    Object.defineProperty(fx, "parentLayer", { value: { properties: { resolution: { get: () => [320, 180] } } } });
    await fx.load({ type: 1, properties: { fragShader: shader }, customProperties: properties });
    fx.update(10);
    return fx;
  }
  return { ...host, effect, pipeline, runtime, get releases() { return releases; }, get prepares() { return prepares; },
    setSamples(value) { samples = value; }, dispose() { runtime.disposeAll(); for (const fn of dispose.reverse()) fn(); } };
}
function record(value, name = "Past", units = "frames") {
  const type = KINDS.timeSample.create(); type.zoidiumShader.units = units;
  return { type, properties: { name }, keyframes: [{ frame: 0, value, tween: 1 }] };
}
const needsCache = { skip: !fs.existsSync(core) };
test("time samples retain native keys and bind sampler uniforms, including seconds", needsCache, async () => {
  const h = setup();
  try {
    const r = record(-1); r.animated = true; r.keyframes.push({ frame: 20, value: 1, tween: 1 });
    const fx = await h.effect([r, record(0.5, "Future", "seconds")]);
    assert.equal(fx.customProperties[0].get(5), -0.5);
    assert.equal(fx.pass.uniforms.Past.type, "t");
    for (const frame of [5, 15, 5, 10]) {
      const request = fx._zoidiumFrameSampler.getRequest(fx, frame);
      assert.deepEqual(request.frames, frame === 10 ? [15] : [frame / 10 - 1, 15]);
      assert.equal(request.preserveInputRGB, true);
    }
    assert.equal(MAX_TIME_SAMPLES, 4);
    await fx.prepare(10); assert.equal(h.prepares, 1);
  } finally { h.dispose(); }
});
test("zero sample binds the exact input object and nonzero uses only resolved textures", needsCache, async () => {
  const h = setup();
  try {
    const fx = await h.effect([record(0), record(-1, "Other")]);
    let observed;
    const livePass = fx.pass;
    // A new pass exercises the host's material reload path.
    fx.pass = { ...livePass, render() { observed = [this.uniforms.Past.value, this.uniforms.Other.value]; } };
    fx.update(10);
    const input = { texture: { current: true } }, sample = { sampled: true };
    h.setSamples([{ texture: sample }]);
    fx.pass.render({}, {}, input);
    assert.equal(observed[0], input.texture); assert.equal(observed[1], sample);
    h.setSamples([]);
    assert.throws(() => fx.pass.render({}, {}, input), /Time sample input is unavailable/);
  } finally { h.dispose(); }
});
test("saved time samples reopen with keys and metadata, with an older-build compile guard", needsCache, async () => {
  const h = setup();
  try {
    const fx = await h.effect([record(-0.1, "Past", "seconds")]);
    const saved = JSON.parse(JSON.stringify(fx));
    assert.ok(saved.properties.fragShader.startsWith(GUARD));
    assert.equal(fx.properties.fragShader.get(), source);
    const reopened = await h.effect(saved.customProperties, saved.properties.fragShader);
    assert.equal(reopened.properties.fragShader.get(), source);
    assert.equal(readSamples(reopened, 10)[0].offset, -3);
    assert.deepEqual(JSON.parse(JSON.stringify(reopened)), saved);
    // Older native compilers see the literal #error rather than a NUMBER
    // silently replacing the authored texture. New builds define its guard.
    assert.equal(fx.pass.material.defines.ZOIDIUM_TIME_SAMPLES, 1);
    assert.match(saved.properties.fragShader, /#error Shader\+ Time sample requires Shader\+ v24/);
  } finally { h.dispose(); }
});
test("fifth sample and nonfinite offsets refuse rendering and export with clear errors", needsCache, async () => {
  const h = setup();
  try {
    const fx = await h.effect();
    fx.customProperties[0].get = () => Infinity;
    let message; fx.onShaderError.watch(value => { message = value; });
    fx.update(10); assert.equal(fx.pass.enabled, false); assert.match(message, /finite/);
    await assert.rejects(fx.prepare(10), /finite/);
    fx.customProperties[0].get = () => -1;
    for (let i = 1; i < 5; i++) {
      const r = record(i, "Sample" + i), p = h.PZ.property.create(r.type); fx.customProperties.push(p); p.load(r);
    }
    fx.update(10); assert.match(message, /at most four/);
    await assert.rejects(fx.prepare(10), /at most four/);
  } finally { h.dispose(); }
});
test("50 add-remove cycles release samplers, restore the pass, and leave ordinary shaders alone", needsCache, async () => {
  const h = setup();
  try {
    const fx = await h.effect([], "void main(){gl_FragColor=vec4(1.0);}"), render = fx.pass.render;
    assert.equal(fx._zoidiumFrameSampler, undefined);
    const baseline = JSON.stringify(fx);
    for (let i = 0; i < 50; i++) {
      const r = record(-1), p = h.PZ.property.create(r.type); fx.customProperties.push(p); p.load(r);
      fx.update(10); assert.ok(fx._zoidiumFrameSampler);
      fx.customProperties.splice(fx.customProperties.indexOf(p), 1);
      assert.equal(fx._zoidiumFrameSampler, undefined); assert.equal(fx.pass.render, render);
    }
    assert.ok(h.releases >= 50);
    assert.equal(JSON.stringify(fx), baseline);
  } finally { h.dispose(); }
});
test("procedural extrapolation is opt-in and existing explicit requests keep their clip bounds", async () => {
  const { host } = require("./helpers/temporal-sampler-host.cjs");
  for (const extrapolate of [false, true]) {
    const h = host(false); h.sequence.videoSchedules = [];
    h.effect._zoidiumFrameSampler.getRequest = () => ({ frames: [-5, 100], extrapolate });
    await h.effect.prepare(2, { sequence: h.sequence });
    const samples = h.state.frameSamplerRuntimes.get(h.root).prepared.get(h.effect).samples;
    assert.deepEqual(Array.from(samples, p => p.frame - h.ownerClip.start), extrapolate ? [-3, 102] : [0, 100 - 1e-9]);
  }
});
test("Time sample offsets evaluate Expressions+ without render history", needsCache, () => {
  const h = expressionHost();
  const clip = Object.create(h.PZ.clip.prototype);
  Object.assign(clip, { start: 0, properties: { time: { get: frame => frame / 30 } } });
  h.owner.parent.parent = clip;
  const definition = KINDS.timeSample.create(), p = h.PZ.property.create(definition);
  p.load(record(-1));
  p.parent = h.owner.properties;
  p.expression = new h.PZ.expression("Math.floor(Math.sin(time * 12) * 3)");
  const fx = { customProperties: [p], parentProject: { sequence: { properties: { rate: { get: () => 30 } } } }, fixPropertyName: n => n };
  const forward = [0, 11, 37, 59].map(frame => readSamples(fx, frame)[0].offset);
  for (const [index, frame] of [0, 11, 37, 59].entries()) {
    assert.equal(forward[index], Math.floor(Math.sin(frame / 30 * 12) * 3));
    assert.equal(h.engine.error(p), null);
  }
  for (const frame of [59, 11, 0, 37, 11]) assert.equal(readSamples(fx, frame)[0].offset, forward[[0, 11, 37, 59].indexOf(frame)]);
});
test("Time sample serialization requires Shader+ for cache classification", () => {
  const vm = require("node:vm"), sandbox = vm.createContext({ window: {}, PZ: {} });
  for (const file of ["zoidium/plugin-manager-state.js", "zoidium/plugin-manager-scanners.js"]) vm.runInContext(fs.readFileSync(file, "utf8"), sandbox);
  const scan = sandbox.window.ZoidiumPluginManagerInternals.projectPluginRequirements;
  const found = JSON.parse(JSON.stringify(scan({ customProperties: [record(-1)] })));
  assert.equal(found.length, 1); assert.equal(found[0].id, "shader-plus");
  assert.deepEqual(found[0].features, ["shader-properties"]);
  assert.deepEqual(JSON.parse(JSON.stringify(scan({ customProperties: [{ type: KINDS.slider.create() }] }))), []);
});
test("effect unload releases time samples and stale preparation cannot recreate them", needsCache, async () => {
  const h = setup();
  try {
    const fx = await h.effect(); await fx.prepare(10);
    const prepares = h.prepares;
    fx.unload(); assert.equal(fx._zoidiumFrameSampler, undefined);
    assert.ok(h.releases > 0);
    await fx.prepare(10); fx.update(10);
    assert.equal(h.prepares, prepares); assert.equal(fx._zoidiumFrameSampler, undefined);
  } finally { h.dispose(); }
});
