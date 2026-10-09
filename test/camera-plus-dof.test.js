"use strict";

// Camera+ depth-of-field composite: the gather kernel must spread
// out-of-focus foregrounds over the background (alpha-weighted disc average
// with coverage output), pass in-focus pixels through untouched, and honor the
// shared-buffer convention (layer effects sample at uv * uvScale).

const assert = require("node:assert/strict");
const test = require("node:test");

const harness = require("./camera-plus-harness.js");

function loadDofClass(THREE) {
  const parts = {};
  const source = harness.readPluginSource("scene-dof.js");
  new Function("PZ", "THREE", "parts", source)(null, THREE, parts);
  return parts.dof.createSceneDofClass(THREE);
}

function setup() {
  const ctx = harness.createContext();
  const SceneDof = loadDofClass(ctx.THREE);
  const dof = new SceneDof();
  return { ctx, dof };
}

function recordingRenderer() {
  return {
    calls: [],
    render(scene, camera, target, forceClear) {
      this.calls.push({ scene, camera, target, forceClear });
    },
  };
}

test("configure maps Camera+ settings onto the composite uniforms", () => {
  const { dof } = setup();
  dof.configure({
    orthographic: true, near: 0.5, far: 900,
    aperture: 8, focusDistance: 15, focusAreaWidth: 4,
    nearBlurLevel: 2, farBlurLevel: 0.5,
  });
  const u = dof.material.uniforms;
  assert.equal(u.orthographic.value, 1);
  assert.equal(u.near.value, 0.5);
  assert.equal(u.far.value, 900);
  assert.equal(u.aperture.value, 8);
  assert.equal(u.focusDistance.value, 15);
  assert.equal(u.focusAreaWidth.value, 4);
  assert.equal(u.nearBlurLevel.value, 2);
  assert.equal(u.farBlurLevel.value, 0.5);
});

test("the composite overwrites exactly (no blending) and ignores depth", () => {
  const { dof } = setup();
  assert.equal(dof.material.transparent, false, "opaque overwrite like the scene render it replaces");
  assert.equal(dof.material.depthTest, false);
  assert.equal(dof.material.depthWrite, false);
});

test("render issues color, depth, and output passes with shared-buffer scaling", () => {
  const { ctx, dof } = setup();
  dof.configure({
    orthographic: false, near: 0.1, far: 5000,
    aperture: 8, focusDistance: 15, focusAreaWidth: 0,
    nearBlurLevel: 1, farBlurLevel: 1,
  });
  const renderer = recordingRenderer();
  const scene = new ctx.THREE.Scene();
  const camera = new ctx.THREE.PerspectiveCamera();
  const target = new ctx.THREE.WebGLRenderTarget(200, 100);
  target.viewport.set(0, 0, 120, 60);
  dof.render(renderer, target, scene, camera, target.viewport, true);
  assert.equal(renderer.calls.length, 3, "color pass, depth pass, and the blurred output");
  assert.equal(renderer.calls[0].target, dof.colorTarget);
  assert.equal(renderer.calls[1].target, dof.depthTarget);
  assert.equal(renderer.calls[2].target, target);
  assert.deepEqual([dof.colorTarget.width, dof.colorTarget.height], [200, 100], "targets match the shared buffer");
  assert.deepEqual(
    [dof.colorTarget.viewport.z, dof.colorTarget.viewport.w],
    [120, 60],
    "prepasses cover the layer viewport inside the shared buffer",
  );
  const u = dof.material.uniforms;
  assert.deepEqual([u.resolution.value.x, u.resolution.value.y], [120, 60]);
  assert.deepEqual(
    [u.uvScale.value.x, u.uvScale.value.y],
    [120 / 200, 60 / 100],
    "the composite samples the layer region at uv * uvScale",
  );
  assert.equal(u.tColor.value, dof.colorTarget.texture);
  assert.equal(u.tDepth.value, dof.depthTarget.texture);
  assert.equal(scene.overrideMaterial, null, "no override material leaks into the scene");
});

test("the kernel spreads foregrounds instead of pinning edges", () => {
  const source = harness.readPluginSource("scene-dof.js");
  assert.match(source, /coverage/, "coverage output carries the blur spread");
  assert.match(source, /maxRadius < 0\.5/, "in-focus pixels pass through untouched");
  assert.equal(/sampleBlur/.test(source), false, "no bilateral term that freezes out-of-focus edges");
  assert.equal(/centerColor\.a \)\s*;\s*"?\s*$/.test(source), false, "output alpha is not pinned to the center");
  assert.match(source, /gl_FragColor = vec4\( sharp, coverage \)/, "averaged color with spread alpha");
});

test("unload releases targets and materials", () => {
  const { ctx, dof } = setup();
  dof.configure({
    orthographic: false, near: 0.1, far: 5000,
    aperture: 8, focusDistance: 15, focusAreaWidth: 0,
    nearBlurLevel: 1, farBlurLevel: 1,
  });
  const renderer = recordingRenderer();
  const target = new ctx.THREE.WebGLRenderTarget(32, 24);
  dof.render(renderer, target, new ctx.THREE.Scene(), new ctx.THREE.PerspectiveCamera(), target.viewport, true);
  assert.ok(dof.colorTarget, "targets allocated while rendering");
  dof.unload();
  assert.equal(dof.colorTarget, null);
  assert.equal(dof.depthTarget, null);
  assert.equal(dof.enabled, false);
});
