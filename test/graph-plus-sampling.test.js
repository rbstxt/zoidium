"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { easingPoints, ExpressionSamples } = require("../plugins/graph-plus/sampling.js");
const { nativeHost } = require("./expressions-plus-harness.js");

test("all 33 native easing polylines match playback within 0.75 screen pixels", () => {
  const { PZ } = nativeHost();
  assert.equal(PZ.tween.easingList.length, 33);
  for (let i = 1; i < 33; i++) {
    const prop = new PZ.property.dynamic.keyframes({ type: 0, name: "Sample", value: 0 });
    prop.keyframes.push(new PZ.keyframe(0, 0, 1), new PZ.keyframe(1, 100, i));
    const fn = u => prop.get(u * 100);
    for (const height of [40, 400, 4000]) {
      const points = easingPoints(PZ.tween.easingList[i].fn, 1200, height);
      for (let k = 1; k < points.length; k++) {
        const [a, va] = points[k - 1], [b, vb] = points[k];
        if (a === b) continue;
        for (let j = 1; j < 8; j++) {
          const u = j / 8, t = a + (b - a) * u;
          assert.ok(Math.abs(fn(t) - (va + (vb - va) * u)) * height < 0.75, PZ.tween.easingList[i].name);
        }
      }
    }
  }
});

test("expression samples cache by property, expression and range without changing the host", () => {
  let calls = 0;
  const project = { frame: 23, history: [] };
  const prop = { expression: { source: "frame * 2" }, get(f) { calls++; return f * 2; } };
  const samples = new ExpressionSamples(() => 0);
  const budget = () => ({ deadline: 1, remaining: 1024 });
  const first = samples.sample(prop, 0, 10, 1, budget());
  assert.equal(first.points.length, 11);
  assert.equal(samples.sample(prop, 0, 10, 1, budget()), first);
  assert.equal(calls, 11);
  prop.expression.source = "frame * 3";
  assert.notEqual(samples.sample(prop, 0, 10, 1, budget()), first);
  samples.invalidate();
  samples.sample(prop, 0, 10, 1, budget());
  assert.equal(calls, 33);
  assert.deepEqual(project, { frame: 23, history: [] });
  assert.ok(samples.sample(prop, 0, 10, 0.1, budget()).points.length > 11);
});

test("expression sample budgets resume and share the redraw limit", () => {
  const sampler = new ExpressionSamples(() => 0);
  const prop = { expression: { source: "frame" }, get: f => f };
  const budget = { deadline: 1, remaining: 4 };
  const record = sampler.sample(prop, 0, 10, 1, budget);
  assert.equal(record.points.length, 4);
  assert.equal(record.complete, false);
  assert.equal(sampler.sample(prop, 0, 10, 1, budget).points.length, 4);
  assert.equal(sampler.sample(prop, 0, 10, 1, { deadline: 1, remaining: 20 }).complete, true);
});

test("native expression sampling preserves serialized project, playhead and undo history", () => {
  const { host, fixture, editorFor } = require("./helpers/editor-identity-host.cjs");
  const c = host(), { PZ } = c;
  const { project, layer, clip } = fixture(c);
  clip.properties.load();
  const editor = editorFor(PZ, project);
  const prop = layer.properties.position.objects[1];
  prop.expression = new PZ.expression("shake(time,15,0,2,1,1)");
  const before = JSON.stringify(project);
  const sampler = new ExpressionSamples(() => 0);
  const result = sampler.sample(prop, 0, 30, 1, { deadline: 1, remaining: 100 });
  assert.equal(result.points.length, 31);
  assert.ok(result.points.every(p => Number.isFinite(p[1])));
  assert.equal(JSON.stringify(project), before);
  assert.equal(editor.playback.currentFrame, 0);
  assert.equal(editor.history.undoStack.length, 0);
});

test("drawn Bezier segments match native playback for every Easing+ preset", () => {
  const { PZ } = nativeHost();
  const { PRESETS } = require("../plugins/easing-plus/easing-curves.js");
  PZ.ui = { graph: function () {} };
  require("../plugins/graph-plus/curves.js")({ PZ });
  for (const preset of PRESETS) {
    const prop = new PZ.property.dynamic.keyframes({ type: 0, name: "Curve", value: 0 });
    const left = new PZ.keyframe(0, 0, 1), right = new PZ.keyframe(20, 100, 257);
    left.controlPoints[1] = [100 * preset.points[0].outX, 20 * preset.points[0].outY];
    right.controlPoints[0] = [100 * preset.points[1].inX, 20 * preset.points[1].inY];
    prop.keyframes.push(left, right);
    const attrs = {}, group = { pz_valueScale: 1, style: {} };
    PZ.ui.graph.prototype.updateCurve.call({ options: { curveLineWidth: 2 } }, {
      parentElement: { parentElement: group }, setAttributeNS(_ns, key, value) { attrs[key] = value; },
    }, left, right);
    const values = attrs.d.match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi).map(Number);
    const cubic = (a, b, c, d, t) => PZ.tween.bezier(a, b, c, d, t);
    for (let i = 1; i < 100; i++) {
      const t = i / 100;
      const x = cubic(values[0], values[2], values[4], values[6], t);
      const y = cubic(values[1], values[3], values[5], values[7], t);
      assert.ok(Math.abs(prop.get(x) + y) < 1e-5, preset.name);
    }
  }
});

test("step display agrees with native playback even when a Bezier flag remains set", () => {
  const { PZ } = nativeHost();
  PZ.ui = { graph: function () {} };
  require("../plugins/graph-plus/curves.js")({ PZ });
  const property = new PZ.property.dynamic.keyframes({ type: 0, name: "Step", value: 0 });
  const left = new PZ.keyframe(0, 0, 1), right = new PZ.keyframe(20, 100, 256);
  property.keyframes.push(left, right);
  const attrs = {}, group = { pz_valueScale: 1, style: {} };
  PZ.ui.graph.prototype.updateCurve.call({ options: { curveLineWidth: 2 } }, {
    parentElement: { parentElement: group }, setAttributeNS(_ns, key, value) { attrs[key] = value; },
  }, left, right);
  assert.equal(attrs.d, "M 0 0 L 100 0 L 100 -20");
  assert.equal(property.get(99.9), 0);
  assert.equal(property.get(100), 20);
  right.continuousTangent = false;
  const markerAttrs = { "stroke-dasharray": "2 1" };
  const marker = { pz_object: right, style: {}, parentElement: { parentElement: group },
    classList: { contains: () => false },
    setAttributeNS(_ns, name, value) { markerAttrs[name] = value; },
    removeAttribute(name) { delete markerAttrs[name]; },
  };
  PZ.ui.graph.prototype.updateKeyframe.call({ options: { keyframeSize: 10 }, zoomX: 1, zoomY: 1 }, marker);
  assert.equal(marker.style.stroke, "var(--zui-text-muted)", "hold marker uses the step style");
  assert.equal(markerAttrs["stroke-dasharray"], undefined, "old Bezier flags cannot mark a step as Bezier");
});

test("vector expressions supply component samples and override child keys", () => {
  const { host, fixture } = require("./helpers/editor-identity-host.cjs");
  const c = host(), { PZ } = c;
  const { layer, clip } = fixture(c); clip.properties.load();
  const vector = layer.properties.position;
  vector.expression = new PZ.expression("[frame, frame * 2, frame * 3]");
  const { expressionOf } = require("../plugins/graph-plus/property-state.js");
  const sampler = new ExpressionSamples(() => 0);
  for (let axis = 0; axis < vector.objects.length; axis++) {
    const property = vector.objects[axis];
    assert.equal(expressionOf(property), vector.expression);
    const result = sampler.sample(property, 0, 10, 1, { deadline: 1, remaining: 100 });
    assert.equal(result.points[10][1], 10 * (axis + 1));
  }
});
