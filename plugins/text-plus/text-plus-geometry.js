"use strict";

// Text+ character geometry: text shape generation, per-character mesh trees,
// and the reference-space transforms applied to them. Depends on utils
// (values, layout, shared state) and controls (property reads, controls).

const {
  MAX_ANCESTOR_DEPTH,
  PZ_EULER_ORDERS,
  collectTextPlusObjects,
  getCenterOffset,
  getTextCenter,
  getTextLayout,
  numberValue,
  resolveCharacterRange,
  state,
  vector3,
} = require("./text-plus-utils.js");
const {
  getTextPlusControls,
  propertyValue,
} = require("./text-plus-controls.js");
const {
  clearTextFontWarnings,
  countGeometryVertices,
  hasVisibleCharacters,
  reportTextFontIssue,
  reportUnavailableFont,
  watchFontLoad,
} = require("./text-plus-diagnostics.js");

// Requests contain owner identities only in private state, never in userData.
const splitRequests = new Map();

function requestCharacterSplit(textObject, owner) {
  let owners = splitRequests.get(textObject);
  if (!owners) splitRequests.set(textObject, owners = new Set());
  owners.add(owner);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    owners.delete(owner);
    if (!owners.size && splitRequests.get(textObject) === owners) {
      splitRequests.delete(textObject);
      if (!collectTextPlusObjects(textObject).length) restoreTextRendering(textObject);
    }
  };
}

function clearCharacterSplitRequests(textObject) {
  if (textObject) splitRequests.delete(textObject);
  else splitRequests.clear();
}

/* ----------------------------------------------------------- text rendering */

function createTextShapes(font, text, size, divisions, spacing = 0) {
  const THREE = state.THREE;
  const data = font?.data;
  if (!data) {
    return typeof font?.generateShapes === "function"
      ? font.generateShapes(text, size, divisions)
      : [];
  }
  if (!THREE?.ShapePath) return [];

  const resolution = numberValue(data.resolution, 1000);
  const scale = resolution !== 0 ? numberValue(size, 100) / resolution : 0;
  const bounds = data.boundingBox || {};
  const lineHeight =
    (numberValue(bounds.yMax, 0) -
      numberValue(bounds.yMin, 0) +
      numberValue(data.underlineThickness, 0)) *
    scale;
  const glyphs = data.glyphs || {};
  const characters = String(text == null ? "" : text).split("");
  const shapes = [];
  let offsetX = 0;
  let offsetY = 0;

  for (const character of characters) {
    if (character === "\n") {
      offsetX = 0;
      offsetY -= lineHeight;
      continue;
    }

    const glyph = glyphs[character] || glyphs["?"];
    if (!glyph) continue;

    if (glyph.o) {
      const path = new THREE.ShapePath();
      const outline =
        glyph._cachedOutline || (glyph._cachedOutline = glyph.o.split(" "));

      for (let index = 0; index < outline.length; ) {
        const action = outline[index++];
        let x;
        let y;
        let cpx;
        let cpy;
        let cpx1;
        let cpy1;
        let cpx2;
        let cpy2;

        switch (action) {
          case "m":
            x = numberValue(outline[index++], 0) * scale + offsetX;
            y = numberValue(outline[index++], 0) * scale + offsetY;
            path.moveTo(x, y);
            break;
          case "l":
            x = numberValue(outline[index++], 0) * scale + offsetX;
            y = numberValue(outline[index++], 0) * scale + offsetY;
            path.lineTo(x, y);
            break;
          case "q":
            cpx = numberValue(outline[index++], 0) * scale + offsetX;
            cpy = numberValue(outline[index++], 0) * scale + offsetY;
            cpx1 = numberValue(outline[index++], 0) * scale + offsetX;
            cpy1 = numberValue(outline[index++], 0) * scale + offsetY;
            path.quadraticCurveTo(cpx1, cpy1, cpx, cpy);
            break;
          case "b":
            cpx = numberValue(outline[index++], 0) * scale + offsetX;
            cpy = numberValue(outline[index++], 0) * scale + offsetY;
            cpx1 = numberValue(outline[index++], 0) * scale + offsetX;
            cpy1 = numberValue(outline[index++], 0) * scale + offsetY;
            cpx2 = numberValue(outline[index++], 0) * scale + offsetX;
            cpy2 = numberValue(outline[index++], 0) * scale + offsetY;
            path.bezierCurveTo(cpx1, cpy1, cpx2, cpy2, cpx, cpy);
            break;
          default:
            break;
        }
      }

      for (const shape of path.toShapes()) shapes.push(shape);
    }

    offsetX += numberValue(glyph.ha, 0) * scale + numberValue(spacing, 0);
  }

  return shapes;
}

function sameObjects(left, right) {
  if (!left || !right || left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
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

function expandBounds(bounds, box, x, y) {
  if (!box) return;
  bounds.min[0] = Math.min(bounds.min[0], box.min[0] + x);
  bounds.min[1] = Math.min(bounds.min[1], box.min[1] + y);
  bounds.min[2] = Math.min(bounds.min[2], box.min[2]);
  bounds.max[0] = Math.max(bounds.max[0], box.max[0] + x);
  bounds.max[1] = Math.max(bounds.max[1], box.max[1] + y);
  bounds.max[2] = Math.max(bounds.max[2], box.max[2]);
  bounds.empty = false;
}

function textGeometryOptions(textObject, font) {
  const rawSize = propertyValue(textObject.properties?.size, 0, [20, 3]);
  const size = Array.isArray(rawSize) ? rawSize : [20, 3];
  const rawBevelSize = propertyValue(
    textObject.properties?.bevelSize,
    0,
    [0.1, 0.5]
  );
  const bevelSize = Array.isArray(rawBevelSize) ? rawBevelSize : [0.1, 0.5];
  const bevelWidth = numberValue(bevelSize[1], 0.5);
  const bevelSide = Math.round(
    numberValue(propertyValue(textObject.properties?.bevelSide, 0, 0), 0)
  );
  const bevelProfile = Math.round(
    numberValue(propertyValue(textObject.properties?.bevelProfile, 0, 1), 1)
  );
  return {
    size: numberValue(size[0], 20),
    height: numberValue(size[1], 3),
    curveSegments: numberValue(propertyValue(textObject.properties?.detail, 0, 5), 5),
    font,
    bevelEnabled: Boolean(propertyValue(textObject.properties?.bevel, 0, 0)),
    bevelThickness: numberValue(bevelSize[0], 0.1),
    bevelSize: bevelWidth,
    bevelSizeInner: bevelWidth,
    bevelShift: bevelSide === 1 ? bevelWidth : 0,
    bevelSegments: Math.max(
      1,
      Math.round(numberValue(propertyValue(textObject.properties?.bevelDetail, 0, 3), 3))
    ),
    bevelRound: bevelProfile === 1,
    bevelProfile: numberValue(
      propertyValue(textObject.properties?.bevelTension, 0, 0.5),
      0.5
    ),
    amount: numberValue(size[1], 3),
    material: 0,
    extrudeMaterial: 1,
  };
}

function createCharacterGeometry(character, options) {
  const THREE = state.THREE;
  const font = options.font;
  if (typeof THREE?.ExtrudeGeometry === "function") {
    const shapes = createTextShapes(
      font,
      character,
      options.size,
      options.curveSegments,
      0
    );
    return new THREE.ExtrudeGeometry(shapes, options);
  }
  if (typeof THREE?.TextGeometry === "function") {
    return new THREE.TextGeometry(character, options);
  }
  return null;
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

function disposeCharacterRendering(splitState) {
  if (!splitState) return;
  if (splitState.renderRoot?.parent) {
    splitState.renderRoot.parent.remove(splitState.renderRoot);
  }
  for (const entry of splitState.entries || []) {
    delete entry.anchor.userData.zoidiumTextPlusCharacter;
    if (entry.mesh) delete entry.mesh.userData.zoidiumTextPlusCharacter;
    entry.geometry?.dispose?.();
  }
  if (splitState.renderRoot) delete splitState.renderRoot.userData.zoidiumTextPlusCharacters;
  splitState.renderRoot = null;
  splitState.entries = [];
  splitState.layers = [];
}

/* --------------------------------------------- text-scale compensation */

// The Text object's own scale (possibly animated) at a frame. CM3 copies
// this property into threeObj.scale on every update. While Text+ renders
// per-character meshes, that scale is neutralized on threeObj and reapplied
// explicitly to glyph geometry and layout positions, so per-character
// rotations happen in unscaled space: a flat (Scale Z 0) text tilts like a
// card instead of being squashed in 2D. For uniform scales this composes to
// exactly the same world matrices as before.
function getSplitTextScale(textObject, frame) {
  const raw = propertyValue(textObject?.properties?.scale, frame, [1, 1, 1]);
  const scale = vector3(raw, [1, 1, 1]);
  return [
    numberValue(scale[0], 1),
    numberValue(scale[1], 1),
    numberValue(scale[2], 1),
  ];
}

function splitTextScaleOf(splitState) {
  return Array.isArray(splitState?.textScale)
    ? splitState.textScale
    : [1, 1, 1];
}

// Character position offsets live in unscaled character space, so they are
// scaled by the Text scale just like layout positions. Rotation and scale
// stay unscaled.
function scaleCharacterOffset(textScale, position) {
  const offset = vector3(position, [0, 0, 0]);
  const scale = Array.isArray(textScale) ? textScale : [1, 1, 1];
  return [
    numberValue(scale[0], 1) * offset[0],
    numberValue(scale[1], 1) * offset[1],
    numberValue(scale[2], 1) * offset[2],
  ];
}

// Capture the Text scale for this frame and neutralize it on threeObj.
// Idempotent within a frame: the scale is always re-read from the property.
function neutralizeTextScale(textObject, splitState, frame) {
  const textScale = getSplitTextScale(textObject, frame);
  splitState.textScale = textScale;
  const mesh = textObject?.threeObj;
  if (mesh?.scale && typeof mesh.scale.set === "function") {
    mesh.scale.set(1, 1, 1);
  }
  return textScale;
}

function restoreTextScale(textObject, splitState) {
  const textScale = Array.isArray(splitState?.textScale)
    ? splitState.textScale
    : null;
  const mesh = textObject?.threeObj;
  if (textScale && mesh?.scale && typeof mesh.scale.set === "function") {
    mesh.scale.set(textScale[0], textScale[1], textScale[2]);
  }
}

function scaledLayoutPosition(textScale, x, y, z) {
  return [
    textScale[0] * x,
    textScale[1] * y,
    textScale[2] * z,
  ];
}

// Reapply the (possibly animated) Text scale to anchor, pivot and mesh
// layout transforms every frame. Character node transforms are handled
// separately in updateCharacterRendering.
function syncScaledLayout(splitState) {
  const textScale = splitTextScaleOf(splitState);
  if (splitState.textPivot && Array.isArray(splitState.textCenter)) {
    splitState.textPivot.position.set(
      ...scaledLayoutPosition(
        textScale,
        splitState.textCenter[0],
        splitState.textCenter[1],
        splitState.textCenter[2]
      )
    );
  }
  for (const entry of splitState.entries || []) {
    const layout = entry.layout;
    if (!layout) continue;
    entry.anchor.position.set(
      ...scaledLayoutPosition(
        textScale,
        layout.x + layout.center[0] + layout.centerOffset[0],
        layout.y + layout.center[1] + layout.centerOffset[1],
        layout.center[2] + layout.centerOffset[2]
      )
    );
    if (entry.mesh) {
      entry.mesh.position.set(
        ...scaledLayoutPosition(
          textScale,
          -layout.center[0],
          -layout.center[1],
          -layout.center[2]
        )
      );
      entry.mesh.scale.set(textScale[0], textScale[1], textScale[2]);
    }
  }
}

function buildCharacterRendering(textObject, splitState, layers) {
  const THREE = state.THREE;
  const sourceMesh = textObject.threeObj;
  const font = textObject.font?.font3d;
  if (!THREE || !sourceMesh || !font) return;

  disposeCharacterRendering(splitState);
  const rawText = propertyValue(textObject.properties?.text, 0, "");
  const rawSize = propertyValue(textObject.properties?.size, 0, [20, 3]);
  const size = Array.isArray(rawSize) ? numberValue(rawSize[0], 20) : 20;
  const spacing = propertyValue(textObject.properties?.spacing, 0, 0);
  const layout = getTextLayout(rawText, font.data, size, spacing);
  const options = textGeometryOptions(textObject, font);
  const bounds = {
    min: [Infinity, Infinity, Infinity],
    max: [-Infinity, -Infinity, -Infinity],
    empty: true,
  };
  const pending = [];

  try {
    for (const unit of layout.units) {
      let geometry = null;
      let box = null;
      geometry = createCharacterGeometry(unit.character, options);
      box = finiteBox(geometry);
      if (!box) {
        geometry.dispose?.();
        geometry = null;
      }
      expandBounds(bounds, box, unit.x, unit.y);
      pending.push({ unit, geometry, box });
    }
  } catch (error) {
    for (const item of pending) item.geometry?.dispose?.();
    throw error;
  }

  const positionMode = propertyValue(textObject.properties?.positionMode, 0, 0);
  const centerOffset = getCenterOffset(
    bounds.empty ? null : bounds,
    positionMode
  );
  const renderRoot = new THREE.Object3D();
  renderRoot.name = "Text+ characters";
  renderRoot.zoidiumTextPlusCharacters = true;
  renderRoot.userData.zoidiumTextPlusCharacters = true;
  const textPivot = new THREE.Object3D();
  textPivot.name = "Text center";
  const textCenter = getTextCenter(
    bounds.empty ? null : bounds,
    centerOffset
  );
  const textScale = splitTextScaleOf(splitState);
  textPivot.position.set(...scaledLayoutPosition(textScale, ...textCenter));
  renderRoot.add(textPivot);
  splitState.textPivot = textPivot;
  splitState.textCenter = textCenter.slice();
  const entries = [];

  for (const item of pending) {
    const center = item.box
      ? [
          (item.box.min[0] + item.box.max[0]) / 2,
          (item.box.min[1] + item.box.max[1]) / 2,
          (item.box.min[2] + item.box.max[2]) / 2,
        ]
      : [item.unit.advance / 2, 0, 0];
    const anchor = new THREE.Object3D();
    anchor.name = `Character ${item.unit.index + 1}`;
    const characterIdentity = {
      index: item.unit.index, sourceIndex: item.unit.sourceIndex, count: layout.count,
    };
    anchor.userData.zoidiumTextPlusCharacter = { ...characterIdentity };
    anchor.position.set(
      ...scaledLayoutPosition(
        textScale,
        item.unit.x + center[0] + centerOffset[0],
        item.unit.y + center[1] + centerOffset[1],
        center[2] + centerOffset[2]
      )
    );
    renderRoot.add(anchor);

    const nodes = [];
    let parent = anchor;
    for (let index = 0; index < layers.length; index += 1) {
      const node = new THREE.Object3D();
      node.name = `${layers[index].defaultName || "Text+"} ${index + 1}`;
      node.zoidiumTextPlusAxis = new THREE.Vector3();
      parent.add(node);
      parent = node;
      nodes.push(node);
    }

    let mesh = null;
    if (item.geometry) {
      mesh = new THREE.Mesh(item.geometry, sourceMesh.material);
      mesh.name = item.unit.character;
      mesh.position.set(
        ...scaledLayoutPosition(textScale, -center[0], -center[1], -center[2])
      );
      mesh.scale.set(textScale[0], textScale[1], textScale[2]);
      copyMeshState(sourceMesh, mesh);
      mesh.userData.zoidiumTextPlusCharacter = { ...characterIdentity };
      parent.add(mesh);
    }

    entries.push({
      index: item.unit.index,
      count: layout.count,
      character: item.unit.character,
      geometry: item.geometry,
      anchor,
      textPivot,
      nodes,
      mesh,
      layout: {
        x: item.unit.x,
        y: item.unit.y,
        center: center.slice(),
        centerOffset: centerOffset.slice(),
      },
    });
  }

  sourceMesh.add(renderRoot);
  splitState.renderRoot = renderRoot;
  splitState.entries = entries;
  splitState.layers = layers.slice();
  splitState.font = font;
  splitState.fontData = font.data;
  reportCharacterBuildResult(textObject, pending);
}

// Warns once when a non-blank Text built some (or all) of its characters to
// empty geometry. A fully successful build, or
// a legitimately blank string, clears the throttle so later failures warn
// again and a recovered font stays silent.
function reportCharacterBuildResult(textObject, pending) {
  let visible = 0;
  let empty = 0;
  for (const item of pending || []) {
    if (!hasVisibleCharacters(item?.unit?.character)) continue;
    visible += 1;
    if (!item?.geometry || countGeometryVertices(item.geometry) === 0) {
      empty += 1;
    }
  }
  if (visible === 0 || empty === 0) {
    clearTextFontWarnings(textObject);
    return;
  }
  if (empty >= visible) {
    reportTextFontIssue(textObject, "zero-vertices");
    return;
  }
  reportTextFontIssue(textObject, "empty-characters", {
    missing: empty,
    total: visible,
  });
}

function captureSourceGeometry(textObject, splitState) {
  const THREE = state.THREE;
  const mesh = textObject.threeObj;
  if (!THREE || !mesh || mesh.geometry === splitState.emptyGeometry) return false;

  if (splitState.fullGeometry && splitState.fullGeometry !== mesh.geometry) {
    splitState.fullGeometry.dispose?.();
  }
  splitState.fullGeometry = mesh.geometry;
  splitState.emptyGeometry = new THREE.Geometry();
  mesh.geometry = splitState.emptyGeometry;
  return true;
}

function getMatrixToAncestor(THREE, object, ancestor) {
  if (!THREE?.Matrix4 || !object || !ancestor) return null;
  const matrix = new THREE.Matrix4();
  let current = object;

  for (let depth = 0; current && depth < MAX_ANCESTOR_DEPTH; depth += 1) {
    if (current === ancestor) return matrix;
    if (!current.matrix) return null;
    if (current.matrixAutoUpdate !== false) current.updateMatrix?.();
    matrix.premultiply(current.matrix);
    current = current.parent || null;
  }
  return null;
}

function applyReferenceSpaceCharacterTransform(
  THREE,
  node,
  controls,
  referenceObject,
  pivotObject
) {
  if (
    !THREE?.Matrix4 ||
    !THREE.Vector3 ||
    !THREE.Euler ||
    !THREE.Quaternion ||
    !node?.parent ||
    !node.matrix ||
    !referenceObject
  ) {
    return false;
  }

  const parentToReference = getMatrixToAncestor(
    THREE,
    node.parent,
    referenceObject
  );
  if (!parentToReference) return false;
  const pivotToReference = pivotObject
    ? getMatrixToAncestor(THREE, pivotObject, referenceObject)
    : parentToReference;
  if (!pivotToReference) return false;
  if (
    typeof parentToReference.determinant === "function" &&
    Math.abs(parentToReference.determinant()) < 1e-12
  ) {
    return false;
  }

  const order = PZ_EULER_ORDERS.has(controls.eulerOrder)
    ? controls.eulerOrder
    : "XYZ";
  const pivot = new THREE.Vector3(0, 0, 0).applyMatrix4(pivotToReference);
  const position = new THREE.Vector3(...controls.position);
  const scale = new THREE.Vector3(...controls.scale);
  const rotation = new THREE.Euler(
    controls.rotation[0],
    controls.rotation[1],
    controls.rotation[2],
    order
  );
  const quaternion = new THREE.Quaternion().setFromEuler(rotation);
  const shake = numberValue(controls.shake, 0);
  if (shake !== 0) {
    const shakeAxis = new THREE.Vector3(
      ...vector3(controls.shakeAxis, [0, 0, 1])
    );
    if (shakeAxis.lengthSq() > 1e-12) {
      quaternion.multiply(
        new THREE.Quaternion().setFromAxisAngle(shakeAxis.normalize(), shake)
      );
    }
  }
  const transform = new THREE.Matrix4().compose(position, quaternion, scale);
  const aroundPivot = new THREE.Matrix4()
    .makeTranslation(pivot.x, pivot.y, pivot.z)
    .multiply(transform)
    .multiply(
      new THREE.Matrix4().makeTranslation(-pivot.x, -pivot.y, -pivot.z)
    );
  const localTransform = new THREE.Matrix4()
    .getInverse(parentToReference)
    .multiply(aroundPivot)
    .multiply(parentToReference);

  node.matrixAutoUpdate = false;
  node.matrix.copy(localTransform);
  node.matrixWorldNeedsUpdate = true;
  return true;
}

function getCharacterTransformReference(textPlus, controls, textPivot) {
  const pivotObject = controls.pivot === "text" ? textPivot : null;
  return {
    pivotObject,
    referenceObject: pivotObject?.parent || textPlus?.threeObj || null,
  };
}

function applyCharacterTransform(node, controls, textPlus, textPivot, textScale) {
  const { pivotObject, referenceObject } = getCharacterTransformReference(
    textPlus,
    controls,
    textPivot
  );
  // Character offsets are scaled like layout positions; rotation and scale
  // stay in unscaled character space.
  const scaledControls = {
    ...controls,
    position: scaleCharacterOffset(textScale, controls.position),
  };
  if (
    (textPlus?.zoidiumTextPlusMode === "random-scatter" || pivotObject) &&
    applyReferenceSpaceCharacterTransform(
      state.THREE,
      node,
      scaledControls,
      referenceObject,
      pivotObject
    )
  ) {
    return;
  }

  node.matrixAutoUpdate = true;
  node.position.set(...scaledControls.position);
  node.scale.set(...controls.scale);
  const order = PZ_EULER_ORDERS.has(controls.eulerOrder)
    ? controls.eulerOrder
    : "XYZ";
  node.rotation.set(
    controls.rotation[0],
    controls.rotation[1],
    controls.rotation[2],
    order
  );

  const axis = node.zoidiumTextPlusAxis;
  axis.set(...controls.shakeAxis);
  if (axis.lengthSq() > 1e-12 && controls.shake !== 0) {
    node.rotateOnAxis(axis.normalize(), controls.shake);
  }
}

function updateCharacterRendering(textObject, splitState, layers, frame) {
  const sourceMesh = textObject.threeObj;
  if (!state.THREE || !sourceMesh) return;
  const textScale = neutralizeTextScale(textObject, splitState, frame);
  if (!sameObjects(splitState.layers, layers)) {
    buildCharacterRendering(textObject, splitState, layers);
  }
  syncScaledLayout(splitState);

  for (const entry of splitState.entries) {
    copyMeshState(sourceMesh, entry.mesh);
    const range = getEffectiveCharacterRange(textObject, frame, entry.index, entry.count);
    for (let index = 0; index < layers.length; index += 1) {
      const controls = getTextPlusControls(
        layers[index],
        frame,
        range.index,
        range.count
      );
      applyCharacterTransform(
        entry.nodes[index],
        controls,
        layers[index],
        entry.textPivot,
        textScale
      );
    }
  }
}

// Reads the Text's own "Index offset" / "Total characters" properties at the
// current frame and maps one local character onto the multi-Text word. Both
// default to 0 (automatic), which returns the local index and count
// unchanged.
function getEffectiveCharacterRange(textObject, frame, index, count) {
  let offset = 0;
  let total = 0;
  try {
    offset = propertyValue(
      textObject?.properties?.characterIndexOffset,
      frame,
      0
    );
    total = propertyValue(
      textObject?.properties?.characterCountOverride,
      frame,
      0
    );
  } catch (_error) {
    offset = 0;
    total = 0;
  }
  return resolveCharacterRange(offset, total, index, count);
}

function getSplitState(textObject) {
  let splitState = state.splitStates.get(textObject);
  if (splitState) return splitState;
  splitState = {
    fullGeometry: null,
    emptyGeometry: null,
    renderRoot: null,
    entries: [],
    layers: [],
  };
  state.splitStates.set(textObject, splitState);
  state.splitTexts.add(textObject);
  return splitState;
}

function restoreTextRendering(textObject) {
  const splitState = state.splitStates.get(textObject);
  if (!splitState) return;
  restoreTextScale(textObject, splitState);
  disposeCharacterRendering(splitState);
  const mesh = textObject?.threeObj;
  if (mesh && mesh.geometry === splitState.emptyGeometry) {
    mesh.geometry = splitState.fullGeometry || mesh.geometry;
  } else if (
    splitState.fullGeometry &&
    mesh?.geometry !== splitState.fullGeometry
  ) {
    splitState.fullGeometry.dispose?.();
  }
  if (splitState.emptyGeometry && mesh?.geometry !== splitState.emptyGeometry) {
    splitState.emptyGeometry.dispose?.();
  }
  state.splitStates.delete(textObject);
  state.splitTexts.delete(textObject);
}

function syncTextRendering(textObject, frame) {
  const layers = collectTextPlusObjects(textObject);
  if (layers.length === 0 && !splitRequests.get(textObject)?.size) {
    restoreTextRendering(textObject);
    return;
  }
  if (!textObject?.threeObj || !textObject.font?.font3d) {
    // Pending fonts stay silent; failed loads diagnose and late fonts
    // rebuild from scratch instead of retaining empty character geometry.
    if (textObject?.threeObj) {
      watchFontLoad(textObject);
      reportUnavailableFont(textObject);
    }
    return;
  }

  const splitState = getSplitState(textObject);
  const geometryChanged = captureSourceGeometry(textObject, splitState);
  neutralizeTextScale(textObject, splitState, frame);
  if (
    geometryChanged ||
    splitState.font !== textObject.font.font3d ||
    splitState.fontData !== textObject.font.font3d.data ||
    !splitState.renderRoot ||
    !sameObjects(splitState.layers, layers)
  ) {
    buildCharacterRendering(textObject, splitState, layers);
  }
  updateCharacterRendering(textObject, splitState, layers, frame);
}

module.exports = {
  requestCharacterSplit,
  clearCharacterSplitRequests,
  createTextShapes,
  sameObjects,
  finiteBox,
  expandBounds,
  textGeometryOptions,
  createCharacterGeometry,
  copyMeshState,
  disposeCharacterRendering,
  getSplitTextScale,
  splitTextScaleOf,
  scaleCharacterOffset,
  neutralizeTextScale,
  restoreTextScale,
  scaledLayoutPosition,
  syncScaledLayout,
  buildCharacterRendering,
  captureSourceGeometry,
  getMatrixToAncestor,
  applyReferenceSpaceCharacterTransform,
  getCharacterTransformReference,
  applyCharacterTransform,
  updateCharacterRendering,
  getEffectiveCharacterRange,
  reportCharacterBuildResult,
  getSplitState,
  restoreTextRendering,
  syncTextRendering,
};
