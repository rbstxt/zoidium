"use strict";

// Camera+ property conventions: display names stay short enough for the CM3
// property panel, numeric formatting follows the CM3 camera (Position shows
// two decimals), the aperture range accepts the values users type, and
// property keys plus serialized values never change.

const assert = require("node:assert/strict");
const test = require("node:test");

const harness = require("./camera-plus-harness.js");

function definitions() {
  const ctx = harness.createContext();
  const parts = {};
  const source = harness.readPluginSource("camera-class.js");
  new Function("PZ", "THREE", "parts", source)(ctx.PZ, ctx.THREE, parts);
  return parts.camera.createDefinitions(ctx.PZ);
}

test("short display names keep their property keys", () => {
  const defs = definitions();
  assert.equal(defs.filmGate.name, "Sensor");
  assert.ok(defs.filmGate.name.length <= 12, "fits the panel label column");
});

test("film gate values are unchanged (serialization stable)", () => {
  const defs = definitions();
  assert.deepEqual(
    defs.filmGate.items.map((item) => item.value),
    [36, 36, 36, 21.95, 24.89, 23.6, 22.3, 17.3, 13.2, 8.8, 12.52, 10.26],
  );
  for (const item of defs.filmGate.items) {
    assert.ok(item.name.length <= 20, `gate label fits the select: ${item.name}`);
  }
});

test("aperture accepts the typed range instead of silently clamping it", () => {
  const source = harness.readPluginSource("camera-class.js");
  const match = source.match(/aperture:\s*\{[^}]*max:\s*(\d+)/);
  assert.ok(match, "aperture definition found");
  assert.ok(Number(match[1]) >= 40, "typed values like 40 stay as entered");
});

test("focus distance formats like the CM3 position properties", () => {
  const source = harness.readPluginSource("camera-class.js");
  const match = source.match(/focusDistance:\s*\{[^}]*decimals:\s*(\d+)/);
  assert.ok(match, "focus distance definition found");
  assert.equal(Number(match[1]), 2, "two decimals, matching Position 80.00");
});

test("renamed depth-of-field rows keep their keys", () => {
  const source = harness.readPluginSource("camera-class.js");
  assert.match(source, /focusAreaWidth:\s*\{\s*dynamic:\s*true,\s*name:\s*"Focus Width"/);
  assert.match(source, /focusDistance:\s*\{\s*dynamic:\s*true,\s*name:\s*"Focus Distance"/);
  assert.match(source, /aperture:\s*\{\s*dynamic:\s*true,\s*name:\s*"Aperture"/);
});

test("no locale branches in Camera+ sources", () => {
  const sources = ["camera-class.js", "focus-ui.js", "vibrate.js", "scene-dof.js", "camera-runtime.js"]
    .map((name) => harness.readPluginSource(name));
  for (const source of sources) {
    assert.equal(/window\.ZoidiumI18n/.test(source), false);
  }
});


test("film readouts evaluate requested time, zoom, sensor and resolution without a render", () => {
  const ctx = harness.createContext();
  const runtime = harness.loadRuntime();
  runtime.activate(ctx.context);
  try {
    const camera = ctx.registry.instantiate("zoidium:camera-plus/camera");
    let resolution = [1920, 1080];
    camera.getSequenceResolution = () => resolution;
    camera.properties.focalLength.get = time => time === 10 ? 70 : 35;
    const initial = camera.getFieldOfView(0);
    const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-10, `${a} equals ${b}`);
    close(initial[0], 2 * Math.atan(36 / 70) * 180 / Math.PI);
    close(camera.properties.fovV.get(0), initial[1]);
    close(camera.getEffectiveFOV(0), initial[1]);
    const later = camera.getFieldOfView(10);
    assert.ok(later[0] < initial[0]);
    camera.updateProjection(10);
    assert.deepEqual(camera.getFieldOfView(0), initial, "out-of-order reads ignore last projection");
    camera.properties.zoom.set(2);
    assert.deepEqual(camera.getFieldOfView(0), later, "2x zoom matches twice the focal length");
    camera.properties.filmGate.set(18);
    close(camera.properties.equivFocalLength.get(10), 140);
    resolution = [1080, 1920];
    assert.ok(camera.getFieldOfView(0)[1] > camera.getFieldOfView(0)[0]);
    camera.properties.projection.set("orthographic");
    assert.deepEqual(camera.getFieldOfView(0), [0, 0]);
    for (const key of ["equivFocalLength", "fovH", "fovV"]) {
      assert.equal(camera.properties[key].definition.readOnly, true);
      assert.equal(camera.properties[key].hideAnimateToggle, true);
    }
  } finally { runtime.deactivate(); }
});
