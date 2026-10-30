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
