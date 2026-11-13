"use strict";
// Mask rendering: applies layer-mask collections at the layer composite.
//
// A wrapper around the compositor's renderEffects multiplies the finished
// layer image alpha by the mask coverage after all effects ran, then swaps
// the buffers exactly like a native effect pass. Scene layers fade to
// transparent; Adjustment layers blend back to the original screen because
// the native composite draws the masked image over it. Layers without masks
// call straight through, so unmasked projects render byte-identically.
//
// Coverage rasterizes in mask space (sequence pixels, top-left, y down) from
// the path geometry evaluated at the layer's own update frame, which a small
// update wrapper stashes per layer. Under temporal remapping (time remap,
// frame samplers) the stashed frame is the local frame while the rendered
// content follows the source frame, so evaluation prefers the temporal
// sequence mapping when present. Coverage itself renders on the GPU
// (mask-gpu.js: triangulated fill, exact box-feather, AE combine) and is
// cached by signature; the CPU raster remains as the test reference and the
// fallback for extreme feather radii.
//
// Orientation: mask row 0 (top) reaches texture v = 1 (the CPU upload sets
// flipY, the GPU camera maps y = 0 to NDC +1), and displayed-top fragments
// sample v = 1, so a mask drawn over the top half of the viewport masks the
// displayed top. Automated top-vs-bottom readbacks pin this; see toUV.
//
// Layer Input captures only see layer masks in the default "Effects &
// Masks" stage: a "Masks"- or "Source"-stage capture on another wrapper
// order must not gain (or keep) layer masks. The stage rides on the capture
// compositor, so this guard is independent of plugin install order.
const { FIELD, FRAME_KEY, evaluateMask, samplePoints } = require("./mask-model.js");
const { rasterizeCoverage } = require("./mask-raster.js");
const { sharedGpu, scaleEvaluated, signatureOf } = require("./mask-gpu.js");

// Long-side cap for the coverage texture. Feather stays smooth through the
// linear sampler; hard edges lose sub-pixel crispness above the cap only.
const MAX_COVERAGE_SIDE = 2048;

function maskable(PZ, layer) {
  return !!layer && (layer instanceof PZ.layer.scene || layer instanceof PZ.layer.adjustment);
}

// The frame the layer content is evaluated at: the temporal sequence
// mapping's source frame when the host remapped this update (time remap,
// frame samplers), else the update wrapper's stashed frame.
function maskFrameFor(layer) {
  const mapping = layer ? layer.__zoidiumTemporalSequenceMapping : null;
  if (mapping && typeof mapping.sourceFrame === "number" && Number.isFinite(mapping.sourceFrame)) return mapping.sourceFrame;
  return layer ? layer[FRAME_KEY] : undefined;
}

function coverageSize(resolution) {
  const width = Math.max(1, Math.round(resolution[0] || 0));
  const height = Math.max(1, Math.round(resolution[1] || 0));
  const scale = Math.min(1, MAX_COVERAGE_SIDE / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)), scale };
}

// Evaluated mask geometries at a clip-local frame. Throwaway Content items
// read straight from the persisted JSON, so rendering never depends on editor
// selection or gesture state; failed data disables the masks with a warning.
function evaluateMasks(Content, masks, frame) {
  const evaluated = [];
  for (const data of masks) {
    let geometry;
    try {
      const item = new Content(data.kind, data);
      item.load(data);
      geometry = evaluateMask(item, frame);
    } catch (error) {
      throw Error("Layer mask item: " + error.message);
    }
    evaluated.push({ ...geometry, mode: data.mode || "add", feather: data.feather || 0, opacity: data.opacity === undefined ? 1 : data.opacity, invert: !!data.invert,
      enabled: geometry.enabled && data.enabled !== false && data.enabled !== 0 });
  }
  return evaluated;
}

function installMaskRender({ PZ, THREE, Content, onDispose }) {
  const runtimes = new WeakMap();
  const renderers = new Set();
  const warned = new Set();
  function warnOnce(layer, message) {
    const key = (layer || "global") + ": " + message;
    if (warned.has(key)) return;
    warned.add(key);
    if (typeof console !== "undefined") console.warn("[Shape+] layer masks: " + message);
  }

  function runtimeFor(compositor) {
    let runtime = runtimes.get(compositor);
    if (compositor && compositor.renderer) renderers.add(compositor.renderer);
    if (!runtime) {
      const material = new THREE.ShaderMaterial({
        uniforms: {
          tDiffuse: { type: "t", value: null },
          tMask: { type: "t", value: null },
          uvScale: { type: "v2", value: new THREE.Vector2(1, 1) },
        },
        vertexShader: "varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
        fragmentShader: [
          "uniform sampler2D tDiffuse;",
          "uniform sampler2D tMask;",
          "uniform vec2 uvScale;",
          "varying vec2 vUv;",
          "void main() {",
          "  vec2 uv = vUv * uvScale;",
          "  vec4 layer = texture2D(tDiffuse, uv);",
          "  float coverage = texture2D(tMask, uv).a;",
          "  gl_FragColor = vec4(layer.rgb * coverage, layer.a * coverage);",
          "}",
        ].join("\n"),
        depthTest: false,
        depthWrite: false,
      });
      material.premultipliedAlpha = true;
      const scene = new THREE.Scene();
      const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
      const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
      quad.frustumCulled = false;
      scene.add(quad);
      runtime = { scene, camera, material, quad, layers: new Map() };
      runtimes.set(compositor, runtime);
    }
    return runtime;
  }

  // CPU fallback: the test reference raster, uploaded with mask row 0
  // (top) at v = 1, the same orientation the GPU camera renders. Used when
  // the feather exceeds the GPU loop bound, when a probe forces the CPU,
  // or when the GPU render throws. Cached by signature per layer.
  function cpuCoverageTexture(runtime, layer, scaled, size, signature) {
    let entry = runtime.layers.get(layer);
    if (!entry) {
      entry = { signature: null, texture: null };
      runtime.layers.set(layer, entry);
      if (runtime.layers.size > 8) {
        const oldest = runtime.layers.keys().next().value;
        if (oldest !== layer) {
          runtime.layers.get(oldest)?.texture?.dispose();
          runtime.layers.delete(oldest);
        }
      }
    }
    if (entry.signature !== signature) {
      const { data } = rasterizeCoverage(scaled, size.width, size.height);
      const rgba = new Uint8Array(data.length * 4);
      for (let i = 0; i < data.length; i++) {
        rgba[i * 4] = 255;
        rgba[i * 4 + 1] = 255;
        rgba[i * 4 + 2] = 255;
        rgba[i * 4 + 3] = data[i];
      }
      if (entry.texture) entry.texture.dispose();
      const texture = new THREE.DataTexture(rgba, size.width, size.height, THREE.RGBAFormat, THREE.UnsignedByteType);
      texture.minFilter = texture.magFilter = THREE.LinearFilter;
      texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
      texture.generateMipmaps = false;
      // Row 0 is the top of mask space; v = 1 samples the top.
      texture.flipY = true;
      texture.needsUpdate = true;
      entry.texture = texture;
      entry.signature = signature;
    }
    return entry.texture;
  }

  function applyMasks(compositor, effects, uvScale) {
    const layer = effects?.parentObject;
    if (!maskable(PZ, layer) || effects !== layer.effects) {
      return;
    }
    const masks = layer[FIELD];
    if (!Array.isArray(masks) || !masks.length) {
      return;
    }
    // Layer Input stage policy (install-order independent): layer masks
    // belong to the default "Effects & Masks" stage only. "effects-masks"
    // is DEFAULT_SOURCE_MODE in plugins/layer-input/layer-input-state.js;
    // any other stage skips here so "Masks" and "Source" captures match
    // regardless of which plugin wrapped renderEffects last.
    const stage = compositor ? compositor.__zoidiumLayerInputMode : null;
    if (stage && stage !== "effects-masks") {
      return;
    }
    const frame = maskFrameFor(layer);
    if (typeof frame !== "number" || !Number.isFinite(frame)) {
      return;
    }
    let evaluated;
    try {
      evaluated = evaluateMasks(Content, masks, frame);
    } catch (error) {
      warnOnce(layer, error.message);
      return;
    }
    if (!evaluated.length || evaluated.every(mask => !mask.enabled)) {
      return;
    }
    let resolution = [0, 0];
    try {
      resolution = layer.properties.resolution.get();
    } catch (_error) {
      return;
    }
    const size = coverageSize(resolution);
    const scaled = scaleEvaluated(evaluated, size.scale);
    const signature = signatureOf(scaled, size.width, size.height);
    const runtime = runtimeFor(compositor);
    let coverage = null;
    try {
      coverage = sharedGpu(THREE).coverageTexture(compositor.renderer, scaled, size.width, size.height, signature);
    } catch (_error) {
      coverage = null;
    }
    if (!coverage) coverage = cpuCoverageTexture(runtime, layer, scaled, size, signature);
    const readBuffer = compositor.readBuffer, writeBuffer = compositor.writeBuffer;
    const width = readBuffer.width, height = readBuffer.height;
    const s = Math.min(Math.max(1, Math.round(uvScale.x * width)), width);
    const n = Math.min(Math.max(1, Math.round(uvScale.y * height)), height);
    runtime.material.uniforms.tDiffuse.value = readBuffer.texture;
    runtime.material.uniforms.tMask.value = coverage;
    runtime.material.uniforms.uvScale.value.set(s / width, n / height);
    writeBuffer.viewport.set(0, 0, s, n);
    compositor.renderer.render(runtime.scene, runtime.camera, writeBuffer, true);
    compositor.swapBuffers();
  }

  const disposers = [];
  function method(prototype, name, wrap) {
    const original = prototype[name];
    const replacement = wrap(original);
    prototype[name] = replacement;
    disposers.push(() => {
      if (prototype[name] === replacement) prototype[name] = original;
    });
  }

  if (PZ.compositor?.prototype?.renderEffects) {
    method(PZ.compositor.prototype, "renderEffects", original => {
      function renderEffectsWithMasks(effects, width, height) {
        const result = original.apply(this, arguments);
        try {
          applyMasks(this, effects, { x: width, y: height });
        } catch (error) {
          warnOnce(null, error.message);
        }
        return result;
      }
      renderEffectsWithMasks.__zoidiumLayerMask = true;
      return renderEffectsWithMasks;
    });
  }
  if (PZ.layer?.prototype?.update) {
    method(PZ.layer.prototype, "update", original => {
      function updateWithMaskFrame(time) {
        try {
          this[FRAME_KEY] = time;
        } catch (_error) {
          /* Detached or sealed layer: masks evaluate when a frame is known. */
        }
        return original.apply(this, arguments);
      }
      updateWithMaskFrame.__zoidiumLayerMask = true;
      return updateWithMaskFrame;
    });
  }
  if (PZ.compositor?.prototype?.unload) {
    method(PZ.compositor.prototype, "unload", original => {
      function unloadWithMaskRuntime() {
        const runtime = runtimes.get(this);
        if (runtime) {
          for (const entry of runtime.layers.values()) entry.texture?.dispose();
          runtime.layers.clear();
          runtime.quad.geometry.dispose();
          runtime.material.dispose();
          runtimes.delete(this);
        }
        try {
          if (this && this.renderer && THREE && THREE.WebGLRenderTarget) sharedGpu(THREE).disposeRenderer(this.renderer);
        } catch (_error) { /* GPU teardown is best effort. */ }
        return original.apply(this, arguments);
      }
      unloadWithMaskRuntime.__zoidiumLayerMask = true;
      return unloadWithMaskRuntime;
    });
  }

  onDispose(() => {
    for (const dispose of disposers.reverse()) {
      try {
        dispose();
      } catch (_error) {
        /* Another plugin already restored its own wrapper. */
      }
    }
    try {
      if (THREE && THREE.WebGLRenderTarget) {
        const gpu = sharedGpu(THREE);
        for (const renderer of renderers) {
          try {
            gpu.disposeRenderer(renderer);
          } catch (_error) { /* GPU teardown is best effort. */ }
        }
      }
    } catch (_error) { /* GPU teardown is best effort. */ }
    renderers.clear();
  });

  return { applyMasks, evaluateMasks, coverageSize, samplePoints, maskFrameFor };
}

module.exports = { installMaskRender, coverageSize, evaluateMasks, maskable, maskFrameFor, MAX_COVERAGE_SIDE };
