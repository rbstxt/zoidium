"use strict";

// ExpressText+ Text layout, tracking and repeater specs.

const { MAX_ANCESTOR_DEPTH, REPEATER_MAX_COPIES } = require("./expresstext-constants.js");
const { numberValue, vector3 } = require("./expresstext-select.js");
const { hashLattice } = require("./expresstext-random.js");
const { readProp, readVector } = require("./expresstext-eval.js");

/* ------------------------------------------------------------- tracking */

// Same UTF-16 unit walk as the native TextGeometry layout so split letters
// sit exactly where the untouched text would.
function getExpressLayout(text, fontData, size, spacing) {
  const data = fontData && typeof fontData === "object" ? fontData : {};
  const resolution = numberValue(data.resolution, 1000);
  const scale = resolution !== 0 ? numberValue(size, 100) / resolution : 0;
  const characterSpacing = numberValue(spacing, 0);
  const bounds = data.boundingBox || {};
  const lineHeight =
    (numberValue(bounds.yMax, 0) -
      numberValue(bounds.yMin, 0) +
      numberValue(data.underlineThickness, 0)) *
    scale;
  const glyphs = data.glyphs || {};
  const characters = String(text == null ? "" : text).split("");
  const units = [];
  let cursorX = 0;
  let cursorY = 0;
  for (let sourceIndex = 0; sourceIndex < characters.length; sourceIndex += 1) {
    const character = characters[sourceIndex];
    if (character === "\n") {
      cursorX = 0;
      cursorY -= lineHeight;
      continue;
    }
    const glyph = glyphs[character] || glyphs["?"] || null;
    const advance = glyph ? numberValue(glyph.ha, 0) * scale : 0;
    units.push({
      character,
      sourceIndex,
      index: units.length,
      x: cursorX,
      y: cursorY,
      advance,
    });
    cursorX += advance + characterSpacing;
  }
  return { units, count: units.length, lineHeight };
}

function getExpressCenterOffset(bounds, positionMode) {
  if (!bounds || !bounds.min || !bounds.max) return [0, 0, 0];
  const minimum = vector3(bounds.min, [0, 0, 0]);
  const maximum = vector3(bounds.max, [0, 0, 0]);
  const offset = [
    -(minimum[0] + maximum[0]) / 2,
    -(minimum[1] + maximum[1]) / 2,
    -(minimum[2] + maximum[2]) / 2,
  ];
  // Same anchor modes as the native 3D Text: 0 centered, 1/4/6 keep one
  // axis unshifted, 2/3/5 double the shift on one axis.
  switch (Math.round(numberValue(positionMode, 0))) {
    case 1:
      offset[0] = 0;
      break;
    case 2:
      offset[0] *= 2;
      break;
    case 3:
      offset[1] *= 2;
      break;
    case 4:
      offset[1] = 0;
      break;
    case 5:
      offset[2] *= 2;
      break;
    case 6:
      offset[2] = 0;
      break;
    default:
      break;
  }
  return offset;
}

function getExpressTextCenter(bounds, centerOffset) {
  if (!bounds || !bounds.min || !bounds.max) return [0, 0, 0];
  const minimum = vector3(bounds.min, [0, 0, 0]);
  const maximum = vector3(bounds.max, [0, 0, 0]);
  const offset = vector3(centerOffset, [0, 0, 0]);
  return minimum.map(
    (value, index) => (value + maximum[index]) / 2 + offset[index]
  );
}

function propertyValue(property, frame, fallback) {
  if (!property || typeof property.get !== "function") return fallback;
  const value = property.get(frame);
  return value === undefined ? fallback : value;
}

function getAncestorObject(object) {
  if (!object) return null;
  try {
    return object.parentObject || null;
  } catch (_error) {
    return null;
  }
}

// Ancestor layers above a Text, outermost first: the tracking container
// plus every ExpressText+ effector stacked over it. Bails out (returns [])
// when a Text+ container owns the text, so the two trackers never fight.
function collectExpressObjects(textObject) {
  const layers = [];
  const visited = new Set();
  let current = getAncestorObject(textObject);
  for (let depth = 0; current && depth < MAX_ANCESTOR_DEPTH; depth += 1) {
    if (visited.has(current)) break;
    visited.add(current);
    if (current.zoidiumTextPlusObject === true) return [];
    if (current.zoidiumExpressTextObject === true || current.zoidiumExpressEffector) {
      layers.push(current);
    }
    current = getAncestorObject(current);
  }
  layers.reverse();
  return layers;
}

function expressContainerOf(layers) {
  for (let i = layers.length - 1; i >= 0; i -= 1) {
    if (layers[i].zoidiumExpressTextObject === true) return layers[i];
  }
  return null;
}

function expressStackOf(layers) {
  const stack = [];
  const seen = new Set();
  const pushLayer = (kind, props, source) => {
    if (!kind || seen.has(props)) return;
    seen.add(props);
    stack.push({ kind, props, source });
  };
  // Ancestor effectors first (outer to inner), then the container's own
  // children in list order: the whole stack lives in the one group, with
  // picker-stacked ancestors still honored.
  for (const layer of layers) {
    if (layer.zoidiumExpressEffector) {
      pushLayer(layer.zoidiumExpressEffector, getExpressProperties(layer), layer);
    }
  }
  const container = expressContainerOf(layers);
  try {
    const children = container && container.objects;
    const count = (children && children.length) || 0;
    for (let i = 0; i < count; i += 1) {
      const child = children[i];
      if (child && child.zoidiumExpressEffector) {
        pushLayer(child.zoidiumExpressEffector, getExpressProperties(child), child);
      }
    }
  } catch (_children) {}
  return stack;
}

function getExpressProperties(container) {
  return container.expressProperties || container.properties || {};
}

function finiteBox(geometry) {
  if (!geometry || typeof geometry.computeBoundingBox !== "function") return null;
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  if (
    !box ||
    !box.min ||
    !box.max ||
    !Number.isFinite(box.min.x) ||
    !Number.isFinite(box.min.y) ||
    !Number.isFinite(box.min.z) ||
    !Number.isFinite(box.max.x) ||
    !Number.isFinite(box.max.y) ||
    !Number.isFinite(box.max.z)
  ) {
    return null;
  }
  return {
    min: [box.min.x, box.min.y, box.min.z],
    max: [box.max.x, box.max.y, box.max.z],
  };
}

/* ------------------------------------------------- repeater copies */

// Per repeater layer: allocation counts + live row values for this frame.
// The section contributes nothing to letter controls (it multiplies
// geometry instead); the renderer reads these specs to place ghosts.
function repeaterSpecsFor(stack, frame) {
  const out = [];
  for (const layer of stack || []) {
    if (!layer || layer.kind !== "repeater") continue;
    const props = layer.props;
    const enabled = !!numberValue(readProp(props, "repeaterEnable", frame, 1), 1);
    const copies = enabled
      ? Math.max(
          0,
          Math.min(
            REPEATER_MAX_COPIES,
            Math.floor(numberValue(readProp(props, "repeaterCopies", frame, 3), 3))
          )
        )
      : 0;
    out.push({
      layer,
      source: layer.source,
      copies,
      mode: Math.round(numberValue(readProp(props, "repeaterMode", frame, 0), 0)),
      offset: readVector(props, "repeaterOffset", frame, [10, 0, 0]),
      rangeMin: readVector(props, "repeaterRangeMin", frame, [-10, -10, -10]),
      rangeMax: readVector(props, "repeaterRangeMax", frame, [10, 10, 10]),
      seed: readProp(props, "repeaterSeed", frame, 1),
      lag: Math.max(0, numberValue(readProp(props, "repeaterLag", frame, 2), 2)),
      fade: Math.min(
        1,
        Math.max(0, numberValue(readProp(props, "repeaterFade", frame, 50), 50) / 100)
      ),
    });
  }
  return out;
}

// Raw copy offset (unweighted; the caller scales by letter weight):
// Linear steps the Offset per slot, Random scatters deterministically in
// the range volume, Echo smears along the letter's velocity (still
// letters show no spread). slot is 1-based.
function repeaterCopyOffset(spec, letterIndex, slot, velocity) {
  if (spec.mode === 2) {
    const v = velocity || [0, 0, 0];
    return [-v[0] * spec.lag * slot, -v[1] * spec.lag * slot, -v[2] * spec.lag * slot];
  }
  if (spec.mode === 1) {
    const seedInt = Math.round(numberValue(spec.seed, 1) * 1000);
    const out = [0, 0, 0];
    for (let axis = 0; axis < 3; axis += 1) {
      const u = hashLattice(letterIndex, slot * 57 + 11, axis * 131 + 7, seedInt);
      out[axis] = spec.rangeMin[axis] + (spec.rangeMax[axis] - spec.rangeMin[axis]) * u;
    }
    return out;
  }
  return [spec.offset[0] * slot, spec.offset[1] * slot, spec.offset[2] * slot];
}

function repeaterCopyOpacity(spec, slot) {
  if (!(spec.copies > 0)) return 1;
  return Math.min(1, Math.max(0, 1 - spec.fade * (slot / spec.copies)));
}

function copyMeshState(source, target) {
  if (!source || !target) return;
  target.material = source.material;
  target.castShadow = source.castShadow;
  target.receiveShadow = source.receiveShadow;
  target.visible = source.visible;
  target.frustumCulled = source.frustumCulled;
  target.renderOrder = source.renderOrder;
  target.renderDepth = source.renderDepth;
  target.customDepthMaterial = source.customDepthMaterial;
  target.customDistanceMaterial = source.customDistanceMaterial;
  if (source.layers && target.layers) target.layers.mask = source.layers.mask;
}

function createLetterShapes(THREE, font, character, size) {
  const data = font && font.data;
  if (!data) {
    return typeof font?.generateShapes === "function"
      ? font.generateShapes(character, size, 8)
      : [];
  }
  if (!THREE?.ShapePath) return [];
  const resolution = numberValue(data.resolution, 1000);
  const scale = resolution !== 0 ? numberValue(size, 100) / resolution : 0;
  const glyphs = data.glyphs || {};
  const glyph = glyphs[character] || glyphs["?"];
  if (!glyph || !glyph.o) return [];
  const path = new THREE.ShapePath();
  const outline = glyph._cachedOutline || (glyph._cachedOutline = glyph.o.split(" "));
  for (let index = 0; index < outline.length; ) {
    const action = outline[index++];
    const next = (count) => {
      const out = [];
      for (let k = 0; k < count; k += 1) out.push(numberValue(outline[index++], 0) * scale);
      return out;
    };
    if (action === "m") {
      const [x, y] = next(2);
      path.moveTo(x, y);
    } else if (action === "l") {
      const [x, y] = next(2);
      path.lineTo(x, y);
    } else if (action === "q") {
      const [cpx, cpy, cpx1, cpy1] = next(4);
      path.quadraticCurveTo(cpx1, cpy1, cpx, cpy);
    } else if (action === "b") {
      const [cpx, cpy, cpx1, cpy1, cpx2, cpy2] = next(6);
      path.bezierCurveTo(cpx1, cpy1, cpx2, cpy2, cpx, cpy);
    }
  }
  return path.toShapes();
}

module.exports = { collectExpressObjects, copyMeshState, createLetterShapes, expressContainerOf, expressStackOf, finiteBox, getAncestorObject, getExpressCenterOffset, getExpressLayout, getExpressProperties, getExpressTextCenter, propertyValue, repeaterCopyOffset, repeaterCopyOpacity, repeaterSpecsFor };
