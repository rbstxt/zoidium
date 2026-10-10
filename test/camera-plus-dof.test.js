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
  assert.equal(renderer.calls.length, 5, "color, depth, tile, dilate, and the blurred output");
  assert.equal(renderer.calls[0].target, dof.colorTarget);
  assert.equal(renderer.calls[1].target, dof.depthTarget);
  assert.equal(renderer.calls[2].target, dof.tileTarget);
  assert.equal(renderer.calls[3].target, dof.dilateTarget);
  assert.equal(renderer.calls[4].target, target);
  assert.deepEqual([dof.tileTarget.width, dof.tileTarget.height], [8, 4], "one tile per 16x16 pixels of the viewport");
  assert.equal(dof.quad.material, dof.material, "the composite material is restored after the tile passes");
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
  assert.deepEqual([u.tileCount.value.x, u.tileCount.value.y], [8, 4]);
  assert.equal(dof.dilateMaterial.uniforms.tTiles.value, dof.tileTarget.texture);
  assert.equal(u.tTiles.value, dof.dilateTarget.texture, "the composite reads the dilated tile radii");
  assert.equal(scene.overrideMaterial, null, "no override material leaks into the scene");
});

test("the kernel spreads foregrounds past their outline instead of clipping them", () => {
  const { dof } = setup();
  const shader = dof.material.fragmentShader;
  assert.match(shader, /maxRadius < 1\.0/, "in-focus pixels with nothing blurred nearby pass through untouched");
  assert.match(shader, /texture2D\( tTiles/, "the search radius comes from the dilated tile radii, not the pixel alone");
  assert.match(shader, /sampleRadius < radius \) continue/, "a sample counts only when its own blur reaches the pixel");
  assert.match(shader, /sampleLinear < frontLimit \) front \+= contribution/, "nearer samples form a layer in front");
  assert.match(shader, /sampleRadius = min\( sampleRadius, centerRadius \)/, "background blur never spreads over a sharper surface");
  assert.equal(/centerColor\.a < 0\.02/.test(shader), false, "transparent pixels still receive a neighbour's blur");
  assert.match(shader, /gl_FragColor = front \+ back \* \( 1\.0 - front\.a \)/, "premultiplied output with spread alpha");
  assert.equal(/sampleColor\.rgb/.test(shader), false, "samples stay premultiplied like the scene render");
  assert.match(dof.tileMaterial.fragmentShader, /largest = max\( largest, blurRadius/, "tiles keep their largest radius");
  assert.match(dof.dilateMaterial.fragmentShader, /gap <= radius/, "tiles take neighbours whose blur reaches them");
});

test("shared sequence depth swaps the depth decoding in every pass", () => {
  const { dof } = setup();
  dof.useLinearDepthTexture();
  for (const material of [dof.tileMaterial, dof.dilateMaterial, dof.material]) {
    assert.match(material.fragmentShader, /texture2D\( tDepth, uv \)\.r/);
    assert.equal(/unpackDepth\( texture2D\( tDepth/.test(material.fragmentShader), false);
  }
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
  assert.equal(dof.tileTarget, null);
  assert.equal(dof.dilateTarget, null);
  assert.equal(dof.enabled, false);
});
