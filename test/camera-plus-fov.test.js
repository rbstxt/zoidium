"use strict";

// Camera+ editable field of view: typing a FOV computes the focal length
// that renders it from the current sensor, zoom and sequence aspect. The
// FOV properties never store state, so saved projects keep only the focal
// length and old projects load unchanged.

const assert = require("node:assert/strict");
const test = require("node:test");

const harness = require("./camera-plus-harness.js");

function loadParts() {
  const ctx = harness.createContext();
  const parts = {};
  const source = harness.readPluginSource("camera-class.js");
  new Function("PZ", "THREE", "parts", source)(ctx.PZ, ctx.THREE, parts);
  return { ctx, parts };
}

function makeCamera(focalValue = 35) {
  const { ctx } = loadParts();
  const runtime = harness.loadRuntime();
  runtime.activate(ctx.context);
  const camera = ctx.registry.instantiate("zoidium:camera-plus/camera");
  camera.getSequenceResolution = () => [1920, 1080];
  camera.properties.focalLength.set(focalValue, 0);
  return { ctx, runtime, camera };
}

test("FOV definitions are editable with degree bounds; equivalent stays read-only", () => {
  const { parts, ctx } = loadParts();
  const defs = parts.camera.createDefinitions(ctx.PZ);
  for (const key of ["fovH", "fovV"]) {
    assert.equal(defs[key].readOnly, undefined, `${key} is editable`);
    assert.equal(defs[key].min, 0.01);
    assert.equal(defs[key].max, 179.99);
    assert.equal(defs[key].decimals, 4);
    assert.equal(defs[key].dynamic, true);
  }
  assert.equal(defs.equivFocalLength.readOnly, true);
});

test("inverse FOV formula round-trips the focal length across gates, zoom and aspect", () => {
  const { parts } = loadParts();
  const inverse = parts.camera.focalLengthForFieldOfView;
  const degrees = 180 / Math.PI;
  const cases = [
    [35, 36, 1, 16 / 9], [70, 36, 1, 16 / 9], [35, 21.95, 1, 16 / 9],
    [35, 36, 2, 16 / 9], [35, 36, 1, 9 / 16], [1, 36, 1, 16 / 9],
    [10000, 36, 1, 16 / 9], [50, 13.2, 0.5, 4 / 3],
  ];
  for (const [focal, gate, zoom, aspect] of cases) {
    const safeAspect = Math.max(aspect, 1);
    const halfHeight = gate / safeAspect / (2 * focal * zoom);
    const fovH = 2 * Math.atan(halfHeight * aspect) * degrees;
    const fovV = 2 * Math.atan(halfHeight) * degrees;
    assert.ok(Math.abs(inverse(0, fovH, gate, zoom, aspect) - focal) < 1e-9, `H ${focal}mm gate ${gate}`);
    assert.ok(Math.abs(inverse(1, fovV, gate, zoom, aspect) - focal) < 1e-9, `V ${focal}mm gate ${gate}`);
  }
});

test("typing 60 horizontal FOV computes focal 36/(2*tan(30deg))", () => {
  const { parts } = loadParts();
  const focal = parts.camera.focalLengthForFieldOfView(0, 60, 36, 1, 16 / 9);
  assert.ok(Math.abs(focal - 31.176914536239792) < 1e-9, `got ${focal}`);
});

test("non-finite FOV input is rejected", () => {
  const { parts } = loadParts();
  const inverse = parts.camera.focalLengthForFieldOfView;
  for (const bad of [NaN, Infinity, -Infinity, undefined, null, "abc", "", {}, []]) {
    assert.equal(inverse(0, bad, 36, 1, 16 / 9), null, `H rejects ${String(bad)}`);
    assert.equal(inverse(1, bad, 36, 1, 16 / 9), null, `V rejects ${String(bad)}`);
  }
  assert.ok(Number.isFinite(inverse(0, "60", 36, 1, 16 / 9)), "numeric strings stay usable");
});

test("out-of-range FOV clamps into the focal length range", () => {
  const { parts } = loadParts();
  const inverse = parts.camera.focalLengthForFieldOfView;
  assert.equal(inverse(0, 0, 36, 1, 16 / 9), 10000, "looking straight ahead needs the longest focal");
  assert.equal(inverse(0, -30, 36, 1, 16 / 9), 10000);
  assert.equal(inverse(0, 180, 36, 1, 16 / 9), 1, "a hemispheric view needs the shortest focal");
  assert.equal(inverse(0, 400, 36, 1, 16 / 9), 1);
  assert.equal(inverse(1, 0, 36, 1, 16 / 9), 10000);
  assert.equal(inverse(1, 180, 36, 1, 16 / 9), 1);
});

test("setting FOV writes focal length and leaves FOV storage untouched", () => {
  const { runtime, camera } = makeCamera();
  try {
    camera.properties.fovH.set(60, 0);
    assert.ok(Math.abs(camera.properties.focalLength.get(0) - 31.176914536239792) < 1e-9);
    assert.ok(Math.abs(camera.properties.fovH.get(0) - 60) < 1e-9, "displayed FOV equals the entered value");
    assert.ok(Math.abs(camera.properties.fovV.get(0) - 35.9834) < 1e-3, "vertical follows the same focal length");
    // The FOV properties never store anything: no keyframes are created, so
    // saving stores focal length only, exactly like before this change.
    assert.equal(camera.properties.fovH.keyframes.length, 0);
    assert.equal(camera.properties.fovV.keyframes.length, 0);
    assert.equal(camera.properties.fovH.animated, undefined);
    // Rejected input changes nothing.
    camera.properties.fovH.set(NaN, 0);
    assert.ok(Math.abs(camera.properties.focalLength.get(0) - 31.176914536239792) < 1e-9);
  } finally { runtime.deactivate(); }
});

test("vertical FOV edit uses the vertical span", () => {
  const { runtime, camera } = makeCamera();
  try {
    camera.properties.fovV.set(32.26880217111643, 0);
    assert.ok(Math.abs(camera.properties.focalLength.get(0) - 35) < 1e-6, `got ${camera.properties.focalLength.get(0)}`);
  } finally { runtime.deactivate(); }
});

test("FOV edit on an animated focal length creates its key at the edit frame", () => {
  const { ctx, runtime, camera } = makeCamera();
  try {
    ctx.PZ.keyframe = class {
      constructor(value = 0, frame = 0, tween = 1) { this.value = value; this.frame = frame; this.tween = tween; }
    };
    const focal = camera.properties.focalLength;
    // Keyframe list behavior mirrors CM3 for this one property.
    focal.animated = true;
    focal.keyframes = [{ frame: 0, value: 35, tween: 1 }];
    focal.hasKeyframe = (frame) => focal.keyframes.some((key) => key.frame === frame);
    focal.getClosestKeyframeIndex = (frame) => {
      let best = 0;
      for (let i = 0; i < focal.keyframes.length; i += 1) {
        if (Math.abs(focal.keyframes[i].frame - frame) < Math.abs(focal.keyframes[best].frame - frame)) best = i;
      }
      return best;
    };
    focal.addKeyframe = (key) => {
      focal.keyframes.push(key);
      focal.keyframes.sort((a, b) => a.frame - b.frame);
    };
    camera.properties.fovH.set(60, 30);
    assert.deepEqual(focal.keyframes.map((k) => k.frame), [0, 30]);
    // The new key captures the pre-edit focal length (mirroring the
    // editor's edit start); the set itself is applied to the property.
    assert.equal(focal.keyframes[1].value, 35);
    assert.ok(Math.abs(focal.get(30) - 31.176914536239792) < 1e-9);
    // The FOV property itself never becomes animated or keyframed.
    assert.equal(camera.properties.fovH.keyframes.length, 0);
  } finally { runtime.deactivate(); }
});

test("loading an old project ignores stored FOV readout values", () => {
  const { runtime, camera } = makeCamera();
  try {
    camera.load({ properties: { focalLength: 40, fovH: 0, fovV: 0 } });
    const [h, v] = camera.getFieldOfView(0);
    assert.ok(Math.abs(h - 48.4555) < 1e-3, `H ${h} follows the loaded focal length`);
    assert.ok(v > 0 && v < h, `V ${v} follows the loaded focal length`);
  } finally { runtime.deactivate(); }
});
