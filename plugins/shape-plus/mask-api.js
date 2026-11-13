"use strict";
// Cross-plugin mask API for Shader+ (and future emitter effects).
//
// Published as PZ.zoidium.layerMask. All evaluation reads the persisted mask
// JSON through throwaway Content items, so shader sampling never depends on
// editor selection or gesture state. A reference that cannot be resolved
// (deleted layer, deleted mask, no frame) yields null and the caller renders
// an empty input with a visible warning; path sampling cannot recurse into
// rendering, so cyclic references cannot occur by construction.
const { FIELD, validateMasks, samplePoints, toUV, evaluateMask, parseReference, formatReference, MAX_POINTS } = require("./mask-model.js");
const { rasterizeCoverage } = require("./mask-raster.js");
const { primitivePath } = require("./primitives.js");

// Long-side cap for shader coverage rasters. Linear filtering keeps feather
// smooth; hard edges lose sub-pixel crispness above the cap only.
const MAX_SHADER_SIDE = 1024;

// Clip-local frame of the source path for a shader evaluated at its own
// local frame. Both clips share project time.
function toSourceFrame(shaderFrame, shaderClip, sourceClip) {
  const projectFrame = shaderFrame + (shaderClip?.start || 0) - (shaderClip?.offset || 0);
  return projectFrame - (sourceClip?.start || 0) + (sourceClip?.offset || 0);
}

function coverageSize(resolution) {
  const width = Math.max(1, Math.round(resolution[0] || 0));
  const height = Math.max(1, Math.round(resolution[1] || 0));
  const scale = Math.min(1, MAX_SHADER_SIDE / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)), scale };
}

function installMaskApi({ PZ, Content, onDispose }) {
  function layerResolution(layer) {
    try {
      const resolution = layer?.properties?.resolution?.get?.();
      if (Array.isArray(resolution) && resolution[0] > 0 && resolution[1] > 0) return [resolution[0], resolution[1]];
    } catch (_error) { /* Detached layer. */ }
    return null;
  }
  // Shape+ layers expose their vector contents; other layers have none.
  function shapePaths(layer) {
    const contents = Array.isArray(layer?.contents) ? layer.contents : [];
    const paths = [];
    (function walk(list) {
      for (const item of list || []) {
        if (!item || typeof item !== "object") continue;
        if (item.kind === "path") paths.push(item);
        if (Array.isArray(item.contents)) walk(item.contents);
      }
    })(contents);
    return paths;
  }
  function evaluateShapePath(item, frame) {
    const evaluated = typeof item.evaluate === "function" ? item.evaluate(frame) : null;
    if (!evaluated || !evaluated.properties) throw Error("Shape+ path is not evaluatable");
    const path = primitivePath(evaluated);
    return { vertices: path.vertices, closed: path.closed, name: evaluated.properties.name };
  }
  function evaluateReference(project, reference, frame) {
    // Frame is the SOURCE clip-local frame; the caller maps its own frame
    // with toSourceFrame. Returns null for anything unresolvable so the
    // caller renders an empty input with a visible warning.
    const ref = typeof reference === "string" ? parseReference(reference) : reference;
    if (!ref || !project || typeof frame !== "number" || !Number.isFinite(frame)) return null;
    let clip = null;
    try {
      const found = Array.isArray(ref.clip) ? project.addressLookup(ref.clip) : null;
      clip = found && found.object ? found : null;
    } catch (_error) {
      return null;
    }
    if (!clip) return null;
    const layer = clip.object;
    const resolution = layerResolution(layer) || [0, 0];
    if (!(resolution[0] > 0 && resolution[1] > 0)) return null;
    let evaluated, name;
    if (ref.source === "mask") {
      const masks = layer?.[FIELD];
      if (!Array.isArray(masks)) return null;
      let data;
      try {
        validateMasks(masks);
        data = masks.find(m => m.id === ref.mask);
      } catch (_error) {
        return null;
      }
      if (!data) return null;
      let item;
      try {
        item = new Content(data.kind, data);
        item.load(data);
        evaluated = { ...evaluateMask(item, frame), mode: "add", feather: data.feather || 0, opacity: data.opacity === undefined ? 1 : data.opacity, invert: !!data.invert, enabled: data.enabled !== false && data.enabled !== 0 };
      } catch (_error) {
        return null;
      }
      if (!evaluated.enabled) return null;
      name = evaluated.name;
    } else if (ref.source === "shape") {
      const item = shapePaths(layer).find(p => p.id === ref.path);
      if (!item) return null;
      try {
        evaluated = { ...evaluateShapePath(item, frame), mode: "add", feather: 0, opacity: 1, invert: false };
      } catch (_error) {
        return null;
      }
      name = evaluated.name;
    } else {
      return null;
    }
    const size = coverageSize(resolution);
    const scale = size.scale;
    const scaled = {
      ...evaluated,
      vertices: evaluated.vertices.map(v => ({ point: [v.point[0] * scale, v.point[1] * scale], in: [v.in[0] * scale, v.in[1] * scale], out: [v.out[0] * scale, v.out[1] * scale] })),
      feather: (evaluated.feather || 0) * scale,
    };
    let coverage;
    try {
      coverage = rasterizeCoverage([scaled], size.width, size.height);
    } catch (_error) {
      return null;
    }
    const sampled = samplePoints(evaluated, MAX_POINTS);
    const signature = JSON.stringify([ref.source, ref.mask || ref.path, size.width, size.height,
      sampled.length.toFixed(3), sampled.points.map(p => [Math.round(p[0] * 1000) / 1000, Math.round(p[1] * 1000) / 1000])]);
    return {
      name: typeof name === "string" ? name : "",
      width: resolution[0], height: resolution[1],
      points: sampled.points, length: sampled.length, closed: sampled.closed,
      coverage, signature,
    };
  }
  function listSources(project) {
    const sources = [];
    let tracks = [];
    try {
      tracks = project?.sequence?.videoTracks || [];
    } catch (_error) {
      return sources;
    }
    tracks.forEach((track, trackIndex) => {
      for (const clip of track?.clips || []) {
        const layer = clip?.object;
        if (!layer) continue;
        const address = typeof clip.getAddress === "function" ? (() => { try { return clip.getAddress(); } catch (_error) { return null; } })() : null;
        const layerName = (() => { try { return String(layer.properties?.name?.get?.() || layer.defaultName || "Layer"); } catch (_error) { return "Layer"; } })();
        if ((layer instanceof PZ.layer.scene || layer instanceof PZ.layer.adjustment) && Array.isArray(layer[FIELD]) && layer[FIELD].length) {
          let masks = [];
          try {
            validateMasks(layer[FIELD]);
            masks = layer[FIELD].map(m => ({ id: m.id, name: String(m.properties?.name || m.id) }));
          } catch (_error) { /* Corrupt masks are hidden until fixed. */ }
          if (masks.length) sources.push({ kind: "mask", track: trackIndex, clip: address, layer: layerName, masks });
        }
        const paths = shapePaths(layer).map(p => {
          let name = p.id;
          try { name = String(p.properties?.name?.get?.() || p.id); } catch (_error) { /* Detached item. */ }
          return { id: p.id, name };
        });
        if (paths.length) sources.push({ kind: "shape", track: trackIndex, clip: address, layer: layerName, paths });
      }
    });
    return sources;
  }
  const apiValue = { evaluateReference, listSources, toUV, toSourceFrame, parseReference, formatReference, coverageSize, MAX_POINTS, FIELD };
  if (PZ.zoidium) PZ.zoidium.layerMask = apiValue;
  onDispose(() => {
    if (PZ.zoidium && PZ.zoidium.layerMask === apiValue) delete PZ.zoidium.layerMask;
  });
  return apiValue;
}

module.exports = { installMaskApi, toSourceFrame, coverageSize, MAX_SHADER_SIDE };
