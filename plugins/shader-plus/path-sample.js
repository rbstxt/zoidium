"use strict";
// Shader+ Path properties: a layer mask or Shape+ path as shader input.
//
// Each Path property holds TEXT JSON referencing a mask or a Shape+ path.
// Per frame the stage evaluates the path through the shape-plus layerMask
// API and binds four uniforms: <Name>Coverage (coverage in shader UV space),
// <Name>Points (256 equally spaced points, xy in UV), <Name>Length (path
// length in u units) and <Name>Count (sampled point count, 0 when missing).
// A missing or deleted source binds an empty input and reports a visible
// shader error; sampling never renders, so cyclic references cannot occur.
const { kindOf } = require("./kinds.js");

const POINTS_COUNT = 256;

function propertiesOf(effect) {
  return Array.from(effect.customProperties || []).filter(p => kindOf(p) === "path");
}

function installPathSampling({ PZ, THREE, patch, pipeline, onDispose, editor, report }) {
  const entries = new WeakMap(), live = new Set();
  const warned = new Set();
  function layerMask() {
    return (PZ && PZ.zoidium && PZ.zoidium.layerMask) || null;
  }
  function renderer() {
    try {
      return editor()?.mainViewport?.renderer || null;
    } catch (_error) {
      return null;
    }
  }
  function floatSupported() {
    const gl = renderer()?.extensions;
    return !!(gl && gl.get && gl.get("OES_texture_float"));
  }
  function emptyCoverage() {
    const texture = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
    texture.minFilter = texture.magFilter = THREE.NearestFilter;
    texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.generateMipmaps = false;
    texture.needsUpdate = true;
    return texture;
  }
  function entryFor(effect, property) {
    let entry = entries.get(property);
    if (!entry) {
      entry = { key: null, effect, warned: new Set(), coverage: emptyCoverage(), points: null, length: 0, count: 0, useFloat: true };
      entries.set(property, entry);
      live.add(property);
    }
    entry.effect = effect;
    return entry;
  }
  function pointsTexture(useFloat) {
    const data = useFloat ? new Float32Array(POINTS_COUNT * 4) : new Uint8Array(POINTS_COUNT * 4);
    data[3] = useFloat ? 1 : 255;
    const texture = new THREE.DataTexture(data, POINTS_COUNT, 1, THREE.RGBAFormat, useFloat ? THREE.FloatType : THREE.UnsignedByteType);
    texture.minFilter = texture.magFilter = THREE.NearestFilter;
    texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.generateMipmaps = false;
    texture.needsUpdate = true;
    return texture;
  }
  function projectOf(effect) {
    try {
      return effect.parentProject || null;
    } catch (_error) {
      return null;
    }
  }
  function clipOf(layer) {
    try {
      return (layer && layer.tryGetParentOfType(PZ.clip)) || null;
    } catch (_error) {
      return null;
    }
  }
  function warn(effect, property, message) {
    const key = property + ": " + message;
    if (!warned.has(key)) {
      warned.add(key);
      report(effect, message);
    }
  }
  // The caller's frame is the effect owner's clip-local frame; map it onto
  // the source clip through shared project time.
  function sourceFrame(effect, ref, frame) {
    const api = layerMask();
    if (!api || ref == null || ref.clip == null) return frame;
    const project = projectOf(effect);
    let sourceClip = null, shaderClip = null;
    try {
      const found = project?.addressLookup?.(ref.clip);
      sourceClip = found && found.object ? found : null;
    } catch (_error) {
      sourceClip = null;
    }
    try {
      shaderClip = clipOf(effect.parentLayer);
    } catch (_error) {
      shaderClip = null;
    }
    if (!sourceClip || !shaderClip) return frame;
    return api.toSourceFrame(frame, shaderClip, sourceClip);
  }
  function refresh(effect, property, frame) {
    const entry = entryFor(effect, property);
    const api = layerMask();
    const fail = message => {
      if (entry.key !== "missing:" + message) {
        entry.key = "missing:" + message;
        entry.coverage.dispose();
        entry.coverage = emptyCoverage();
        if (entry.points) entry.points.dispose();
        entry.points = pointsTexture(false);
        entry.length = 0;
        entry.count = 0;
      }
      warn(effect, property, message);
      return entry;
    };
    if (!api) return fail("Path inputs need the Shape+ plugin enabled");
    let ref = null;
    try {
      ref = api.parseReference(property.get());
    } catch (_error) {
      ref = null;
    }
    if (!ref) return fail("Choose a mask or Shape+ path for " + property.properties.name.get());
    const project = projectOf(effect);
    if (!project) return fail("Path input has no project");
    let evaluated = null;
    try {
      evaluated = api.evaluateReference(project, ref, sourceFrame(effect, ref, frame));
    } catch (error) {
      return fail(error.message || "Path evaluation failed");
    }
    if (!evaluated) {
      const label = ref.source === "mask" ? "Mask " + (ref.mask || "?") : "Path " + (ref.path || "?");
      return fail(label + " is missing or deleted");
    }
    const uv = api.toUV(evaluated.points, evaluated.width, evaluated.height);
    const key = evaluated.signature;
    const useFloat = floatSupported();
    if (!useFloat && entry.useFloat !== false) warn(effect, property, "Float textures are unavailable; path points use 8-bit precision");
    if (entry.key !== key || entry.useFloat !== useFloat) {
      entry.coverage.dispose();
      const source = evaluated.coverage;
      const rgba = new Uint8Array(source.data.length * 4);
      for (let i = 0; i < source.data.length; i++) {
        rgba[i * 4] = 255;
        rgba[i * 4 + 1] = 255;
        rgba[i * 4 + 2] = 255;
        rgba[i * 4 + 3] = source.data[i];
      }
      const coverage = new THREE.DataTexture(rgba, source.width, source.height, THREE.RGBAFormat, THREE.UnsignedByteType);
      coverage.minFilter = coverage.magFilter = THREE.LinearFilter;
      coverage.wrapS = coverage.wrapT = THREE.ClampToEdgeWrapping;
      coverage.generateMipmaps = false;
      // Row 0 is the top of mask space; v = 1 samples the top.
      coverage.flipY = true;
      coverage.needsUpdate = true;
      entry.coverage = coverage;
      const useFloat = floatSupported();
      if (!useFloat && entry.useFloat !== false) warn(effect, property, "Float textures are unavailable; path points use 8-bit precision");
      entry.useFloat = useFloat;
      if (entry.points) entry.points.dispose();
      entry.points = pointsTexture(useFloat);
      const data = entry.points.image.data;
      for (let i = 0; i < POINTS_COUNT; i++) {
        const point = uv[Math.min(i, uv.length - 1)] || [0, 0];
        if (useFloat) {
          data[i * 4] = point[0];
          data[i * 4 + 1] = point[1];
          data[i * 4 + 2] = 0;
          data[i * 4 + 3] = 1;
        } else {
          data[i * 4] = Math.max(0, Math.min(255, Math.round(point[0] * 255)));
          data[i * 4 + 1] = Math.max(0, Math.min(255, Math.round(point[1] * 255)));
          data[i * 4 + 2] = 0;
          data[i * 4 + 3] = 255;
        }
      }
      entry.points.needsUpdate = true;
      entry.length = evaluated.width > 0 ? evaluated.length / evaluated.width : 0;
      entry.count = Math.min(uv.length, POINTS_COUNT);
      entry.useFloat = useFloat;
      entry.key = key;
    }
    return entry;
  }
  function bind(effect, property, entry) {
    const name = effect.fixPropertyName(property.properties.name.get());
    const uniforms = effect.pass.uniforms;
    uniforms[name + "Coverage"] = { type: "t", value: entry.coverage };
    uniforms[name + "Points"] = { type: "t", value: entry.points };
    uniforms[name + "Length"] = { type: "f", value: entry.length };
    uniforms[name + "Count"] = { type: "i", value: entry.count };
  }
  function dispose(property) {
    const entry = entries.get(property);
    if (!entry) return;
    entry.coverage?.dispose();
    entry.points?.dispose();
    entries.delete(property);
    live.delete(property);
  }
  onDispose(pipeline.register({
    id: "shader-plus-path",
    declare() {
      for (const property of propertiesOf(this)) {
        const entry = entryFor(this, property);
        if (entry.key === null) refresh(this, property, 0);
        bind(this, property, entry);
      }
    },
    previewDeclare() {
      // Diagnostics compile without textures; per-frame updates own them.
    },
    beforeUpdate(frame) {
      if (!propertiesOf(this).length) return;
      for (const property of propertiesOf(this)) bind(this, property, refresh(this, property, frame ?? 0));
    },
  }));
  const proto = PZ.effect.shader.prototype;
  patch(proto, "propertyRemoved", original => function propertyRemovedPath(property) {
    dispose(property);
    return original.apply(this, arguments);
  });
  patch(proto, "unload", original => function unloadPath() {
    for (const property of Array.from(live)) {
      const entry = entries.get(property);
      if (entry && entry.effect === this) dispose(property);
    }
    return original.apply(this, arguments);
  });
  onDispose(() => {
    for (const property of Array.from(live)) dispose(property);
    warned.clear();
  });
  return { refresh, propertiesOf };
}

module.exports = { installPathSampling, propertiesOf, POINTS_COUNT };
