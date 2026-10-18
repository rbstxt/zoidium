"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const p = require("../plugins/motion-path/projection.js");
const { build, hit } = require("../plugins/motion-path/overlay.js");
const c = require("../plugins/motion-path/curves.js");

test("2D mapping and layer inverses use CSS pixels with letterboxing", () => {
  const mapping = p.sequenceMapping({ left: 100, top: 80, width: 960, height: 540 }, [1920, 1080]);
  assert.deepEqual(mapping.toClient([100, -80]), [630, 390]);
  assert.deepEqual(mapping.fromClient(630, 390), [100, -80]);
  const transform = p.layerTransform([30, -20], [-2, 0.7], 0.8);
  const input = [43, 27], back = transform.inverse(transform.forward(input));
  back.forEach((v, i) => assert.ok(Math.abs(v - input[i]) < 1e-9));
  assert.equal(p.layerTransform([0, 0], [0, 1], 0).inverse, null);
});

test("overlay clamps trimmed clips, evaluates parent space per sample, and hit-tests only controls", () => {
  const keys = [c.makeKey(0, 0, 1), c.makeKey(20, 20, 1), c.makeKey(40, 0, 1)];
  const path = {
    axes: [{ keyframes: keys, animated: true, get: f => c.evaluate(keys, f, [null, x => x]) }],
    length: 20, startFrame: 10, endFrame: 30, local: 15,
    spaceAt: frame => ({ toClient: point => [frame * 10, point[0]] }),
  };
  const model = build(path, [null, x => x], new Set([20]));
  assert.deepEqual(model.line[0], [100, 10]);
  assert.deepEqual(model.line.at(-1), [300, 10]);
  assert.deepEqual(model.keys.map(k => k.frame), [20]);
  assert.deepEqual(model.current, [150, 15]);
  assert.equal(model.keys[0].selected, true);
  assert.equal(hit([model], 200, 20).key.frame, 20);
  assert.equal(hit([model], 150, 15), null, "a path segment never consumes input");
});
