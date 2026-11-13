"use strict";
// GPU layer-mask coverage.
//
// The same coverage the CPU reference raster (mask-raster.js) computes, drawn
// with the GPU instead: each mask's flattened path triangulates with earcut,
// renders white into a scratch target, feathers through the exact box blur
// the CPU applies (three horizontal/vertical passes of the same clamped
// 2r+1 box, so pixels agree with the reference within a couple of LSBs),
// and combines in order with the AE blend modes. Static masks cost ~0 per
// frame: re-renders happen only when the signature (geometry + feather +
// mode stack + resolution, see signatureOf) changes.
//
// Orientation: mask row 0 (mask-space top) renders to the top framebuffer
// row, so texture v = 1 samples the top, exactly like the CPU DataTexture
// with flipY = true and the toUV conversion (v = 1 at top). See the
// orientation probes in the B40 task folder.
//
// Precision: scratch targets are 8-bit RGBA sampled nearest, so every blur
// tap reads an exact texel value; only the final summation is float. The
// blur loop bound is fixed (WebGL1 needs constant bounds); feather radii
// above MAX_GPU_FEATHER fall back to the CPU reference, which the tests pin
// pixel-for-pixel.
const { flattenPath } = require("./path.js");
const { closeContour } = require("./mask-raster.js");
const earcut = require("./vendor/earcut.js");

// Long-side caps live with the callers (2048 for layer masks, 1024 for
// Shader+ inputs); this module renders whatever size it is given.
const MAX_GPU_FEATHER = 64;
// Fixed WebGL1 loop bound: 2 * MAX_GPU_FEATHER + 1 nearest taps.
const MAX_TAPS = 2 * MAX_GPU_FEATHER + 1;
// Shared-cache budget: entries are small (coverage size), evicted oldest.
const MAX_CACHE_ENTRIES = 8;

// Vertices to coverage pixels: mask space (top-left, y down) at the
// coverage scale. The GPU renders scaled geometry into a scaled target, the
// same input the CPU raster takes.
function scaleEvaluated(evaluated, scale) {
  return evaluated.map(entry => ({
    ...entry,
    vertices: entry.vertices.map(vertex => ({
      point: [vertex.point[0] * scale, vertex.point[1] * scale],
      in: [vertex.in[0] * scale, vertex.in[1] * scale],
      out: [vertex.out[0] * scale, vertex.out[1] * scale],
    })),
    feather: (entry.feather || 0) * scale,
  }));
}

// Cache key of everything that affects coverage pixels: geometry (with
// handles, which steer the flatten), closed state, combine parameters and
// the target size. The same frame always evaluates to the same floats, so
// raw JSON is a stable key.
function signatureOf(scaled, width, height) {
  return JSON.stringify([width, height, scaled.map(entry => [
    entry.vertices.map(vertex => [...vertex.point, ...vertex.in, ...vertex.out]),
    entry.closed ? 1 : 0, entry.mode || "add", entry.feather || 0,
    entry.opacity === undefined ? 1 : entry.opacity, entry.invert ? 1 : 0,
    entry.enabled === false || entry.enabled === 0 ? 0 : 1,
  ])]);
}

// A clamped 2r+1 box blur: integer texel offsets with a shared weight.
// Sampling stays nearest, so every tap reads an exact texel value and edge
// pixels clamp exactly like the CPU reference.
function blurTaps(radius) {
  const clamped = Math.max(0, Math.min(MAX_GPU_FEATHER, Math.round(radius)));
  const offsets = [];
  for (let k = -clamped; k <= clamped; k++) offsets.push(k + 0);
  return { radius: clamped, count: offsets.length, offsets, weight: 1 / offsets.length };
}

function createMaskGpu(THREE) {
  if (!THREE || !THREE.WebGLRenderTarget) throw Error("Layer masks need the Three.js runtime");
  const states = new WeakMap();
  const stats = { hits: 0, misses: 0, cpuFallbacks: 0, lastBuildMs: 0 };
  let forceCpu = false;

  // The compositor leaves autoClear enabled with its own clear color; our
  // passes overwrite every pixel they write, so skip the implicit clear
  // instead of depending on whatever color happens to be set.
  function withoutAutoClear(renderer, fn) {
    const autoClear = renderer.autoClear;
    try {
      renderer.autoClear = false;
      return fn();
    } finally {
      try {
        renderer.autoClear = autoClear;
      } catch (_error) { /* Best effort. */ }
    }
  }

  function target(width, height, filter) {
    const renderTarget = new THREE.WebGLRenderTarget(width, height, {
      minFilter: filter, magFilter: filter,
      format: THREE.RGBAFormat, type: THREE.UnsignedByteType,
      depthBuffer: false, stencilBuffer: false,
    });
    renderTarget.texture.generateMipmaps = false;
    return renderTarget;
  }

  function clearToTransparent(renderer, renderTarget) {
    let color = null, alpha = 1, hasColor = false;
    try {
      if (renderer.getClearColor) {
        color = renderer.getClearColor(new THREE.Color());
        hasColor = true;
      }
      if (renderer.getClearAlpha) alpha = renderer.getClearAlpha();
    } catch (_error) { /* Fixed-function state stays as-is. */ }
    try {
      if (renderer.setClearColor) renderer.setClearColor(0x000000, 0);
      renderer.clearTarget(renderTarget, true, false, false);
    } finally {
      try {
        if (renderer.setClearColor && hasColor) renderer.setClearColor(color, alpha);
      } catch (_error) { /* Best effort. */ }
    }
  }

  function stateFor(renderer) {
    let state = states.get(renderer);
    if (state) return state;
    const fillMaterial = new THREE.ShaderMaterial({
      vertexShader: "void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
      fragmentShader: "void main() { gl_FragColor = vec4(1.0); }",
      depthTest: false, depthWrite: false,
      // Masks author in top-left, y-down space while the fill camera maps
      // y = 0 to NDC +1: contours arrive clockwise in NDC and would be
      // backface-culled. Coverage wants the interior regardless of winding.
      side: THREE.DoubleSide,
    });
    // Separable box blur: one axis per pass. The loop bound is a baked
    // constant (WebGL1); taps past uCount contribute zero.
    const blurMaterial = new THREE.ShaderMaterial({
      uniforms: {
        tSrc: { type: "t", value: null },
        uStep: { value: new THREE.Vector2(1, 0) },
        uRadius: { value: 0 },
        uCount: { value: 1 },
        uWeight: { value: 1 },
      },
      vertexShader: "varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
      fragmentShader: [
        "uniform sampler2D tSrc;",
        "uniform vec2 uStep;",
        "uniform float uRadius;",
        "uniform float uCount;",
        "uniform float uWeight;",
        "varying vec2 vUv;",
        "void main() {",
        "  vec4 sum = vec4(0.0);",
        "  for (int i = 0; i < " + MAX_TAPS + "; i++) {",
        "    float take = 1.0 - step(uCount, float(i));",
        "    sum += texture2D(tSrc, vUv + uStep * (float(i) - uRadius)) * (uWeight * take);",
        "  }",
        "  gl_FragColor = sum;",
        "}",
      ].join("\n"),
      depthTest: false, depthWrite: false,
    });
    // AE combine of one blurred mask over the accumulation. uMode: 0 add,
    // 1 subtract, 2 intersect. uFirst ignores the base, matching the CPU
    // combine's isFirst rule (subtract starts at zero).
    const combineMaterial = new THREE.ShaderMaterial({
      uniforms: {
        tBase: { type: "t", value: null },
        tMask: { type: "t", value: null },
        uOpacity: { value: 1 },
        uInvert: { value: 0 },
        uMode: { value: 0 },
        uFirst: { value: 1 },
      },
      vertexShader: "varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
      fragmentShader: [
        "uniform sampler2D tBase;",
        "uniform sampler2D tMask;",
        "uniform float uOpacity;",
        "uniform float uInvert;",
        "uniform int uMode;",
        "uniform int uFirst;",
        "varying vec2 vUv;",
        "void main() {",
        "  float base = texture2D(tBase, vUv).a;",
        "  float alpha = texture2D(tMask, vUv).a * uOpacity;",
        "  if (uInvert > 0.5) alpha = 1.0 - alpha;",
        "  alpha = clamp(alpha, 0.0, 1.0);",
        "  float outA;",
        "  if (uFirst == 1) { outA = (uMode == 1) ? 0.0 : alpha; }",
        "  else if (uMode == 1) { outA = base * (1.0 - alpha); }",
        "  else if (uMode == 2) { outA = min(base, alpha); }",
        "  else { outA = base + alpha * (1.0 - base); }",
        "  gl_FragColor = vec4(1.0, 1.0, 1.0, outA);",
        "}",
      ].join("\n"),
      depthTest: false, depthWrite: false,
    });
    const quadScene = new THREE.Scene();
    const quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), blurMaterial);
    quad.frustumCulled = false;
    quadScene.add(quad);
    const fillScene = new THREE.Scene();
    // Mask y = 0 (top) maps to NDC +1 (top framebuffer row): texture v = 1
    // samples mask-space top, the same convention as the flipped CPU
    // upload and toUV. Bounds refresh per coverage size.
    const fillCamera = new THREE.OrthographicCamera(0, 1, 0, 1, -1, 1);
    state = {
      targets: null, width: 0, height: 0,
      fillMaterial, blurMaterial, combineMaterial,
      quadScene, quadCamera, quad, fillScene, fillCamera,
      entries: new Map(),
    };
    states.set(renderer, state);
    return state;
  }

  function ensureScratch(renderer, state, width, height) {
    if (state.targets && state.width === width && state.height === height) return;
    if (state.targets) {
      for (const key of Object.keys(state.targets)) state.targets[key].dispose();
    }
    state.targets = {
      shape: target(width, height, THREE.NearestFilter),
      blurA: target(width, height, THREE.NearestFilter),
      blurB: target(width, height, THREE.NearestFilter),
      accA: target(width, height, THREE.NearestFilter),
      accB: target(width, height, THREE.NearestFilter),
    };
    clearToTransparent(renderer, state.targets.accA);
    clearToTransparent(renderer, state.targets.accB);
    state.width = width;
    state.height = height;
    state.fillCamera.left = 0;
    state.fillCamera.right = width;
    state.fillCamera.top = 0;
    state.fillCamera.bottom = height;
    state.fillCamera.updateProjectionMatrix();
  }

  // Triangulate one mask into the shape target. Returns false for degenerate
  // (zero-area) paths, which cover nothing, matching the CPU fill. The
  // fill material is double-sided: mask space is top-left, y-down, so
  // contours arrive clockwise in NDC and would otherwise be culled.
  function renderShape(renderer, state, entry) {
    const contour = closeContour(entry.vertices || [], !!entry.closed);
    if (contour.length < 3) return false;
    const flat = flattenPath({ vertices: contour, closed: true });
    if (flat.points.length < 3) return false;
    const coords = [];
    for (const point of flat.points) coords.push(point[0], point[1]);
    let indices;
    try {
      indices = earcut(coords, null, 2);
    } catch (_error) {
      return false;
    }
    if (!indices || indices.length < 3) return false;
    const positions = new Float32Array((indices.length / 3) * 9);
    for (let i = 0; i + 2 < indices.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        const c = indices[i + k] * 2;
        positions[(i / 3) * 9 + k * 3] = coords[c];
        positions[(i / 3) * 9 + k * 3 + 1] = coords[c + 1];
        positions[(i / 3) * 9 + k * 3 + 2] = 0;
      }
    }
    if (!positions.length) return false;
    const geometry = new THREE.BufferGeometry();
    // Three r91 predates setAttribute/setIndex: addAttribute with a plain
    // BufferAttribute over the same layout. Non-indexed: every triple is
    // one earcut triangle.
    geometry.addAttribute("position", new THREE.BufferAttribute(positions, 3));
    const mesh = new THREE.Mesh(geometry, state.fillMaterial);
    mesh.frustumCulled = false;
    state.fillScene.add(mesh);
    try {
      // No auto-clear: the caller cleared the shape target to transparent
      // black, and the compositor's clear color is opaque.
      withoutAutoClear(renderer, () => renderer.render(state.fillScene, state.fillCamera, state.targets.shape, false));
    } finally {
      state.fillScene.remove(mesh);
      geometry.dispose();
    }
    return true;
  }

  // Three horizontal/vertical passes of the clamped box, ping-ponging
  // between the blur targets. Returns the target holding the result.
  function blur(renderer, state, radius, width, height) {
    const taps = blurTaps(radius);
    const material = state.blurMaterial;
    let read = state.targets.shape, write = state.targets.blurA;
    for (let pass = 0; pass < 3; pass++) {
      for (let axis = 0; axis < 2; axis++) {
        material.uniforms.tSrc.value = read.texture;
        material.uniforms.uStep.value.set(axis === 0 ? 1 / width : 0, axis === 1 ? 1 / height : 0);
        material.uniforms.uRadius.value = taps.radius;
        material.uniforms.uCount.value = taps.count;
        material.uniforms.uWeight.value = taps.weight;
        state.quad.material = material;
        withoutAutoClear(renderer, () => renderer.render(state.quadScene, state.quadCamera, write, false));
        const next = read;
        read = write;
        write = next === state.targets.shape ? state.targets.blurB : next;
      }
    }
    return read;
  }

  function combine(renderer, state, base, mask, entry, first, destination) {
    const material = state.combineMaterial;
    material.uniforms.tBase.value = base.texture;
    material.uniforms.tMask.value = mask.texture;
    material.uniforms.uOpacity.value = entry.opacity === undefined ? 1 : entry.opacity;
    material.uniforms.uInvert.value = entry.invert ? 1 : 0;
    material.uniforms.uMode.value = entry.mode === "subtract" ? 1 : entry.mode === "intersect" ? 2 : 0;
    material.uniforms.uFirst.value = first ? 1 : 0;
    state.quad.material = material;
    withoutAutoClear(renderer, () => renderer.render(state.quadScene, state.quadCamera, destination, false));
  }

  // Render (or fetch) the coverage texture for already-scaled entries.
  // Returns null when the caller should use the CPU reference instead
  // (feather beyond the GPU loop bound, or a forced-CPU probe).
  function renderCoverage(renderer, scaled, width, height, signature) {
    if (!renderer || forceCpu) return null;
    if (Math.max(0, ...scaled.map(entry => Math.round(entry.feather || 0))) > MAX_GPU_FEATHER) return null;
    const state = stateFor(renderer);
    const hit = state.entries.get(signature);
    if (hit) {
      state.entries.delete(signature);
      state.entries.set(signature, hit);
      stats.hits++;
      return hit.texture;
    }
    const started = Date.now();
    ensureScratch(renderer, state, width, height);
    const live = scaled.filter(entry => entry && entry.enabled !== false && entry.enabled !== 0);
    const entryTarget = target(width, height, THREE.LinearFilter);
    if (live.length) {
      let base = state.targets.accA, next = state.targets.accB;
      live.forEach((entry, index) => {
        clearToTransparent(renderer, state.targets.shape);
        const drawn = renderShape(renderer, state, entry);
        let mask = state.targets.shape;
        if (drawn && Math.round(entry.feather || 0) > 0) mask = blur(renderer, state, entry.feather || 0, width, height);
        combine(renderer, state, base, mask, entry, index === 0, index === live.length - 1 ? entryTarget : next);
        const swap = base;
        base = next;
        next = swap;
      });
    } else {
      clearToTransparent(renderer, entryTarget);
    }
    const stored = { target: entryTarget, texture: entryTarget.texture, width, height };
    state.entries.set(signature, stored);
    while (state.entries.size > MAX_CACHE_ENTRIES) {
      const oldest = state.entries.keys().next().value;
      if (oldest === signature) break;
      const victim = state.entries.get(oldest);
      state.entries.delete(oldest);
      try {
        victim.target.dispose();
      } catch (_error) { /* Eviction is best effort. */ }
    }
    stats.misses++;
    stats.lastBuildMs = Date.now() - started;
    return stored.texture;
  }

  function disposeRenderer(renderer) {
    const state = states.get(renderer);
    if (!state) return;
    if (state.targets) for (const key of Object.keys(state.targets)) state.targets[key].dispose();
    for (const entry of state.entries.values()) {
      try {
        entry.target.dispose();
      } catch (_error) { /* ignore */ }
    }
    state.entries.clear();
    state.quad.geometry.dispose();
    state.fillMaterial.dispose();
    state.blurMaterial.dispose();
    state.combineMaterial.dispose();
    states.delete(renderer);
  }

  return {
    coverageTexture(renderer, scaled, width, height, signature) {
      try {
        return renderCoverage(renderer, scaled, width, height, signature);
      } catch (_error) {
        stats.cpuFallbacks++;
        return null;
      }
    },
    setForceCpu(value) { forceCpu = !!value; },
    stats() { return { ...stats }; },
    disposeRenderer,
  };
}

// One GPU coverage cache per bundle: mask rendering and the Shader+ Path
// sampling API share it, so a mask driving both a layer composite and a
// shader binds the same texture. The first THREE runtime wins; Shape+ and
// its consumers always pass the page runtime.
let shared = null;
function sharedGpu(THREE) {
  if (!shared) shared = createMaskGpu(THREE);
  return shared;
}

module.exports = { createMaskGpu, sharedGpu, scaleEvaluated, signatureOf, blurTaps, MAX_GPU_FEATHER, MAX_TAPS, MAX_CACHE_ENTRIES };
