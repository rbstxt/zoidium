"use strict";
// Keyframe data in Shader+ uniforms through Expressions+.
//
// Shader+ Slider and Point controls are native dynamic properties, so an
// expression on the control evaluates per frame and the native Custom Shader
// update binds the evaluated value into the uniform. Shader+ runtime.js only
// touches texture kinds; NUMBER and VECTOR2 uniforms keep native binding.
// These tests prove the working path: velocity, speed and valueAtTime reach
// the uniform the shader sends, deterministically as a pure function of frame.
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
const { createAPI } = require("../plugins/expressions-plus/api");
const { host, core } = require("./expressions-plus-harness.js");
const { KINDS } = require("../plugins/shader-plus/kinds.js");
const { installRuntime } = require("../plugins/shader-plus/runtime.js");
const { forHost } = require("../plugins/core/shader-pipeline.js");

function near(actual, expected, tolerance = 1e-9) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `expected ${actual} near ${expected}`);
}

// Cross-layer addressing, units and frameDuration without the CM3 runtime.
test("expression handles address another layer in seconds with frameDuration", () => {
  class Sequence {} class Clip {} class Layer {} class PropertyList {}
  const PZ = { sequence: Sequence, clip: Clip, layer: Layer, propertyList: PropertyList };
  const p = (name, value) => ({ definition: { name }, get: () => value });
  // Ball position moves 300 units/s on X and 60 units/s on Y in local frames.
  const linear = f => [f * 10, f * 2];
  const sequence = Object.assign(new Sequence(), { properties: { rate: p("Frame rate", 30) }, videoTracks: [] });
  const clip = Object.assign(new Clip(), { parent: sequence, start: 10, length: 100, properties: { time: p("Time", 1) } });
  const ball = Object.assign(new Layer(), { parent: clip, properties: { name: p("Name", "Ball"), Position: { get: linear } }, effects: [], objects: [] });
  ball.properties.Position.parent = ball;
  clip.object = ball;
  sequence.videoTracks.push({ clips: [clip], getCurrentClip: () => clip });
  const owner = Object.assign(new Layer(), { parent: clip, properties: { name: p("Name", "Shader") }, effects: [], objects: [] });
  const { api } = createAPI({ PZ, owner, property: p("Vel", 0), frame: 25, time: 0.5, base: 0, read: (q, f) => q.get(f), baseAt: (q, f) => linear(f), methods: {} });
  assert.equal(api.thisComp.frameDuration, 1 / 30);
  const velocity = api.thisComp.layer("Ball").property("Position").velocity;
  near(velocity[0], 300); near(velocity[1], 60);
  // valueAtTime takes seconds and converts the absolute sequence frame to
  // the target clip's local frame: 0.5s is local frame 15 at 30fps.
  assert.deepEqual(api.thisComp.layer("Ball").property("Position").valueAtTime(0.5), linear(15));
  const now = api.thisComp.layer("Ball").property("Position").valueAtTime(0.5);
  const past = api.thisComp.layer("Ball").property("Position").valueAtTime(0.5 - api.thisComp.frameDuration);
  assert.deepEqual(past, linear(14));
  assert.deepEqual(now.map((v, i) => (v - past[i]) * 30), [300, 60]);
});

function shaderHost() {
  const h = host(), { PZ, THREE } = h;
  const pipeline = forHost(PZ, (holder, key, make) => { const original = holder[key]; holder[key] = make(original); });
  const restore = [];
  const patch = (holder, key, make) => { const original = holder[key]; restore.push(() => { holder[key] = original; }); holder[key] = make(original); };
  const runtime = installRuntime({ PZ, THREE, pipeline, onDispose: fn => restore.push(fn), doc: {}, curves: {}, editor: () => null, presetFont: () => null, patch });
  return { ...h, dispose: () => { runtime.disposeAll(); for (const fn of restore.reverse()) fn(); } };
}

// A live Custom Shader effect whose custom properties are the expression
// inputs. Parents are set the way the editor sets them so parentObject
// resolves to the effect; parentLayer is stubbed for native update.
function shaderEffect(PZ, build) {
  const holder = new PZ.object();
  const fx = Object.assign(Object.create(PZ.effect.shader.prototype), { parent: holder });
  Object.defineProperty(fx, "parentLayer", { value: { properties: { resolution: { get: () => [320, 180] } } } });
  fx.customProperties = new PZ.objectList(fx, PZ.property);
  const source = build(fx);
  fx.properties = { enabled: { get: () => true }, fragShader: { get: () => source } };
  fx.textures = new Map(); fx.pass = { uniforms: {}, material: { defines: {} } };
  fx.onShaderError = { update(message) { throw new Error(message); } };
  return fx;
}

// PZ.keyframe takes (value, frame). Pairs below are [frame, value].
function addScalar(PZ, fx, name, pairs) {
  const definition = { custom: true, dynamic: true, type: 0, value: 0 };
  const property = PZ.property.create(definition);
  property.load({ type: definition, properties: { name }, keyframes: pairs.map(([frame, value]) => ({ frame, value, tween: 1 })) });
  property.parent = fx.customProperties; fx.customProperties.push(property);
  return property;
}

function addPoint(PZ, fx, name, xPairs, yPairs) {
  const definition = KINDS.point.create();
  const property = PZ.property.create(definition);
  property.load({ type: definition, properties: { name } });
  property.parent = fx.customProperties; fx.customProperties.push(property);
  const key = ([frame, value]) => new PZ.keyframe(value, frame);
  xPairs.forEach(pair => property.objects[0].addKeyframe(key(pair)));
  yPairs.forEach(pair => property.objects[1].addKeyframe(key(pair)));
  return property;
}

const byName = (fx, name) => fx.customProperties.find(p => p.properties.name.get() === name);

test("Shader+ slider reads velocity and reaches its uniform per frame", { skip: !fs.existsSync(core) }, () => {
  const { PZ, engine, dispose } = shaderHost();
  try {
    // Ease the middle key so velocity changes per frame; a cached uniform
    // would fail the per-frame asserts.
    const fx = shaderEffect(PZ, fx => {
      addScalar(PZ, fx, "Source", [[0, 0], [15, 5], [30, 30]]);
      const vel = addScalar(PZ, fx, "Vel", [[0, 0]]);
      vel.expression = new PZ.expression('thisObject.property("Source").velocity');
      return "precision highp float;\nuniform float Vel;\nvoid main(){gl_FragColor = vec4(Vel, 0.0, 0.0, 1.0);}";
    });
    const vel = byName(fx, "Vel");
    assert.equal(engine.error(vel), null);
    // Per-second units: 5 units over 15 frames at 30fps is 10 units/s.
    near(vel.get(7), 10); near(vel.get(22), 50);
    // Deterministic: repeated and out-of-order reads agree.
    near(vel.get(22), 50); near(vel.get(7), 10); near(vel.get(7), vel.get(7));
    fx.fragmentShaderNeedsUpdate = true; fx.update(7);
    near(fx.pass.uniforms.Vel.value, vel.get(7)); near(fx.pass.uniforms.Vel.value, 10);
    fx.update(22);
    near(fx.pass.uniforms.Vel.value, vel.get(22)); near(fx.pass.uniforms.Vel.value, 50);
    assert.notEqual(fx.pass.uniforms.Vel.value, 10, "uniform follows the frame instead of caching");
  } finally { dispose(); }
});

test("Shader+ Point reads vector velocity and speed without aliasing", { skip: !fs.existsSync(core) }, () => {
  const { PZ, engine, dispose } = shaderHost();
  try {
    const fx = shaderEffect(PZ, fx => {
      addPoint(PZ, fx, "Pos", [[0, 0], [30, 300]], [[0, 0], [30, 60]]);
      const vector = addPoint(PZ, fx, "Motion", [[0, 0]], [[0, 0]]);
      // A Point group holds one vector expression; the aliased native scratch
      // array used to collapse every cross-property velocity to [0, 0].
      vector.expression = new PZ.expression('thisObject.property("Pos").velocity');
      const speed = addScalar(PZ, fx, "Speed", [[0, 0]]);
      speed.expression = new PZ.expression('thisObject.property("Pos").speed');
      return "precision highp float;\nuniform vec2 Motion;\nvoid main(){gl_FragColor = vec4(Motion, 0.0, 1.0);}";
    });
    const vector = byName(fx, "Motion"), speed = byName(fx, "Speed");
    assert.equal(engine.error(vector), null); assert.equal(engine.error(speed), null);
    for (const frame of [5, 15, 25]) {
      assert.deepEqual(vector.get(frame).map(Math.round), [300, 60]);
      near(speed.get(frame), Math.hypot(300, 60), 1e-6);
    }
    fx.fragmentShaderNeedsUpdate = true; fx.update(15);
    near(fx.pass.uniforms.Motion.value.x, 300); near(fx.pass.uniforms.Motion.value.y, 60);
  } finally { dispose(); }
});

test("Shader+ valueAtTime samples seconds and matches velocity", { skip: !fs.existsSync(core) }, () => {
  const { PZ, engine, dispose } = shaderHost();
  try {
    const fx = shaderEffect(PZ, fx => {
      addScalar(PZ, fx, "Source", [[0, 0], [30, 30]]);
      const now = addScalar(PZ, fx, "Now", [[0, 0]]);
      now.expression = new PZ.expression('thisObject.property("Source").valueAtTime(0.5)');
      const past = addScalar(PZ, fx, "Past", [[0, 0]]);
      past.expression = new PZ.expression('thisObject.property("Source").valueAtTime(0.5 - 1 / 30)');
      return "precision highp float;\nuniform float Now;\nvoid main(){gl_FragColor = vec4(Now, 0.0, 0.0, 1.0);}";
    });
    assert.equal(engine.error(byName(fx, "Now")), null); assert.equal(engine.error(byName(fx, "Past")), null);
    // No clip in this host, so time is 0 and seconds are literal: 0.5s is
    // frame 15 at 30fps, one frame earlier is frame 14.
    near(byName(fx, "Now").get(7), 15); near(byName(fx, "Past").get(7), 14);
    near((byName(fx, "Now").get(7) - byName(fx, "Past").get(7)) * 30, 30);
  } finally { dispose(); }
});
