"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const D = require("../plugins/expresstext-plus/expresstext-delay.js");
const C = require("../plugins/expresstext-plus/expresstext-delay-cache.js");
const { staticProps } = require("../plugins/expresstext-plus/expresstext-eval.js");
const { state } = require("../plugins/expresstext-plus/expresstext-constants.js");
const { EFFECTOR_BUILDERS } = require("../plugins/expresstext-plus/expresstext-properties.js");
const { nativeHost } = require("./expressions-plus-harness.js");
const { referenceStack } = require("./expresstext-plus-delay-reference.js");
const plugin = require("../plugins/expresstext-plus/expresstext.js");

function equalNumbers(actual, expected) {
  for (const key of ["position", "rotation", "scale"]) for (let axis = 0; axis < 3; axis++) {
    assert.ok(Object.is(actual[key][axis], expected[key][axis]),
      `${key}[${axis}]: ${actual[key][axis]} != ${expected[key][axis]}`);
  }
  assert.equal(actual.eulerOrder, expected.eulerOrder);
}

function fixture(PZ, mode = 0, stacked = false) {
  const layer = (kind, values) => {
    const props = new PZ.propertyList(EFFECTOR_BUILDERS[kind](PZ), new PZ.object());
    props.load();
    for (const [key, value] of Object.entries(values)) props[key].set(value, 0);
    return { kind, props };
  };
  const plain = layer("plain", { plainPosition: [2, -3, 1], plainDelay: 1.25 });
  for (let axis = 0; axis < 3; axis++) {
    const track = plain.props.plainPosition.objects[axis];
    track.animated = true;
    track.keyframes.push(new PZ.keyframe(12 * (axis + 1), 24, 1));
    track.keyframes.push(new PZ.keyframe(-7 * (axis + 1), 7600, 3));
  }
  const layers = [plain,
    layer("formula", { formulaExpression: "sin(t*90)+u+px/10", formulaPosition: [1, 2, 3] }),
    layer("random", { randomMode: 2, randomAnimationSpeed: 70, randomStrength: 12 }),
    layer("spline", { splineMode: 2, splineStrength: 18, splinePath: 2 }),
    layer("orbit", { orbitAngle: [0.1, 0.2, 0.3], orbitStrength: 24 }),
    layer("delay", { delayMode: mode, delayStrength: 84 })];
  if (stacked) layers.push(layer("delay", { delayMode: (mode + 1) % 3, delayStrength: 62 }));
  const list = { order: [0, 1, 2], total: 3 }, base = [-4, 1, 0];
  const aux = { extent: { lo: -4, hi: 8 }, bases: [[-4, 1, 0], [2, 0, 0], [8, 1, 1]],
    selfWorld: { position: [1, 2, 3], rotation: [0.1, 0.2, 0.3], scale: [1, 1, 1], eulerOrder: "XYZ" } };
  const container = staticProps({ rotationOrder: "YZX" });
  return { layers, list, base, aux, container, index: 1 };
}
function evaluate(f, frame, fn = D.evaluateStack) {
  return fn(f.layers, f.container, frame, f.index, f.list, f.base, f.aux);
}
function setup(t) {
  const { PZ } = nativeHost(); state.PZ = PZ; C.clearDelayCache();
  t.after(() => { state.PZ = null; C.clearDelayCache(); });
  return PZ;
}

test("Delay caches every mode and stacked stage with Object.is equality to the original traversal", t => {
  const PZ = setup(t);
  let seed = 8921;
  const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  for (let mode = 0; mode < 3; mode++) for (const stacked of [false, true]) {
    const f = fixture(PZ, mode, stacked);
    // Random values and end frames change the whole-window Even travel.
    f.layers[2].props.randomSeed.set(random() * 10, 0);
    f.layers[0].props.plainStrength.set(random() * 160, 0);
    assert.ok(C.delayCacheFor(f.layers, f.index, f.list, f.base, f.aux));
    const frames = [-2, 0, 0.25, 30, 30 + 5e-10, 30 + 2e-9, 7301.25, 7517.75, random() * 100];
    for (const frame of frames) {
      C.clearDelayCache();
      const cold = evaluate(f, frame);
      const original = evaluate(f, frame, referenceStack);
      equalNumbers(cold, original);
      for (const other of [frame + 1.5, 4, 7302, frame - 1]) evaluate(f, other);
      equalNumbers(evaluate(f, frame), original);
    }
  }
});

test("animated Delay parameters, bypasses and three-stage stacks retain exact values", t => {
  const PZ = setup(t), f = fixture(PZ, 2, true);
  const extra = new PZ.propertyList(EFFECTOR_BUILDERS.delay(PZ), new PZ.object()); extra.load();
  f.layers.push({ kind: "delay", props: extra });
  const delay = f.layers.find(l => l.kind === "delay").props;
  for (const [key, value] of [["delayStrength", 0], ["delayMode", 1], ["delayPosition", 0], ["delayEnable", 0]]) {
    delay[key].animated = true;
    delay[key].keyframes.push(new PZ.keyframe(value, 20, 0));
    delay[key].keyframes.push(new PZ.keyframe(key === "delayStrength" ? 74 : 1, 35, 1));
  }
  for (const frame of [19.5, 20, 35.75, 7300.5]) {
    const original = evaluate(f, frame, referenceStack);
    C.clearDelayCache(); equalNumbers(evaluate(f, frame), original);
    for (const other of [7302, 10, frame - 1]) evaluate(f, other);
    equalNumbers(evaluate(f, frame), original);
  }
});

test("Delay invalidates edits, text layout, stack order, enable, selections, and host expressions", t => {
  const PZ = setup(t), f = fixture(PZ, 0, true);
  const edits = [
    () => { f.layers[0].props.plainPosition.objects[0].keyframes[1].value = 150; },
    () => { f.layers[0].props.plainPosition.objects[0].keyframes[1].frame = 19; },
    () => { f.layers[0].props.plainPosition.objects[1].keyframes[1].tween = 2; },
    () => { f.layers[0].props.plainPosition.objects[2].keyframes[1].tween = 257;
      f.layers[0].props.plainPosition.objects[2].keyframes[1].controlPoints[0][1] = 18; },
    () => { f.list.order.reverse(); f.list.total = 4; f.list.order.push(3); f.aux.bases.push([20, 0, 0]); },
    () => { f.base[0] = 2; f.aux.extent.hi = 20; f.aux.bases[0][1] = 10; },
    () => { f.aux.selfWorld.rotation[1] = 0.7; f.aux.selfWorld.scale[1] = 2; },
    () => { f.layers[2].props.randomEnable.set(0, 0); },
    () => { f.layers[1].props.formulaExpression.set("count+id+u", 0); },
    () => { f.layers[0].props.plainLetters.set("2-3", 0); f.layers[3].props.splineLetters.set("plain-1", 0); },
    () => { f.layers.reverse(); },
    () => { f.layers.find(l => l.kind === "delay").props.delayEnable.set(0, 0); },
    () => { f.layers.find(l => l.kind === "plain").props.plainStrength.expression = new PZ.expression("frame*2"); },
  ];
  for (const edit of edits) {
    evaluate(f, 900.5); edit();
    const expected = evaluate(f, 901.25, referenceStack);
    const warm = evaluate(f, 901.25);
    C.clearDelayCache();
    equalNumbers(warm, expected); equalNumbers(evaluate(f, 901.25), expected);
  }
});

test("opaque readers never reuse samples after closure state changes", () => {
  let amount = 1;
  const layers = [{ kind: "plain", props: { get(key) { return key === "plainPosition" ? { get: f => [amount * f, 0, 0] } : undefined; } } },
    { kind: "delay", props: staticProps({ delayMode: 2 }) }];
  const f = { layers, container: {}, list: { order: [0], total: 1 }, base: [0, 0, 0], index: 0 };
  assert.equal(C.delayCacheFor(layers, 0, f.list, f.base), null);
  evaluate(f, 800); amount = 17;
  equalNumbers(evaluate(f, 900.125), evaluate(f, 900.125, referenceStack));
});

test("fingerprinting never calls an opaque section reader", () => {
  let reads = 0;
  const layers = [{ kind: "plain", props: { get(key) {
    reads++;
    return key === "plainPosition" ? { get: frame => [frame, 0, 0] } : undefined;
  } } }, { kind: "delay", props: staticProps({ delayMode: 1 }) }];
  const f = { layers, container: {}, list: { order: [0], total: 1 }, base: [0, 0, 0], index: 0 };
  const actual = evaluate(f, 20.5), actualReads = reads;
  reads = 0;
  const expected = evaluate(f, 20.5, referenceStack);
  equalNumbers(actual, expected);
  assert.equal(actualReads, reads);
});

test("owned static rows invalidate value edits and reject replaced getters", () => {
  C.clearDelayCache();
  const values = { plainPosition: [10, 0, -0] }, props = staticProps(values);
  const layers = [{ kind: "plain", props }, { kind: "delay", props: staticProps({ delayMode: 0 }) }];
  const f = { layers, container: {}, list: { order: [0], total: 1 }, base: [0, 0, 0], index: 0 };
  evaluate(f, 7300); values.plainPosition[0] = -23;
  equalNumbers(evaluate(f, 7301.5), evaluate(f, 7301.5, referenceStack));
  props.get("plainPosition").get = frame => [frame, 7, 0];
  assert.equal(C.delayCacheFor(layers, 0, f.list, f.base), null);
  equalNumbers(evaluate(f, 7301.5), evaluate(f, 7301.5, referenceStack));
});

test("Delay sample buffers bound memory, evict safely, isolate outputs, and clear on unload", () => {
  C.clearDelayCache();
  const layers = [{ kind: "plain", props: staticProps({ plainPosition: [7, 2, 1] }) },
    { kind: "delay", props: staticProps({ delayMode: 1 }) }];
  const list = { order: [0], total: 1 }, base = [0, 0, 0];
  const first = C.delayCacheFor(layers, 0, list, base);
  let calls = 0;
  const sample = () => { calls++; return { position: [calls, -0, Infinity], rotation: [NaN, 0, 0], scale: [1, 1, 1] }; };
  C.cachedDelayTarget(first, 7300, sample); C.cachedDelayTarget(first, 7300, sample);
  assert.equal(calls, 1);
  const hit = C.cachedDelayTarget(first, 7300, sample); hit.position[0] = 500;
  assert.equal(C.cachedDelayTarget(first, 7300, sample).position[0], 1);
  assert.ok(Object.is(C.cachedDelayTarget(first, 7300, sample).position[1], -0));
  C.cachedDelayTarget(first, 7300 + C.WINDOW_SAMPLES, sample);
  C.cachedDelayTarget(first, 7300, sample); assert.equal(calls, 3);
  for (let i = 1; i <= C.MAX_LETTERS; i++) C.delayCacheFor(layers, i, list, base);
  assert.notEqual(C.delayCacheFor(layers, 0, list, base), first);
  const beforeUnload = C.delayCacheFor(layers, 0, list, base);
  plugin.deactivate();
  assert.notEqual(C.delayCacheFor(layers, 0, list, base), beforeUnload);
});
