"use strict";

// UV Custom Material mirrors CM3's native Custom Material, but it rewrites the
// UVs of 3D Text and extruded geometry so a texture keeps one texel density on
// every face. CM3's native Custom Material is left completely untouched, so
// existing projects keep their original look.
//
// The unwrap works on the finished geometry only: it rebuilds each outline from
// the side walls, so it needs no access to the font or the source shapes.

const UV_CUSTOM_MATERIAL_ID = "uvcustom";
const UV_CUSTOM_MATERIAL_NAME = "UV Custom Material";

const uvCustomState = {
  active: false,
  PZ: null,
  THREE: null,
  plugin: null,
  previousFactory: undefined,
  hadPreviousFactory: false,
  factory: null,
};

// geometry -> deep copy of its original faceVertexUvs before we rewrote it.
const originalUvs = new WeakMap();
// Materials that still hold a normalized geometry, so deactivate() can restore.
const activeMaterials = new Set();

const UV_EPSILON = 1e-6;
const UV_DISTANCE_EPSILON = 1e-12;
const UV_QUANTIZE = 1e4;

function uvReadNumber(property, frame, fallback) {
  try {
    const value = property?.get?.(frame);
    return Number.isFinite(Number(value)) ? Number(value) : fallback;
  } catch (_error) {
    return fallback;
  }
}

function uvReadColor(property, frame, fallback) {
  try {
    const value = property?.get?.(frame);
    if (Array.isArray(value) && value.length >= 3) {
      return [Number(value[0]) || 0, Number(value[1]) || 0, Number(value[2]) || 0];
    }
  } catch (_error) {
    // Use the supplied fallback below.
  }
  return fallback.slice();
}

function uvReadVector2(property, frame, fallback) {
  try {
    const value = property?.get?.(frame);
    if (Array.isArray(value) && value.length >= 2) {
      return [Number(value[0]) || 0, Number(value[1]) || 0];
    }
  } catch (_error) {
    // Use the supplied fallback below.
  }
  return fallback.slice();
}

function uvOptionValue(property, fallback) {
  const value = Number(property?.value);
  return Number.isFinite(value) ? value : fallback;
}

/* --------------------------------------------------------------- UV unwrap */

function uvQuantize(x, y) {
  return `${Math.round(x * UV_QUANTIZE)},${Math.round(y * UV_QUANTIZE)}`;
}

// Rebuild the closed outline(s) of an extruded legacy Geometry from its side
// walls: the two lowest vertices of a wall triangle are consecutive outline
// points. This recovers the contour order without the original shapes.
function uvReconstructContours(geometry) {
  const vertices = geometry.vertices;
  const faces = geometry.faces;
  const nodes = new Map();
  const adjacency = new Map();

  function addEdge(a, b) {
    const keyA = uvQuantize(a.x, a.y);
    const keyB = uvQuantize(b.x, b.y);
    if (keyA === keyB) return;
    if (!nodes.has(keyA)) {
      nodes.set(keyA, { x: a.x, y: a.y });
      adjacency.set(keyA, new Set());
    }
    if (!nodes.has(keyB)) {
      nodes.set(keyB, { x: b.x, y: b.y });
      adjacency.set(keyB, new Set());
    }
    adjacency.get(keyA).add(keyB);
    adjacency.get(keyB).add(keyA);
  }

  for (let faceIndex = 0; faceIndex < faces.length; faceIndex += 1) {
    const face = faces[faceIndex];
    const indices = [face.a, face.b, face.c];
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (let index = 0; index < indices.length; index += 1) {
      const z = vertices[indices[index]]?.z ?? 0;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }
    if (maxZ - minZ <= UV_EPSILON) continue; // cap plane

    const bottom = [];
    for (let index = 0; index < indices.length; index += 1) {
      if (Math.abs(vertices[indices[index]].z - minZ) <= UV_EPSILON) {
        bottom.push(vertices[indices[index]]);
      }
    }
    if (bottom.length === 2) addEdge(bottom[0], bottom[1]);
  }

  const visited = new Set();
  const contours = [];
  for (const start of adjacency.keys()) {
    if (visited.has(start)) continue;
    const cycle = [];
    let previous = null;
    let current = start;
    while (current && !visited.has(current)) {
      visited.add(current);
      cycle.push(nodes.get(current));
      const neighbors = Array.from(adjacency.get(current));
      let next = neighbors.find((key) => key !== previous && !visited.has(key));
      if (!next && neighbors.includes(start)) next = start;
      previous = current;
      current = next;
    }
    if (cycle.length >= 3) contours.push(cycle);
  }
  return contours;
}

function uvPrepareContours(contours) {
  const prepared = [];
  for (let index = 0; index < contours.length; index += 1) {
    const points = contours[index];
    if (!Array.isArray(points) || points.length < 2) continue;

    const cumulative = [0];
    let total = 0;
    for (let point = 0; point < points.length; point += 1) {
      const current = points[point];
      const next = points[(point + 1) % points.length];
      total += Math.hypot(next.x - current.x, next.y - current.y);
      cumulative.push(total);
    }
    if (!(total > 0)) continue;
    prepared.push({ points, cumulative, total });
  }
  return prepared;
}

// Every segment tied for the minimum distance is returned: the outline's
// closing point is shared by two segments and projects to arc 0 and arc total.
function uvOutlineCandidates(prepared, x, y, scale) {
  let bestDistanceSquared = Infinity;
  const candidates = [];

  for (let index = 0; index < prepared.length; index += 1) {
    const contour = prepared[index];
    const points = contour.points;
    for (let point = 0; point < points.length; point += 1) {
      const a = points[point];
      const b = points[(point + 1) % points.length];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const lengthSquared = dx * dx + dy * dy;

      let t = 0;
      if (lengthSquared > 0) {
        t = ((x - a.x) * dx + (y - a.y) * dy) / lengthSquared;
        if (t < 0) t = 0;
        else if (t > 1) t = 1;
      }

      const px = a.x + dx * t;
      const py = a.y + dy * t;
      const distanceSquared = (x - px) * (x - px) + (y - py) * (y - py);

      if (distanceSquared < bestDistanceSquared - UV_DISTANCE_EPSILON) {
        bestDistanceSquared = distanceSquared;
        candidates.length = 0;
      } else if (distanceSquared > bestDistanceSquared + UV_DISTANCE_EPSILON) {
        continue;
      }

      const arc = contour.cumulative[point] + Math.sqrt(lengthSquared) * t;
      candidates.push({
        arc,
        total: contour.total,
        u: scale > 0 ? arc / scale : contour.total > 0 ? arc / contour.total : 0,
        distanceSquared,
      });
    }
  }

  return candidates;
}

function uvNearestTo(candidates, anchorU) {
  let best = candidates[0];
  let bestDelta = Math.abs(best.u - anchorU);
  for (let index = 1; index < candidates.length; index += 1) {
    const delta = Math.abs(candidates[index].u - anchorU);
    if (delta < bestDelta) {
      bestDelta = delta;
      best = candidates[index];
    }
  }
  return best;
}

function uvGeometryBounds(vertices) {
  const bounds = {
    minX: Infinity,
    minY: Infinity,
    minZ: Infinity,
    maxX: -Infinity,
    maxY: -Infinity,
    maxZ: -Infinity,
  };
  for (let index = 0; index < vertices.length; index += 1) {
    const vertex = vertices[index];
    if (!vertex) continue;
    if (vertex.x < bounds.minX) bounds.minX = vertex.x;
    if (vertex.y < bounds.minY) bounds.minY = vertex.y;
    if (vertex.z < bounds.minZ) bounds.minZ = vertex.z;
    if (vertex.x > bounds.maxX) bounds.maxX = vertex.x;
    if (vertex.y > bounds.maxY) bounds.maxY = vertex.y;
    if (vertex.z > bounds.maxZ) bounds.maxZ = vertex.z;
  }
  return bounds;
}

function uvFaceIndices(face) {
  const indices = [face.a, face.b, face.c];
  if (typeof face.d === "number") indices.push(face.d);
  return indices;
}

function uvIsEligibleGeometry(geometry) {
  if (!geometry || geometry.__zoidiumUvNormalized || geometry.__zoidiumUvSkipped) {
    return false;
  }
  if (geometry.type !== "TextGeometry" && geometry.type !== "ExtrudeGeometry") {
    return false;
  }
  if (!Array.isArray(geometry.vertices) || !Array.isArray(geometry.faces)) {
    return false;
  }
  const layers = geometry.faceVertexUvs;
  if (!layers || !Array.isArray(layers[0]) || layers[0].length === 0) return false;
  const options = geometry.parameters && geometry.parameters.options;
  if (options && options.extrudePath) return false;
  return true;
}

function uvNormalizeGeometry(geometry) {
  const vertices = geometry.vertices;
  const uvs = geometry.faceVertexUvs[0];
  const bounds = uvGeometryBounds(vertices);
  const sizeX = bounds.maxX - bounds.minX;
  const sizeY = bounds.maxY - bounds.minY;
  const sizeZ = bounds.maxZ - bounds.minZ;
  // One texel density on every face: the text height sets the texture unit.
  const scale = sizeY > 0 ? sizeY : sizeX > 0 ? sizeX : sizeZ > 0 ? sizeZ : 1;
  const prepared = uvPrepareContours(uvReconstructContours(geometry));
  if (prepared.length === 0) return false;

  for (let faceIndex = 0; faceIndex < geometry.faces.length; faceIndex += 1) {
    const face = geometry.faces[faceIndex];
    const faceUvs = uvs[faceIndex];
    if (!face || !Array.isArray(faceUvs)) continue;

    const indices = uvFaceIndices(face);
    let minFaceZ = Infinity;
    let maxFaceZ = -Infinity;
    let centroidX = 0;
    let centroidY = 0;
    let counted = 0;
    for (let index = 0; index < indices.length; index += 1) {
      const vertex = vertices[indices[index]];
      if (!vertex) continue;
      if (vertex.z < minFaceZ) minFaceZ = vertex.z;
      if (vertex.z > maxFaceZ) maxFaceZ = vertex.z;
      centroidX += vertex.x;
      centroidY += vertex.y;
      counted += 1;
    }

    const isCap = maxFaceZ - minFaceZ <= UV_EPSILON;
    let anchorU = 0;
    if (!isCap && counted > 0) {
      const anchor = uvOutlineCandidates(
        prepared,
        centroidX / counted,
        centroidY / counted,
        scale
      )[0];
      anchorU = anchor ? anchor.u : 0;
    }

    for (let index = 0; index < faceUvs.length; index += 1) {
      const uv = faceUvs[index];
      const vertex = vertices[indices[index]];
      if (!uv || !vertex || typeof uv.set !== "function") continue;

      if (isCap) {
        uv.set((vertex.x - bounds.minX) / scale, (vertex.y - bounds.minY) / scale);
        continue;
      }

      const candidates = uvOutlineCandidates(prepared, vertex.x, vertex.y, scale);
      const match = candidates.length > 0 ? uvNearestTo(candidates, anchorU) : null;
      uv.set(match ? match.u : anchorU, (vertex.z - bounds.minZ) / scale);
    }
  }

  if (geometry.uvsNeedUpdate !== undefined) geometry.uvsNeedUpdate = true;
  return true;
}

function uvCloneFaceVertexUvs(geometry) {
  const layers = geometry.faceVertexUvs;
  if (!Array.isArray(layers)) return null;
  return layers.map((layer) =>
    Array.isArray(layer)
      ? layer.map((faceUvs) =>
          Array.isArray(faceUvs)
            ? faceUvs.map((uv) => (uv ? { x: uv.x, y: uv.y } : uv))
            : faceUvs
        )
      : layer
  );
}

function uvApplyToGeometry(geometry) {
  if (!uvIsEligibleGeometry(geometry)) return false;
  const original = uvCloneFaceVertexUvs(geometry);
  if (!original) return false;
  originalUvs.set(geometry, original);
  if (!uvNormalizeGeometry(geometry)) {
    // The outline could not be rebuilt (for example a curved path extrusion);
    // remember the decision so the per-frame check stays cheap.
    originalUvs.delete(geometry);
    geometry.__zoidiumUvSkipped = true;
    return false;
  }
  geometry.__zoidiumUvNormalized = true;
  return true;
}

function uvRestoreGeometry(geometry) {
  if (!geometry) return;
  const original = originalUvs.get(geometry);
  if (!original) {
    delete geometry.__zoidiumUvNormalized;
    return;
  }
  geometry.faceVertexUvs = original.map((layer) =>
    Array.isArray(layer)
      ? layer.map((faceUvs) =>
          Array.isArray(faceUvs)
            ? faceUvs.map((uv) => uv)
            : faceUvs
        )
      : layer
  );
  if (geometry.uvsNeedUpdate !== undefined) geometry.uvsNeedUpdate = true;
  delete geometry.__zoidiumUvNormalized;
  originalUvs.delete(geometry);
}

function uvForEachGeometry(root, callback) {
  if (!root || typeof callback !== "function") return;
  if (root.geometry) callback(root.geometry);
  if (typeof root.traverse === "function") {
    root.traverse((child) => {
      if (child && child !== root && child.geometry) callback(child.geometry);
    });
  }
}

function uvEnsureObject(material) {
  const object = material.parentObject;
  const root = object && object.threeObj;
  if (!root) return;
  uvForEachGeometry(root, (geometry) => {
    uvApplyToGeometry(geometry);
  });
}

function uvRestoreObject(material) {
  const object = material.parentObject;
  const root = object && object.threeObj;
  if (!root) return;
  uvForEachGeometry(root, uvRestoreGeometry);
}

/* ------------------------------------------------------------- material API */

function uvApplyRenderSettings(material) {
  if (!material.threeObj) return;
  const transparent = uvOptionValue(material.properties.transparent, 0) === 1;
  const blending = [
    stateThree().NoBlending,
    stateThree().NormalBlending,
    stateThree().AdditiveBlending,
    stateThree().SubtractiveBlending,
    stateThree().MultiplyBlending,
  ][uvOptionValue(material.properties.blending, 1)];
  material.threeObj.transparent = transparent;
  material.threeObj.blending = blending ?? stateThree().NormalBlending;
  material.threeObj.needsUpdate = true;
}

function stateThree() {
  return uvCustomState.THREE;
}

function uvWrapValues() {
  const THREE = stateThree();
  return [THREE.ClampToEdgeWrapping, THREE.RepeatWrapping, THREE.MirroredRepeatWrapping];
}

function uvDisposeTexture(material, key, property) {
  const asset = material[key];
  material[key] = null;
  if (material.threeObj && material.threeObj[property]) {
    material.threeObj[property].dispose?.();
    material.threeObj[property] = null;
  }
  if (asset) {
    try {
      material.parentProject?.assets?.unload(asset);
    } catch (_error) {
      // The project may already be gone during unload.
    }
  }
}

function uvLoadTexture(material, key, property, value) {
  uvDisposeTexture(material, key, property);
  if (!value || !material.parentProject?.assets || !material.threeObj) return;
  material[key] = new uvCustomState.PZ.asset.image(material.parentProject.assets.load(value));
  const texture = material[key].getTexture(true);
  const wrap = uvOptionValue(material.properties.wrap, 1) || 1;
  texture.wrapS = uvWrapValues()[wrap];
  texture.wrapT = uvWrapValues()[wrap];
  material.threeObj[property] = texture;
  material.threeObj.needsUpdate = true;
}

function uvApplyTextureSettings(material, frame) {
  const map = material.threeObj?.map;
  const normalMap = material.threeObj?.normalMap;
  const repeat = uvReadVector2(material.properties.repeat, frame, [1, 1]);
  const offset = uvReadVector2(material.properties.offset, frame, [0, 0]);
  const center = uvReadVector2(material.properties.center, frame, [0, 0]);
  const rotation = uvReadNumber(material.properties.rotation, frame, 0);
  for (const texture of [map, normalMap]) {
    if (!texture) continue;
    texture.repeat.set(repeat[0], repeat[1]);
    texture.offset.set(offset[0], offset[1]);
    texture.center.set(center[0], center[1]);
    texture.rotation = rotation;
  }
}

function uvSyncReflection(material) {
  const enabled = uvOptionValue(material.properties.reflection, 0) === 1;
  const envMap = material.parentLayer?.envMap;
  if (!enabled || !envMap) {
    if (material.threeObj?.envMap) {
      envMap?.releaseTexture?.();
      material.threeObj.envMap = null;
      material.threeObj.needsUpdate = true;
    }
    return;
  }
  if (!material.threeObj?.envMap) {
    material.threeObj.envMap = envMap.getTexture();
    material.threeObj.needsUpdate = true;
  }
}

function uvTrackMaterial(material, plugin) {
  uvCustomState.PZ.zoidium?.trackPluginMaterial?.(
    material,
    {
      id: plugin.id || "material-plus",
      name: plugin.name || "Material+",
      version: String(plugin.version || "1"),
      author: plugin.author || "Zoidium",
      material: UV_CUSTOM_MATERIAL_ID,
      materialName: UV_CUSTOM_MATERIAL_NAME,
      compatibility: "incompatible",
    },
    false
  );
}

function createMaterialFactory(plugin) {
  const PZ = uvCustomState.PZ;
  const propertyDefinitions = {
    color: {
      dynamic: true,
      group: true,
      objects: [
        { dynamic: true, name: "Color.R", type: PZ.property.type.NUMBER, value: 1, min: 0, max: 1 },
        { dynamic: true, name: "Color.G", type: PZ.property.type.NUMBER, value: 1, min: 0, max: 1 },
        { dynamic: true, name: "Color.B", type: PZ.property.type.NUMBER, value: 1, min: 0, max: 1 },
      ],
      name: "Color",
      type: PZ.property.type.COLOR,
    },
    emissive: {
      dynamic: true,
      group: true,
      objects: [
        { dynamic: true, name: "Emissive.R", type: PZ.property.type.NUMBER, value: 0, min: 0, max: 1 },
        { dynamic: true, name: "Emissive.G", type: PZ.property.type.NUMBER, value: 0, min: 0, max: 1 },
        { dynamic: true, name: "Emissive.B", type: PZ.property.type.NUMBER, value: 0, min: 0, max: 1 },
      ],
      name: "Emissive",
      type: PZ.property.type.COLOR,
    },
    roughness: {
      name: "Roughness",
      type: PZ.property.type.NUMBER,
      value: 0.5,
      min: 0,
      max: 1,
      step: 0.01,
    },
    metalness: {
      name: "Metalness",
      type: PZ.property.type.NUMBER,
      value: 0.5,
      min: 0,
      max: 1,
      step: 0.01,
    },
    texture: {
      name: "Texture",
      type: PZ.property.type.ASSET,
      assetType: PZ.asset.type.IMAGE,
      accept: "image/*",
      value: null,
      changed: function () {
        const material = this.parentObject;
        if (material?._zoidiumLoading) return;
        uvLoadTexture(material, "texture", "map", this.value);
      },
    },
    transparent: {
      name: "Transparency",
      type: PZ.property.type.OPTION,
      value: 0,
      changed: function () {
        const material = this.parentObject;
        if (material?._zoidiumLoading) return;
        uvApplyRenderSettings(material);
      },
      items: "off;on",
    },
    opacity: {
      dynamic: true,
      name: "Opacity",
      type: PZ.property.type.NUMBER,
      value: 1,
      min: 0,
      max: 1,
      step: 0.01,
    },
    blending: {
      name: "Blending",
      type: PZ.property.type.OPTION,
      value: 1,
      changed: function () {
        const material = this.parentObject;
        if (material?._zoidiumLoading) return;
        uvApplyRenderSettings(material);
      },
      items: "none;normal;additive;subtractive;multiply",
    },
    side: {
      name: "Render side",
      type: PZ.property.type.OPTION,
      value: 0,
      changed: function () {
        const material = this.parentObject;
        material.threeObj.side = this.value;
      },
      items: "front;back;both",
    },
    normalMap: {
      name: "Normal map",
      type: PZ.property.type.ASSET,
      assetType: PZ.asset.type.IMAGE,
      accept: "image/*",
      value: null,
      changed: function () {
        const material = this.parentObject;
        if (material?._zoidiumLoading) return;
        uvLoadTexture(material, "normalMap", "normalMap", this.value);
      },
    },
    normalScale: {
      name: "Normal scale",
      type: PZ.property.type.NUMBER,
      value: 1,
      min: 0,
      step: 0.01,
      decimals: 3,
    },
    wrap: {
      name: "Wrap",
      type: PZ.property.type.OPTION,
      value: 1,
      changed: function () {
        const material = this.parentObject;
        for (const texture of [material.threeObj?.map, material.threeObj?.normalMap]) {
          if (!texture) continue;
          texture.wrapS = uvWrapValues()[this.value];
          texture.wrapT = uvWrapValues()[this.value];
          texture.needsUpdate = true;
        }
      },
      items: "none;tile;reflect",
    },
    repeat: {
      dynamic: true,
      group: true,
      objects: [
        { dynamic: true, name: "Repeat.U", type: PZ.property.type.NUMBER, step: 0.1, decimals: 3, value: 1 },
        { dynamic: true, name: "Repeat.V", type: PZ.property.type.NUMBER, step: 0.1, decimals: 3, value: 1 },
      ],
      name: "Repeat",
      type: PZ.property.type.VECTOR2,
      step: 0.1,
      decimals: 3,
      linkRatio: true,
    },
    offset: {
      dynamic: true,
      group: true,
      objects: [
        { dynamic: true, name: "Offset.U", type: PZ.property.type.NUMBER, step: 0.1, decimals: 3, value: 0 },
        { dynamic: true, name: "Offset.V", type: PZ.property.type.NUMBER, step: 0.1, decimals: 3, value: 0 },
      ],
      name: "Offset",
      type: PZ.property.type.VECTOR2,
      step: 0.1,
      decimals: 3,
    },
    center: {
      dynamic: true,
      group: true,
      objects: [
        { dynamic: true, name: "Center.U", type: PZ.property.type.NUMBER, step: 0.1, decimals: 3, value: 0 },
        { dynamic: true, name: "Center.V", type: PZ.property.type.NUMBER, step: 0.1, decimals: 3, value: 0 },
      ],
      name: "Center",
      type: PZ.property.type.VECTOR2,
      step: 0.1,
      decimals: 3,
    },
    rotation: {
      dynamic: true,
      name: "Rotation",
      type: PZ.property.type.NUMBER,
      value: 0,
      step: 0.5,
      scaleFactor: Math.PI / 180,
    },
    reflection: {
      name: "Reflection",
      type: PZ.property.type.OPTION,
      value: 0,
      changed: function () {
        const material = this.parentObject;
        if (material?._zoidiumLoading) return;
        uvSyncReflection(material);
      },
      items: "off;on",
    },
  };

  return function () {
    const material = this;
    material.defaultName = UV_CUSTOM_MATERIAL_NAME;
    material.texture = null;
    material.normalMap = null;
    material._zoidiumLoading = true;
    material.properties.addAll(propertyDefinitions);
    material._zoidiumLoading = false;

    material.load = function (data) {
      const THREE = stateThree();
      material._zoidiumLoading = true;
      material.threeObj = new THREE.MeshStandardMaterial({ color: 0xffffff });
      material.threeObj.premultipliedAlpha = true;
      try {
        material.properties.load(data && data.properties);
      } finally {
        material._zoidiumLoading = false;
      }
      uvLoadTexture(material, "texture", "map", material.properties.texture.value);
      uvLoadTexture(material, "normalMap", "normalMap", material.properties.normalMap.value);
      uvApplyRenderSettings(material);
      uvSyncReflection(material);
      uvEnsureObject(material);
      activeMaterials.add(material);
      uvTrackMaterial(material, plugin);
    };

    material.update = function (frame) {
      if (!material.threeObj) return;

      const color = uvReadColor(material.properties.color, frame, [1, 1, 1]);
      const emissive = uvReadColor(material.properties.emissive, frame, [0, 0, 0]);
      material.threeObj.color.setRGB(color[0], color[1], color[2]);
      material.threeObj.emissive.setRGB(emissive[0], emissive[1], emissive[2]);
      material.threeObj.roughness = Math.max(
        0,
        uvReadNumber(material.properties.roughness, frame, 0.5)
      );
      material.threeObj.metalness = Math.max(
        0,
        uvReadNumber(material.properties.metalness, frame, 0.5)
      );
      const normalScale = Math.max(
        0,
        uvReadNumber(material.properties.normalScale, frame, 1)
      );
      material.threeObj.normalScale?.set?.(normalScale, normalScale);
      material.threeObj.opacity = Math.max(
        0,
        Math.min(1, uvReadNumber(material.properties.opacity, frame, 1))
      );

      uvApplyTextureSettings(material, frame);
      uvEnsureObject(material);
      if (
        material._zoidiumReflectionLayer !== material.parentLayer ||
        material._zoidiumReflectionSource !== material.parentLayer?.envMap
      ) {
        material._zoidiumReflectionLayer = material.parentLayer;
        material._zoidiumReflectionSource = material.parentLayer?.envMap;
        uvSyncReflection(material);
      }
    };

    material.prepare = async function () {
      if (material.texture) await material.texture.loading;
      if (material.normalMap) await material.normalMap.loading;
    };

    material.toJSON = function () {
      return { type: material.type, properties: material.properties };
    };

    material.unload = function () {
      uvCustomState.PZ.zoidium?.untrackPluginMaterial?.(material);
      activeMaterials.delete(material);
      uvRestoreObject(material);
      uvDisposeTexture(material, "texture", "map");
      uvDisposeTexture(material, "normalMap", "normalMap");
      if (material.threeObj?.envMap) {
        material.parentLayer?.envMap?.releaseTexture?.();
        material.threeObj.envMap = null;
      }
      material.threeObj?.dispose?.();
      material.threeObj = null;
    };
  };
}

function activate(context) {
  if (uvCustomState.active) return;

  const PZ = context.PZ || context.window?.PZ;
  const THREE =
    context.window?.THREE || (typeof globalThis !== "undefined" ? globalThis.THREE : null);
  if (!PZ?.material?.fnList || !PZ?.asset?.image || !THREE?.MeshStandardMaterial) {
    throw new Error("Material+ UV Custom Material requires the CM3 material and Three.js APIs.");
  }

  uvCustomState.active = true;
  uvCustomState.PZ = PZ;
  uvCustomState.THREE = THREE;
  uvCustomState.plugin = context.plugin || {};
  uvCustomState.hadPreviousFactory = Object.prototype.hasOwnProperty.call(
    PZ.material.fnList,
    UV_CUSTOM_MATERIAL_ID
  );
  uvCustomState.previousFactory = PZ.material.fnList[UV_CUSTOM_MATERIAL_ID];
  uvCustomState.factory = Promise.resolve(createMaterialFactory(uvCustomState.plugin));
  uvCustomState.factory._zoidiumMaterialMode = "native";
  PZ.material.fnList[UV_CUSTOM_MATERIAL_ID] = uvCustomState.factory;
}

function deactivate() {
  if (!uvCustomState.active) return;
  for (const material of Array.from(activeMaterials)) uvRestoreObject(material);
  if (uvCustomState.PZ?.material?.fnList?.[UV_CUSTOM_MATERIAL_ID] === uvCustomState.factory) {
    if (uvCustomState.hadPreviousFactory) {
      uvCustomState.PZ.material.fnList[UV_CUSTOM_MATERIAL_ID] = uvCustomState.previousFactory;
    } else {
      delete uvCustomState.PZ.material.fnList[UV_CUSTOM_MATERIAL_ID];
    }
  }
  uvCustomState.active = false;
  uvCustomState.PZ = null;
  uvCustomState.THREE = null;
  uvCustomState.plugin = null;
  uvCustomState.previousFactory = undefined;
  uvCustomState.hadPreviousFactory = false;
  uvCustomState.factory = null;
}

module.exports = {
  UV_CUSTOM_MATERIAL_ID,
  UV_CUSTOM_MATERIAL_NAME,
  activate,
  deactivate,
  isEligibleGeometry: uvIsEligibleGeometry,
  normalizeGeometry: uvNormalizeGeometry,
  prepareContours: uvPrepareContours,
  reconstructContours: uvReconstructContours,
  restoreGeometry: uvRestoreGeometry,
  applyToGeometry: uvApplyToGeometry,
};
