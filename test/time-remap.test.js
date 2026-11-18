"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const math = require("../plugins/native-fx/time-remap/math.js");
const temporal = require("../plugins/core/temporal-math.js");

// A dynamic CM3-like row: keyframes plus a linear get(frame). Tests edit the
// keyframe list in place to emulate a curve edit.
function property(value, options = {}) {
  const prop = {
    expression: options.expression ?? null,
    keyframes: options.keyframes || [{ frame: 0, value, tween: 1 }],
    get(frame = 0) {
      const keys = prop.keyframes;
      if (!keys.length) return undefined;
      if (keys.length === 1) return keys[0].value;
      const sorted = keys.slice().sort((a, b) => a.frame - b.frame);
      if (frame <= sorted[0].frame) return sorted[0].value;
      for (let index = 1; index < sorted.length; index += 1) {
        const next = sorted[index];
        if (frame > next.frame) continue;
        const previous = sorted[index - 1];
        const span = next.frame - previous.frame;
        if (!(span > 0)) return next.value;
        const ratio = (frame - previous.frame) / span;
        return previous.value + (next.value - previous.value) * ratio;
      }
      return sorted[sorted.length - 1].value;
    },
  };
  return prop;
}

function keyframe(frame, value, controlPoints = [[-10, 0], [10, 0]]) {
  return { frame, value, tween: 1, controlPoints };
}

// Loads the real effect source with the two plugin API contracts recorded on a
// fake effect instance. Lifecycle methods are not invoked, so no GPU state is
// needed.
function loadEffect(values = {}) {
  const effect = {
    _zoidiumGetAsset: () => undefined,
    parentLayer: { parentProject: { sequence: { properties: { rate: { get: () => 30 } } } } },
    properties: { load() {} },
  };
  const sandbox = {
    console,
    PZ: { property: { type: { OPTION: 6, NUMBER: 0 } }, layer: class {}, sequence: class {}, clip: class {} },
    THREE: {},
    ZoidiumPluginApis: {
      defineTemporal(spec) {
        effect.temporalSpec = spec;
        effect._zoidiumTemporal = { kind: spec.kind, getOperator: spec.getOperator };
      },
      defineFrameSampler(spec) {
        effect.samplerSpec = spec;
        effect._zoidiumFrameSampler = { getRequest: spec.getRequest };
      },
      installFrameSamplerContext() {},
      modules: {
        createRequire() {
          return id => require(path.join(path.resolve(__dirname, ".."), "plugins/native-fx/time-remap", id));
        },
      },
    },
  };
  sandbox.window = sandbox;
  const source = require("node:fs").readFileSync(
    path.join(__dirname, "..", "plugins/native-fx/effects/timeremap.js"), "utf8");
  vm.runInNewContext("(function () {\n" + source + "\n}).call(effect)", { ...sandbox, effect });
  const defaults = effect.temporalSpec.properties;
  effect.properties = Object.fromEntries(Object.entries(defaults).map(([name, definition]) => {
    const override = values[name];
    if (override && typeof override.get === "function") return [name, override];
    return [name, property(override === undefined ? definition.value : override)];
  }));
  return effect;
}

function operator(effect, frame = 0) {
  return effect._zoidiumTemporal.getOperator(effect, frame);
}

test("constant speed integrates to a fraction of the output clock", () => {
  const speed = property(50);
  const mapper = math.speedMap(speed, { cache: { signature: null, prefix: [0] } });
  assert.equal(mapper.map(10), 5);
  assert.equal(mapper.map(0.5), 0.25);
  assert.equal(mapper.map(0), 0);
});

test("a 100 percent speed map is exactly the input frame", () => {
  for (const propertyValue of [property(100), property(100, { keyframes: [keyframe(0, 100)] })]) {
    const mapper = math.speedMap(propertyValue);
    for (const frame of [0, 1, 7.25, 11, 240]) assert.equal(mapper.map(frame), frame);
  }
  assert.equal(math.speedMap(property(100)).constant, 100);
});

test("zero and negative speeds integrate without playback history", () => {
  const freeze = math.speedMap(property(0), { cache: { signature: null, prefix: [0] } });
  assert.deepEqual([0, 1, 40].map(frame => freeze.map(frame)), [0, 0, 0]);
  const reverse = math.speedMap(property(-50), { cache: { signature: null, prefix: [0] } });
  assert.equal(reverse.map(10), -5);
  // The host clamps an operator result to the clip range, so reverse from the
  // start holds the first frame.
  assert.equal(temporal.applyTemporalOperators(10, 30,
    [{ kind: "time-remap", enabled: true, map: reverse.map }], 100), 0);
});

test("a speed ramp integrates the area under the curve", () => {
  // Linear ramp 0 -> 100 percent over 20 frames: source(20) = 20 * 50 / 100.
  const ramp = property(0, { keyframes: [keyframe(0, 0), keyframe(20, 100)] });
  const cache = { signature: null, prefix: [0] };
  const mapper = math.speedMap(ramp, { cache });
  assert.ok(Math.abs(mapper.map(20) - 10) < 1e-6);
  assert.ok(Math.abs(mapper.map(10) - 2.5) < 1e-6);
  // Analytic check of the same curve through the raw integrator.
  const area = math.integrateSpeed(frame => 5 * frame, 20, null, "analytic");
  assert.ok(Math.abs(area - (5 * 20 * 20) / 2 / 100) < 0.2);
});

test("keyframe edits invalidate the cached prefix", () => {
  const speed = property(0, { keyframes: [keyframe(0, 100), keyframe(20, 0)] });
  const effect = loadEffect({ speed });
  const before = operator(effect, 20).map(20);
  assert.ok(Math.abs(before - 10) < 1e-6);

  effect.properties.speed.keyframes = [keyframe(0, 200), keyframe(20, 200)];
  const signature = math.propertySignature(effect.properties.speed);
  assert.notEqual(signature, "stale");
  const after = operator(effect, 20).map(20);
  assert.ok(Math.abs(after - 40) < 1e-6, "edited curve must re-integrate");
  assert.notEqual(after, before);
});

test("curve handle edits change the signature even at equal values", () => {
  const speed = property(0, { keyframes: [keyframe(0, 100), keyframe(10, 100)] });
  const first = math.propertySignature(speed);
  speed.keyframes[1].controlPoints = [[-5, 3], [5, -3]];
  const second = math.propertySignature(speed);
  assert.notEqual(first, second);
});

test("mapping does not depend on request order and repeated calls match", () => {
  const speed = property(0, { keyframes: [keyframe(0, 120), keyframe(9, 20), keyframe(18, 90)] });
  const effect = loadEffect({ speed });
  const forward = [0, 3, 17, 31].map(frame => operator(effect, frame).map(frame));
  const reverse = [31, 17, 3, 0].map(frame => operator(effect, frame).map(frame)).reverse();
  assert.deepEqual(reverse, forward);
  const warm = operator(effect, 17).map(17);
  assert.equal(warm, operator(effect, 17).map(17));
});

test("remap mode reads the keyed source time at the output frame", () => {
  const effect = loadEffect({ mode: 1, remap: 1, sourceTime: 2.5 });
  const op = operator(effect, 40);
  assert.equal(op.kind, "time-remap");
  assert.equal(op.map(0), 75);
  assert.equal(op.map(400), 75);
  assert.equal(temporal.applyTemporalOperators(12, 30, [op], 100), 75);
});

test("a static remap freezes and a remap starts disabled", () => {
  const frozen = loadEffect({ mode: 1, remap: 1, sourceTime: 1 });
  assert.deepEqual([0, 10, 50].map(frame => operator(frozen, frame).map(frame)), [30, 30, 30]);

  const disabled = loadEffect({ mode: 1, remap: 0, sourceTime: 1 });
  assert.equal(operator(disabled, 10), null);
});

test("identity defaults add no operator and no sampler request", () => {
  const effect = loadEffect();
  for (const frame of [0, 1, 30]) assert.equal(operator(effect, frame), null);
  const request = effect._zoidiumFrameSampler.getRequest(effect, 12);
  assert.equal(request.enabled, false);
  // Disabled and remap-mode defaults also stay identity.
  assert.equal(operator(loadEffect({ enabled: 0 }), 4), null);
});

test("frame mix requests the two neighbouring source frames", () => {
  const effect = loadEffect({ blend: 1 });
  const request = effect._zoidiumFrameSampler.getRequest(effect, 10.25);
  assert.equal(request.enabled, true);
  assert.equal(request.preserveInputRGB, true);
  assert.equal(request.frames.length, 2);
  assert.ok(Math.abs(request.frames[0] - -0.25) < 1e-9);
  assert.ok(Math.abs(request.frames[1] - 0.75) < 1e-9);
  assert.ok(Math.abs(effect._zoidiumTimeRemapTaps.mix - 0.25) < 1e-9);
  assert.equal(math.blendTaps(10.25).lower, 10);
  assert.equal(math.blendTaps(10.25).upper, 11);

  // Integer source times need no blend, and off keeps the nearest frame.
  assert.equal(effect._zoidiumFrameSampler.getRequest(effect, 12).enabled, false);
  const off = loadEffect({ blend: 0 });
  assert.equal(off._zoidiumFrameSampler.getRequest(off, 10.25).enabled, false);
});

test("the reserved blend slot falls back to frame mix without an interpolator", () => {
  const effect = loadEffect({ blend: 2 });
  const request = effect._zoidiumFrameSampler.getRequest(effect, 4.5);
  assert.equal(request.enabled, true);
  assert.equal(request.frames.length, 2);
  const interpolate = require("../plugins/native-fx/time-remap/interpolate.js");
  const release = interpolate.register(() => ({ frames: [-0.5, 0.5], weights: [1, 3] }));
  try {
    const planned = effect._zoidiumFrameSampler.getRequest(effect, 4.5);
    assert.deepEqual(planned.frames, [-0.5, 0.5]);
    assert.ok(Math.abs(effect._zoidiumTimeRemapTaps.mix - 0.75) < 1e-9);
  } finally {
    release();
  }
});

test("sampler taps do not replay a remap operator", () => {
  const remap = { kind: "time-remap", enabled: true, map: frame => frame / 2 };
  const posterize = { kind: "posterize-time", enabled: true, fps: 12 };
  // The tap clock is already the remapped clock; only the quantizer replays.
  assert.equal(temporal.mapFrameSamplerInputFrame(11, 30, [remap, posterize], 100), 10);
  // Without a quantizer the tap clock is unchanged.
  assert.equal(temporal.mapFrameSamplerInputFrame(11, 30, [remap], 100), 11);
  // Time Offset keeps its rebase, so an offset-only prefix is not added twice.
  assert.equal(temporal.mapFrameSamplerInputFrame(11, 30,
    [{ kind: "time-offset", enabled: true, offsetFrames: 4 }, posterize], 100), 10);
});

test("operators apply in serialized order with the remap input", () => {
  const mapper = math.speedMap(property(50), { cache: { signature: null, prefix: [0] } });
  assert.equal(temporal.applyTemporalOperators(4, 30,
    [{ kind: "time-offset", enabled: true, offsetFrames: 2 },
      { kind: "time-remap", enabled: true, map: mapper.map }], 100), 3);
  assert.equal(temporal.applyTemporalOperators(4, 30,
    [{ kind: "time-remap", enabled: true, map: mapper.map },
      { kind: "time-offset", enabled: true, offsetFrames: 2 }], 100), 4);
  // A throwing or non-finite mapper keeps the previous clock.
  assert.equal(temporal.applyTemporalOperators(4, 30,
    [{ kind: "time-remap", enabled: true, map: () => NaN }], 100), 4);
});

test("the host maps lower tracks through an adjustment remap", () => {
  const { host } = require("./helpers/temporal-sampler-host.cjs");
  const h = host(true);
  const remap = {
    update() {},
    _zoidiumTemporal: {
      getOperator: () => ({
        kind: "time-remap",
        enabled: true,
        map: (frame, anchor) => anchor + (frame - anchor) / 2,
      }),
    },
  };
  h.owner.effects = [remap];
  // A new track array invalidates the structural cache after the edit.
  h.sequence.videoTracks = h.sequence.videoTracks.slice();
  // Source clip starts at 10, adjustment clip at 5: local 10 is project 20,
  // adjustment local 15. Half speed from the adjustment start (5) reads
  // project 12.5, which is source local 2.5.
  const mapped = h.state.mapLayerFrame(h.source, 10);
  assert.equal(mapped.sourceFrame, 2.5);
  assert.equal(mapped.projectFrame, 12.5);

  remap._zoidiumTemporal.getOperator = () => ({
    kind: "time-remap", enabled: true, map: frame => frame,
  });
  h.sequence.videoTracks = h.sequence.videoTracks.slice();
  const identity = h.state.mapLayerFrame(h.source, 10);
  assert.equal(identity.sourceFrame, 10);
});

