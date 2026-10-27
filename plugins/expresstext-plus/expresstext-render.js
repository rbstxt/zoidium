"use strict";

// ExpressText+ Split-letter rendering and world transforms.

const { MAX_ANCESTOR_DEPTH, PZ_EULER_ORDERS, REPEATER_MAX_COPIES, state } = require("./expresstext-constants.js");
const { isLetterSelected, numberValue, vector3 } = require("./expresstext-select.js");
const { hashLattice } = require("./expresstext-random.js");
const { applyFieldWeight, letterContext, readProp, readVector } = require("./expresstext-eval.js");
const { rotateEulerXYZ, worldBaseOf } = require("./expresstext-effectors.js");
const { splitVoronoiCells, voronoiChunkPose } = require("./expresstext-voronoi.js");
const { evaluateStack, plainListsAt } = require("./expresstext-delay.js");
const { EFFECTOR_PIVOT_KEYS, rawArray, stackLayersFor } = require("./expresstext-sections.js");
const { collectExpressObjects, copyMeshState, createLetterShapes, expressContainerOf, finiteBox, getAncestorObject, getExpressCenterOffset, getExpressLayout, getExpressProperties, getExpressTextCenter, propertyValue, repeaterCopyOffset, repeaterCopyOpacity, repeaterSpecsFor } = require("./expresstext-layout.js");

function getSplitState(textObject) {
  let splitState = state.splitStates.get(textObject);
  if (splitState) return splitState;
  splitState = {
    signature: null,
    fullGeometry: null,
    emptyGeometry: null,
    lastExtrudeOptions: null,
    renderRoot: null,
    entries: [],
  };
  state.splitStates.set(textObject, splitState);
  state.splitTexts.add(textObject);
  return splitState;
}

function disposeExpressRendering(splitState) {
  if (!splitState) return;
  if (splitState.renderRoot?.parent) {
    splitState.renderRoot.parent.remove(splitState.renderRoot);
  }
  for (const entry of splitState.entries || []) {
    entry.geometry?.dispose?.();
    for (const copy of entry.copies || []) {
      try {
        if (copy.ownMaterial) copy.mesh.material?.dispose?.();
      } catch (_material) {}
    }
    for (const chunk of entry.chunks || []) {
      try {
        chunk.geometry?.dispose?.();
      } catch (_chunk) {}
    }
  }
  splitState.emptyGeometry?.dispose?.();
  splitState.renderRoot = null;
  splitState.entries = [];
  splitState.signature = null;
  splitState.repeatLayers = null;
  // lastExtrudeOptions survives on purpose: the next build reads it as
  // the fallback when the live mesh holds the empty swap (restore drops
  // the whole state instead).
}

function restoreExpressRendering(textObject) {
  const splitState = state.splitStates.get(textObject);
  if (!splitState) return;
  try {
    if (splitState.fullGeometry && textObject.threeObj) {
      splitState.emptyGeometry?.dispose?.();
      textObject.threeObj.geometry = splitState.fullGeometry;
    }
  } catch (_error) {}
  disposeExpressRendering(splitState);
  state.splitStates.delete(textObject);
  state.splitTexts.delete(textObject);
}

function expressSignature(textObject) {
  try {
    const text = propertyValue(textObject.properties?.text, 0, "");
    const size = propertyValue(textObject.properties?.size, 0, [20, 3]);
    const spacing = propertyValue(textObject.properties?.spacing, 0, 0);
    const font = textObject.font?.font3d;
    // Extrusion and centering ride the signature too: flipping bevel,
    // caps, detail or the center point rebuilds the letters with the
    // source geometry's current options instead of holding stale ones.
    // The preserved last build fills the gaps the empty swap leaves.
    const positionMode = propertyValue(textObject.properties?.positionMode, 0, 0);
    let splitState = null;
    try {
      splitState = state.splitStates.get(textObject) || null;
    } catch (_split) {}
    const extrude = sourceExtrudeOptions(textObject, splitState);
    return JSON.stringify([
      text,
      size,
      spacing,
      !!(font && font.data),
      positionMode,
      extrude,
    ]);
  } catch (_error) {
    return null;
  }
}

// BufferGeometry attribute with three.js version tolerance (r91 uses
// addAttribute, newer uses setAttribute); arrays ride Float32Array.
function setChunkAttribute(THREE, geometry, name, array, itemSize) {
  if (!array || !array.length || !geometry) return;
  try {
    const attribute = new THREE.BufferAttribute(new Float32Array(array), itemSize);
    if (typeof geometry.setAttribute === "function") geometry.setAttribute(name, attribute);
    else if (typeof geometry.addAttribute === "function") geometry.addAttribute(name, attribute);
  } catch (_attr) {}
}

// Flat triangle arrays for the splitter from either geometry flavor:
// live r91 letters are legacy Geometry (vertices/faces/faceVertexUvs),
// newer three (and the tests) hand BufferGeometry attributes. Returns
// { positions, normals, uvs } as plain arrays, or null.
function geometryTriangleArrays(geometry) {
  try {
    const attrs = geometry && geometry.attributes;
    if (attrs && attrs.position && attrs.position.array && attrs.position.array.length) {
      return {
        positions: attrs.position.array,
        normals: attrs.normal && attrs.normal.array ? attrs.normal.array : [],
        uvs: attrs.uv && attrs.uv.array ? attrs.uv.array : [],
      };
    }
    const vertices = geometry && geometry.vertices;
    const faces = geometry && geometry.faces;
    const hasFaces =
      vertices && faces && typeof vertices.length === "number" && typeof faces.length === "number";
    if (!hasFaces || !faces.length) return null;
    const uvLayer = geometry.faceVertexUvs && geometry.faceVertexUvs[0];
    const positions = [];
    const normals = [];
    const uvs = [];
    for (let f = 0; f < faces.length; f += 1) {
      const face = faces[f];
      const index = [face.a, face.b, face.c];
      for (const vi of index) {
        const v = vertices[vi];
        positions.push(v ? v.x : 0, v ? v.y : 0, v ? v.z : 0);
      }
      const vertexNormals =
        face.vertexNormals && face.vertexNormals.length === 3 ? face.vertexNormals : null;
      for (let k = 0; k < 3; k += 1) {
        const n = vertexNormals ? vertexNormals[k] : face.normal;
        normals.push(n ? n.x : 0, n ? n.y : 0, n ? n.z : 0);
      }
      const faceUvs = uvLayer && uvLayer[f];
      for (let k = 0; k < 3; k += 1) {
        const t = faceUvs && faceUvs[k];
        uvs.push(t ? t.x : 0, t ? t.y : 0);
      }
    }
    return { positions, normals, uvs };
  } catch (_geometry) {
    return null;
  }
}

// Euler angles from either a live THREE.Euler (.x/.y/.z/.order) or the
// test fake (.args); [x, y, z, order].
function eulerParts(euler) {
  if (!euler) return [0, 0, 0, "XYZ"];
  if (Array.isArray(euler.args) && euler.args.length >= 3) {
    return [euler.args[0], euler.args[1], euler.args[2], euler.args[3] || "XYZ"];
  }
  return [euler.x || 0, euler.y || 0, euler.z || 0, euler.order || "XYZ"];
}

// Extrude option keys we carry from the source geometry. Scalar-only:
// shapes/fonts stay out so the rebuild signature stays tiny.
const EXTRUDE_OPTION_KEYS = [
  "size",
  "height",
  "amount",
  "depth",
  "curveSegments",
  "detail",
  "steps",
  "bevelEnabled",
  "bevelThickness",
  "bevelSize",
  "bevelSizeInner",
  "bevelShift",
  "bevelSegments",
  "bevelDetail",
  "bevelRound",
  "bevelProfile",
  "bevelTension",
  "bevelOffset",
  "bevelSide",
];

// The source mesh's own extrusion settings for letter geometry, read from
// every shape the live geometry takes: Text+ builds ExtrudeGeometry
// (parameters.options with the full bevel/cap suite), stock TextGeometry
// keeps its construction options under parameters.parameters. The newest
// successful build stays as the final pool: after a build the live mesh
// holds our empty swap, and the signature must keep reading the options
// the letters were built from — never a change.
function sourceExtrudeOptions(textObject, splitState) {
  const out = {};
  try {
    const live =
      textObject && textObject.threeObj && textObject.threeObj.geometry;
    const last =
      splitState && splitState.lastExtrudeOptions;
    const pools = [];
    const params = live && live.parameters;
    if (params && typeof params === "object") {
      pools.push(params.options, params.parameters, params);
    }
    if (last && typeof last === "object") pools.push(last);
    for (const pool of pools) {
      if (!pool || typeof pool !== "object") continue;
      for (const key of EXTRUDE_OPTION_KEYS) {
        if (out[key] === undefined && pool[key] !== undefined) {
          out[key] = pool[key];
        }
      }
    }
    // r91 extrudes by `amount` (from TextGeometry `height`); map it when
    // the pools only carried the other name.
    if (out.amount === undefined && out.height !== undefined) out.amount = out.height;
    if (out.depth === undefined && out.amount !== undefined) out.depth = out.amount;
    // Fixed key order: the signature must read back byte-identical no
    // matter which pool carried each value.
    const normalized = {};
    for (const key of EXTRUDE_OPTION_KEYS) {
      if (out[key] !== undefined) normalized[key] = out[key];
    }
    return normalized;
  } catch (_options) {
    return {};
  }
}

function buildExpressRendering(textObject, splitState, repeatCounts, voronoiSpec) {
  const THREE = state.THREE;
  const sourceMesh = textObject.threeObj;
  const font = textObject.font?.font3d;
  if (!THREE || !sourceMesh || !font) return false;
  disposeExpressRendering(splitState);
  const rawText = propertyValue(textObject.properties?.text, 0, "");
  const rawSize = propertyValue(textObject.properties?.size, 0, [20, 3]);
  const size = Array.isArray(rawSize) ? numberValue(rawSize[0], 20) : 20;
  const depth = Array.isArray(rawSize) ? numberValue(rawSize[1], 3) : 3;
  const spacing = propertyValue(textObject.properties?.spacing, 0, 0);
  const layout = getExpressLayout(rawText, font.data, size, spacing);
  // Extrusion must match the native text exactly: reuse the source
  // geometry's own extrude options (amount/depth, bevel, caps, curve
  // segments) and only fall back to plain defaults when they are
  // unreadable. The picked (pre-default) options snapshot drives the
  // rebuild signature, so post-build frames read back exactly what the
  // build consumed — no key-set drift, no rebuild churn.
  const sourceOptions = sourceExtrudeOptions(textObject, splitState);
  const extrudeOptions = {
    amount: depth,
    depth,
    bevelEnabled: false,
    curveSegments: 6,
  };
  for (const key of Object.keys(sourceOptions)) {
    extrudeOptions[key] = sourceOptions[key];
  }
  const renderRoot = new THREE.Object3D();
  renderRoot.name = "ExpressText letters";
  const pending = [];
  try {
    for (const unit of layout.units) {
      const shapes = createLetterShapes(THREE, font, unit.character, size);
      if (!shapes.length) continue;
      const geometry = new THREE.ExtrudeGeometry(shapes, extrudeOptions);
      const box = finiteBox(geometry);
      if (!box) {
        geometry.dispose?.();
        continue;
      }
      pending.push({ unit, geometry, box });
    }
    if (!pending.length) {
      disposeExpressRendering(splitState);
      return false;
    }
    // Whole-text bounds first, so every anchor carries the native
    // positionMode centering and letters land where the untouched text is.
    const bounds = {
      min: [Infinity, Infinity, Infinity],
      max: [-Infinity, -Infinity, -Infinity],
    };
    for (const item of pending) {
      const box = item.box;
      bounds.min[0] = Math.min(bounds.min[0], box.min[0] + item.unit.x);
      bounds.min[1] = Math.min(bounds.min[1], box.min[1] + item.unit.y);
      bounds.min[2] = Math.min(bounds.min[2], box.min[2]);
      bounds.max[0] = Math.max(bounds.max[0], box.max[0] + item.unit.x);
      bounds.max[1] = Math.max(bounds.max[1], box.max[1] + item.unit.y);
      bounds.max[2] = Math.max(bounds.max[2], box.max[2]);
      bounds.empty = false;
    }
    const positionMode = propertyValue(textObject.properties?.positionMode, 0, 0);
    const centerOffset = getExpressCenterOffset(bounds, positionMode);
    const entries = [];
    for (const item of pending) {
      const box = item.box;
      const unit = item.unit;
      const cx = (box.min[0] + box.max[0]) / 2;
      const cy = (box.min[1] + box.max[1]) / 2;
      const anchor = new THREE.Object3D();
      anchor.name = `Letter ${unit.index + 1}`;
      anchor.position.set(
        unit.x + cx + centerOffset[0],
        unit.y + cy + centerOffset[1],
        (box.min[2] + box.max[2]) / 2 + centerOffset[2]
      );
      const mesh = new THREE.Mesh(item.geometry, sourceMesh.material);
      mesh.name = unit.character;
      mesh.position.set(-cx, -cy, -(box.min[2] + box.max[2]) / 2);
      copyMeshState(sourceMesh, mesh);
      anchor.add(mesh);
      renderRoot.add(anchor);
      entries.push({
        index: unit.index,
        count: layout.count,
        character: unit.character,
        geometry: item.geometry,
        anchor,
        mesh,
        base: [anchor.position.x, anchor.position.y, anchor.position.z],
        copies: [],
        chunks: [],
        chunkCenter: [cx, cy, (box.min[2] + box.max[2]) / 2],
      });
      // Repeater ghosts: extra meshes sharing the letter geometry, placed
      // per frame by updateExpressRendering. Materials clone once here so
      // per-copy fade never touches the shared source material.
      const copyCounts = Array.isArray(repeatCounts) ? repeatCounts : [];
      const entry = entries[entries.length - 1];
      for (let ri = 0; ri < copyCounts.length; ri += 1) {
        const total = Math.max(
          0,
          Math.min(REPEATER_MAX_COPIES, Math.floor(numberValue(copyCounts[ri], 0)))
        );
        for (let slot = 1; slot <= total; slot += 1) {
          const node = new THREE.Object3D();
          node.name = `Letter ${unit.index + 1} copy ${slot}`;
          const mesh = new THREE.Mesh(item.geometry, sourceMesh.material);
          mesh.name = `${unit.character}#${slot}`;
          mesh.position.set(-cx, -cy, -(box.min[2] + box.max[2]) / 2);
          copyMeshState(sourceMesh, mesh);
          let ownMaterial = false;
          try {
            if (sourceMesh.material && typeof sourceMesh.material.clone === "function") {
              mesh.material = sourceMesh.material.clone();
              mesh.material.transparent = true;
              ownMaterial = true;
            }
          } catch (_clone) {}
          node.add(mesh);
          renderRoot.add(node);
          entry.copies.push({ node, mesh, ownMaterial, ri, slot });
        }
      }
      // Voronoi chunks from the first layer asking for them: partition
      // the letter geometry once here; motion sums per frame below.
      // Chunk meshes share no geometry (each owns its triangles).
      const triangleArrays = voronoiSpec ? geometryTriangleArrays(item.geometry) : null;
      if (triangleArrays && triangleArrays.positions.length >= 9) {
        const cells = splitVoronoiCells(
          triangleArrays.positions,
          triangleArrays.normals,
          triangleArrays.uvs,
          voronoiSpec.chunks,
          voronoiSpec.seed
        );
        const seedInt = Math.round(numberValue(voronoiSpec.seed, 1) * 1000);
        for (let ci = 0; ci < cells.length; ci += 1) {
          const cell = cells[ci];
          const geometry = new THREE.BufferGeometry();
          setChunkAttribute(THREE, geometry, "position", cell.position, 3);
          setChunkAttribute(THREE, geometry, "normal", cell.normal, 3);
          setChunkAttribute(THREE, geometry, "uv", cell.uv, 2);
          const mesh = new THREE.Mesh(geometry, sourceMesh.material);
          mesh.name = `${unit.character}+${ci}`;
          mesh.position.set(-cx, -cy, -(box.min[2] + box.max[2]) / 2);
          copyMeshState(sourceMesh, mesh);
          const node = new THREE.Object3D();
          node.name = `Letter ${unit.index + 1} chunk ${ci}`;
          node.add(mesh);
          renderRoot.add(node);
          entry.chunks.push({
            node,
            mesh,
            geometry,
            center: cell.center,
            sign: [0, 1, 2].map((ax) =>
              hashLattice(ci, unit.index * 131 + ax * 17, seedInt) > 0.5 ? 1 : -1
            ),
          });
        }
      }
    }
    if (sourceMesh.parent) sourceMesh.parent.add(renderRoot);
    else if (sourceMesh.add) sourceMesh.add(renderRoot);
    splitState.fullGeometry = splitState.fullGeometry || sourceMesh.geometry;
    if (!splitState.emptyGeometry && typeof THREE.BufferGeometry === "function") {
      splitState.emptyGeometry = new THREE.BufferGeometry();
    }
    if (splitState.emptyGeometry) sourceMesh.geometry = splitState.emptyGeometry;
    splitState.lastExtrudeOptions = { ...sourceOptions };
    splitState.renderRoot = renderRoot;
    splitState.entries = entries;
    splitState.textCenter = getExpressTextCenter(bounds, centerOffset);
    splitState.signature = expressSignature(textObject);
    return true;
  } catch (_error) {
    disposeExpressRendering(splitState);
    return false;
  }
}

function applyLetterTransform(THREE, node, base, controls, pivotPoint, eulerOrder) {
  const order = PZ_EULER_ORDERS.has(eulerOrder) ? eulerOrder : "XYZ";
  const euler = new THREE.Euler(controls.rotation[0], controls.rotation[1], controls.rotation[2], order);
  const pivot = pivotPoint || base;
  const centered =
    pivot[0] === base[0] && pivot[1] === base[1] && pivot[2] === base[2];
  let v;
  if (centered) {
    // Character pivot: the rotation spins the letter inside its position
    // offset (in place), so scattered letters turn without swinging out
    // of the text. Scale still rides the offset, as before.
    v = new THREE.Vector3(
      pivot[0] + controls.position[0] * controls.scale[0],
      pivot[1] + controls.position[1] * controls.scale[1],
      pivot[2] + controls.position[2] * controls.scale[2]
    );
  } else {
    // Text pivot: orbit about the string center, as before.
    const rot = new THREE.Matrix4().makeRotationFromEuler(euler);
    v = new THREE.Vector3(
      base[0] + controls.position[0] - pivot[0],
      base[1] + controls.position[1] - pivot[1],
      base[2] + controls.position[2] - pivot[2]
    );
    v.applyMatrix4(rot);
    v.set(
      pivot[0] + v.x * controls.scale[0],
      pivot[1] + v.y * controls.scale[1],
      pivot[2] + v.z * controls.scale[2]
    );
  }
  node.matrixAutoUpdate = true;
  node.position.copy(v);
  node.rotation.set(controls.rotation[0], controls.rotation[1], controls.rotation[2], order);
  node.scale.set(
    Math.max(1e-6, controls.scale[0]),
    Math.max(1e-6, controls.scale[1]),
    Math.max(1e-6, controls.scale[2])
  );
}

/* ------------------------------------------------- connected letter run */

// Ordered Text objects under a container (outliner order, descending
// through plain Group wrappers): the connected letter run. Texts count
// wherever they sit — directly under the container or nested in groups.
// Effector instances (flagged), nested ExpressText+ containers and Text+
// owners never count as texts, and their subtrees are skipped entirely.
// Saved/array-like lists normalize via rawArray.
function containerTexts(container) {
  const out = [];
  const visited = new Set();
  const walk = (node, depth) => {
    if (!node || depth > MAX_ANCESTOR_DEPTH || visited.has(node)) return;
    visited.add(node);
    let kids = [];
    try {
      kids = rawArray(node.objects);
    } catch (_kids) {
      return;
    }
    for (const child of kids) {
      if (!child || visited.has(child)) continue;
      if (child.zoidiumExpressTextObject || child.zoidiumExpressEffector) continue;
      if (child.zoidiumTextPlusObject === true) continue;
      if (child.font && child.font.font3d && child.properties && "text" in Object(child.properties)) {
        out.push(child);
        continue;
      }
      walk(child, depth + 1);
    }
  };
  try {
    walk(container, 0);
  } catch (_texts) {}
  return out;
}

// A Text object's own placement for its render root (and for measuring
// its letters in world space). Reads at the given frame so keyframed
// text motion carries.
function ownTransformOf(object, frame) {
  const props = (object && object.properties) || {};
  const order = propertyValue(props.rotationOrder, frame, "XYZ");
  return {
    position: vector3(propertyValue(props.position, frame, [0, 0, 0]), [0, 0, 0]),
    rotation: vector3(propertyValue(props.rotation, frame, [0, 0, 0]), [0, 0, 0]),
    eulerOrder: PZ_EULER_ORDERS.has(order) ? order : "XYZ",
    scale: vector3(propertyValue(props.scale, frame, [1, 1, 1]), [1, 1, 1]),
  };
}

// Compose a child transform through its parent wrapper (XYZ convention,
// like the rest): scale the offset, spin it, then translate.
function throughParent(parent, child) {
  const scaled = [
    child.position[0] * parent.scale[0],
    child.position[1] * parent.scale[1],
    child.position[2] * parent.scale[2],
  ];
  const spun = rotateEulerXYZ(scaled, parent.rotation);
  return {
    position: [
      parent.position[0] + spun[0],
      parent.position[1] + spun[1],
      parent.position[2] + spun[2],
    ],
    rotation: [
      parent.rotation[0] + child.rotation[0],
      parent.rotation[1] + child.rotation[1],
      parent.rotation[2] + child.rotation[2],
    ],
    eulerOrder: child.eulerOrder,
    scale: [
      parent.scale[0] * child.scale[0],
      parent.scale[1] * child.scale[1],
      parent.scale[2] * child.scale[2],
    ],
  };
}

// A text's world placement for its render root: its own transform
// composed through any Group wrappers up to (excluding) the ExpressText
// container. Reads at the given frame so keyframed motion carries.
function textWorldOf(textObject, frame) {
  let world = ownTransformOf(textObject, frame);
  try {
    let current = getAncestorObject(textObject);
    for (let depth = 0; current && depth < MAX_ANCESTOR_DEPTH; depth += 1) {
      if (current.zoidiumExpressTextObject === true) break;
      if (current.zoidiumTextPlusObject === true) break;
      world = throughParent(ownTransformOf(current, frame), world);
      current = getAncestorObject(current);
    }
  } catch (_ancestors) {}
  return world;
}
// state needed): missing glyphs still consume an index downstream.
function layoutLetterCount(textObject, frame) {
  try {
    const font = textObject && textObject.font && textObject.font.font3d;
    const data = font && font.data;
    if (!data) return 0;
    const props = (textObject && textObject.properties) || {};
    const rawText = propertyValue(props.text, frame, "");
    const rawSize = propertyValue(props.size, frame, [20, 3]);
    const size = Array.isArray(rawSize) ? numberValue(rawSize[0], 20) : 20;
    const spacing = propertyValue(props.spacing, frame, 0);
    const layout = getExpressLayout(String(rawText == null ? "" : rawText), data, size, spacing);
    const units = layout && layout.units;
    return Array.isArray(units) ? units.length : 0;
  } catch (_layout) {
    return 0;
  }
}

// Connected letter run for a container: continuous numbering across all
// its texts in outliner order, so selections, id/u/count, ranks and
// centers span texts. Counts come from layout (exact from frame 0);
// world bases come from built entries when available (exact in steady
// state; brand-new texts join within a frame).
function containerLetterRun(container, selfText, selfEntries, frame) {
  const fallbackWorld = textWorldOf(selfText, frame);
  if (!selfText) {
    return {
      total: 0,
      order: [],
      starts: [],
      counts: [],
      bases: [],
      extent: null,
      selfStart: 0,
      selfWorld: fallbackWorld,
    };
  }
  const texts = containerTexts(container);
  if (!texts.includes(selfText)) texts.push(selfText);
  const selfWorld = textWorldOf(selfText, frame);
  const starts = [];
  const counts = [];
  let total = 0;
  for (const text of texts) {
    starts.push(total);
    let count = layoutLetterCount(text, frame);
    if (!(count > 0)) {
      try {
        const built = state.splitStates.get(text);
        count = built && built.entries ? built.entries.length : 0;
      } catch (_built) {
        count = 0;
      }
    }
    counts.push(count);
    total += count;
  }
  const order = [];
  for (let i = 0; i < total; i += 1) order.push(i);
  const bases = new Array(total).fill(null);
  const placeEntries = (text, entries, start, world) => {
    for (const entry of entries || []) {
      if (!entry || !entry.base) continue;
      const g = start + entry.index;
      if (g < 0 || g >= total) continue;
      bases[g] = worldBaseOf(entry.base, world);
    }
  };
  const selfAt = texts.indexOf(selfText);
  placeEntries(selfText, selfEntries, starts[selfAt], selfWorld);
  for (let ti = 0; ti < texts.length; ti += 1) {
    if (texts[ti] === selfText) continue;
    let entries = null;
    try {
      const split = state.splitStates.get(texts[ti]);
      entries = split && split.entries;
    } catch (_split) {}
    placeEntries(texts[ti], entries, starts[ti], textWorldOf(texts[ti], frame));
  }
  let extent = null;
  let lo = Infinity;
  let hi = -Infinity;
  for (const b of bases) {
    if (!Array.isArray(b) || !isFinite(b[0])) continue;
    if (b[0] < lo) lo = b[0];
    if (b[0] > hi) hi = b[0];
  }
  if (hi > lo) extent = { lo, hi };
  return { total, order, starts, counts, bases, extent, selfStart: starts[selfAt], selfWorld };
}

function updateExpressRendering(textObject, splitState, layers, frame) {
  const THREE = state.THREE;
  const sourceMesh = textObject.threeObj;
  if (!THREE || !sourceMesh) return;
  const signature = expressSignature(textObject);
  const container = expressContainerOf(layers);
  if (!container) return;
  const containerProps = getExpressProperties(container);
  const stack = stackLayersFor(container, layers);
  const repeaters = repeaterSpecsFor(stack, frame);
  const repeatKey = repeaters.map((r) => r.copies).join(",");
  // Voronoi partition from the first layer asking for chunks; motion
  // sums every layer per frame below. Seed rides the signature so a
  // re-roll rebuilds the cells.
  let voronoiSpec = null;
  for (const layer of stack) {
    if (layer && layer.kind === "voronoi") {
      const chunks = Math.max(
        0,
        Math.min(64, Math.floor(numberValue(readProp(layer.props, "voronoiChunks", frame, 8), 8)))
      );
      if (chunks > 0) {
        voronoiSpec = { chunks, seed: readProp(layer.props, "voronoiSeed", frame, 1) };
        break;
      }
    }
  }
  const voronoiKey = voronoiSpec ? `${voronoiSpec.chunks}:${voronoiSpec.seed}` : "";
  const fullSig = signature == null ? null : `${signature}|repeat:${repeatKey}|voronoi:${voronoiKey}`;
  // Stable section identities (reorder-safe): wrapper layers churn every
  // frame, their source objects do not.
  const refs = repeaters.map((r) => r.source);
  const refsChanged =
    !splitState.repeatLayers ||
    refs.length !== splitState.repeatLayers.length ||
    refs.some((l, i) => l !== splitState.repeatLayers[i]);
  if (!splitState.renderRoot || splitState.signature !== fullSig || refsChanged) {
    if (!buildExpressRendering(textObject, splitState, repeaters.map((r) => r.copies), voronoiSpec)) return;
    splitState.signature = fullSig;
    splitState.repeatLayers = refs;
  }
  // Connected letter run: continuous numbering across every text under
  // this container, so selections, id/u/count, ranks and centers span
  // texts. Single texts resolve to their own local numbering exactly.
  const run = containerLetterRun(container, textObject, splitState.entries, frame);
  const selfWorld = run.selfWorld;
  // The text keeps its own placement: carry the Text object's transform
  // onto its render root so multiple texts compose by position instead
  // of piling on the origin. Reads at the current frame, so keyframed
  // text motion carries its letters.
  try {
    splitState.renderRoot.position.set(
      selfWorld.position[0],
      selfWorld.position[1],
      selfWorld.position[2]
    );
    splitState.renderRoot.rotation.set(
      selfWorld.rotation[0],
      selfWorld.rotation[1],
      selfWorld.rotation[2],
      selfWorld.eulerOrder
    );
    splitState.renderRoot.scale.set(selfWorld.scale[0], selfWorld.scale[1], selfWorld.scale[2]);
  } catch (_rootTransform) {}
  const entries = splitState.entries;
  const globalList = { order: run.order, total: run.total };
  // One shared pivot per frame: when any stacked effector asks for the
  // Text pivot the whole stack rotates/scales about the string center,
  // otherwise each letter turns about its own center.
  let textPivot = false;
  for (const layer of stack) {
    const pivotKey = EFFECTOR_PIVOT_KEYS[layer.kind];
    if (
      pivotKey &&
      Math.round(numberValue(readProp(layer.props, pivotKey, frame, 0), 0)) === 1
    ) {
      textPivot = true;
      break;
    }
  }
  const sharedPivot = textPivot ? splitState.textCenter || [0, 0, 0] : null;
  const aux = {
    extent: run.extent,
    bases: run.bases,
    selfWorld: run.selfWorld,
  };
  for (const entry of entries) {
    copyMeshState(sourceMesh, entry.mesh);
    const globalIndex = run.selfStart + entry.index;
    const controls = evaluateStack(stack, containerProps, frame, globalIndex, globalList, entry.base, aux);
    const order = controls.eulerOrder || "XYZ";
    applyLetterTransform(THREE, entry.anchor, entry.base, controls, sharedPivot || entry.base, order);
    const plainLists = plainListsAt(stack, frame);
    // Echo ghosts trail the letter's motion: sample the previous frame.
    let velocity = null;
    if (entry.copies && entry.copies.length && repeaters.some((r) => r.mode === 2 && r.copies > 0)) {
      const prev = evaluateStack(stack, containerProps, frame - 1, globalIndex, globalList, entry.base, aux);
      velocity = [
        controls.position[0] - prev.position[0],
        controls.position[1] - prev.position[1],
        controls.position[2] - prev.position[2],
      ];
    }
    for (const copy of entry.copies || []) {
      const spec = repeaters[copy.ri];
      const node = copy.node;
      if (!spec) {
        node.visible = false;
        continue;
      }
      const ctx = letterContext(spec.layer.props, "repeater", frame, globalIndex, globalList, plainLists);
      const w = isLetterSelected(ctx.selected, globalIndex)
        ? applyFieldWeight(ctx.strength, spec.layer.props, "repeater", frame, entry.base)
        : 0;
      if (!(w > 0)) {
        node.visible = false;
        continue;
      }
      node.visible = true;
      const raw = repeaterCopyOffset(spec, globalIndex, copy.slot, velocity);
      node.position.set(
        entry.anchor.position.x + raw[0] * w,
        entry.anchor.position.y + raw[1] * w,
        entry.anchor.position.z + raw[2] * w
      );
      node.rotation.copy(entry.anchor.rotation);
      node.scale.copy(entry.anchor.scale);
      if (copy.ownMaterial && copy.mesh.material) {
        const op = repeaterCopyOpacity(spec, copy.slot);
        try {
          if (Math.abs(numberValue(copy.mesh.material.opacity, 1) - op) > 1e-6) {
            copy.mesh.material.opacity = op;
          }
          const wantTransparent = op < 0.999;
          if (!!copy.mesh.material.transparent !== wantTransparent) {
            copy.mesh.material.transparent = wantTransparent;
          }
        } catch (_fade) {}
      }
    }
    if (entry.chunks && entry.chunks.length) {
      // Shatter sums every voronoi layer (shared partition, richer motion).
      let explode = 0;
      const spin = [0, 0, 0];
      let chunkWeight = 0;
      for (const layer of stack) {
        if (!layer || layer.kind !== "voronoi") continue;
        const ctx = letterContext(layer.props, "voronoi", frame, globalIndex, globalList, plainLists);
        if (!isLetterSelected(ctx.selected, globalIndex)) continue;
        const w = applyFieldWeight(ctx.strength, layer.props, "voronoi", frame, entry.base);
        if (!(w > 0)) continue;
        const local = frame - ctx.delay;
        explode += numberValue(readProp(layer.props, "voronoiExplode", local, 0), 0) * w;
        const sv = readVector(layer.props, "voronoiSpin", local, [0, 0, 0]);
        spin[0] += sv[0] * w;
        spin[1] += sv[1] * w;
        spin[2] += sv[2] * w;
        chunkWeight += w;
      }
      const shattered = chunkWeight > 0;
      try {
        entry.mesh.visible = !shattered;
      } catch (_vis) {}
      for (const chunk of entry.chunks) {
        const node = chunk.node;
        if (!shattered) {
          node.visible = false;
          continue;
        }
        node.visible = true;
        const pose = voronoiChunkPose(chunk.center, entry.chunkCenter, explode, spin, chunk.sign);
        node.position.set(
          entry.anchor.position.x + pose.offset[0],
          entry.anchor.position.y + pose.offset[1],
          entry.anchor.position.z + pose.offset[2]
        );
        const baseArgs = eulerParts(entry.anchor.rotation);
        node.rotation.set(
          baseArgs[0] + pose.rotation[0],
          baseArgs[1] + pose.rotation[1],
          baseArgs[2] + pose.rotation[2],
          baseArgs[3]
        );
        node.scale.copy(entry.anchor.scale);
      }
    }
  }
}

function syncExpressRendering(textObject, frame) {
  try {
    const layers = collectExpressObjects(textObject);
    if (!layers.length) {
      if (state.splitStates.get(textObject)) restoreExpressRendering(textObject);
      return;
    }
    updateExpressRendering(textObject, getSplitState(textObject), layers, frame);
  } catch (error) {
    try {
      restoreExpressRendering(textObject);
    } catch (_inner) {}
    console.error("ExpressText+ could not update 3D text", error);
  }
}

module.exports = { EXTRUDE_OPTION_KEYS, applyLetterTransform, buildExpressRendering, containerLetterRun, containerTexts, disposeExpressRendering, eulerParts, expressSignature, geometryTriangleArrays, getSplitState, layoutLetterCount, ownTransformOf, restoreExpressRendering, setChunkAttribute, sourceExtrudeOptions, syncExpressRendering, textWorldOf, throughParent, updateExpressRendering };
