"use strict";

const MAX_REPEATS = 128;
const SCHEMA_VERSION = 2;
const EFFECTOR_SCHEMA_VERSION = 1;
const TWIST_TYPE = "zoidium:repeater/twist";
const WARP_TYPE = "zoidium:repeater/warp";
const DEGREES_TO_RADIANS = Math.PI / 180;
const VORONOI_TYPE = "zoidium:repeater/voronoi-fracture";
const DEFAULT_FRACTURE_CELLS = 24;
const MAX_FRACTURE_CELLS = 1000;
const FRACTURE_LIMITS = Object.freeze({
  maxSourceTriangles: 40000,
  maxOutputTriangles: 400000,
  maxCapVertices: 512,
});
const LEGACY_EFFECTOR_TYPES = Object.freeze({
  7: TWIST_TYPE,
  8: WARP_TYPE,
  9: VORONOI_TYPE,
});

// Preset shape kinds CM3's PZ.object3d.shape.createMesh() names, keyed by the
// serialized objectType. New source shapes added to a repeater are named from
// this table so the tree shows "Box"/"Sphere" instead of the generic "Shape".
const SHAPE_KIND_NAMES = Object.freeze({
  0: "Shape",
  1: "Box",
  2: "Cylinder",
  3: "Rectangle",
  4: "Circle",
  5: "Sphere",
  6: "Donut",
  7: "Wire",
  99: "Geometry",
});

function isPresetShape(object) {
  return Boolean(
    object &&
    typeof object.objectType === "number" &&
    object.properties &&
    object.properties.geometryProperties
  );
}

// CM3's shape.load() calls properties.load() with the picker data, which resets
// the name createMesh() set to the generic default. Restore the kind name for
// freshly added source shapes only; children restored from saved data are
// tagged by load() and keep their stored names.
function nameNewSourceShapes(objects) {
  if (!objects || typeof objects.length !== "number") return;
  for (const source of objects) {
    if (!isPresetShape(source) || source.__zoidiumSourceFromData) continue;
    const name = source.properties.name;
    if (!name || typeof name.set !== "function" || typeof name.get !== "function") continue;
    const current = name.get();
    if (current !== "Shape" && current !== source.defaultName) continue;
    const kind = SHAPE_KIND_NAMES[source.objectType];
    if (kind && kind !== "Shape") name.set(kind);
  }
}

function numberValue(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function integerValue(value, fallback, minimum, maximum) {
  const number = Math.round(numberValue(value, fallback));
  return Math.min(maximum, Math.max(minimum, number));
}

function getCount(property, frame) {
  const currentFrame = Number.isFinite(frame) ? frame : 0;
  return integerValue(property?.get?.(currentFrame), 1, 1, MAX_REPEATS);
}

function getEchoFrame(frame, index, delay) {
  const currentFrame = Math.max(0, numberValue(frame, 0));
  const copyIndex = Math.max(0, Math.trunc(numberValue(index, 0)));
  const frameDelay = Math.max(0, numberValue(delay, 0));
  return Math.max(0, currentFrame - copyIndex * frameDelay);
}

function getEchoFrames(frame, count, delay) {
  const copies = integerValue(count, 1, 1, MAX_REPEATS);
  const frames = [];
  for (let index = 0; index < copies; index += 1) {
    frames.push(getEchoFrame(frame, index, delay));
  }
  return frames;
}

function vectorValue(value, fallback) {
  if (!Array.isArray(value)) return fallback.slice();
  return [
    numberValue(value[0], fallback[0]),
    numberValue(value[1], fallback[1]),
    numberValue(value[2], fallback[2]),
  ];
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function lerp(a, b, amount) {
  return a + (b - a) * amount;
}

function lerpVector(start, end, amount) {
  return [
    lerp(start[0], end[0], amount),
    lerp(start[1], end[1], amount),
    lerp(start[2], end[2], amount),
  ];
}

function scaleVector(value, amount) {
  return [value[0] * amount, value[1] * amount, value[2] * amount];
}

function migrateEffectorData(data) {
  const normalized = data && typeof data === "object" ? data : {};
  const properties = normalized.properties && typeof normalized.properties === "object"
    ? { ...normalized.properties }
    : {};
  if (properties.polygonCount === undefined && properties.smoothness !== undefined) {
    const legacyValue = properties.smoothness;
    const legacyLevel = integerValue(
      legacyValue && typeof legacyValue === "object" ? legacyValue.value : legacyValue,
      2,
      1,
      3
    );
    const polygonCount = 4 ** legacyLevel;
    properties.polygonCount = legacyValue && typeof legacyValue === "object"
      ? { ...legacyValue, value: polygonCount }
      : polygonCount;
  }
  const stored = value => value && typeof value === "object" && !Array.isArray(value) ? value.value : value;
  if (properties.subdivision === undefined && (properties.polygonCount !== undefined || properties.curveQuality !== undefined)) {
    const level = stored(properties.curveQuality) === 0 ? 0 : Math.min(4, Math.max(0, Math.round(Math.log(Math.max(1, numberValue(stored(properties.polygonCount), 16))) / Math.log(4))));
    properties.subdivision = level;
  }
  const legacyField = normalized.legacyField === true || (properties.field !== undefined && properties.fieldFalloff === undefined);
  // CM3 dynamic properties require keyframes, even for a formerly static value.
  for (const key of ["field", "fieldPosition", "fieldScale", "fieldRotation", "fragmentDirection", "fragmentRotation"]) {
    const value = properties[key];
    if (value === undefined || value && (value.keyframes || value.objects || value.expression)) continue;
    properties[key] = { animated: false, keyframes: [{ frame: 0, value: stored(value), tween: key === "field" ? 0 : 1 }] };
  }
  return { ...normalized, legacyField, properties };
}

function seededRandom(seed, index, channel) {
  let value = (Math.trunc(seed) | 0) ^ Math.imul(index + 1, 0x45d9f3b);
  value ^= Math.imul(channel + 1, 0x27d4eb2d);
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  value ^= value >>> 16;
  return (value >>> 0) / 0x100000000;
}

function randomVector(minimum, maximum, seed, index, channelOffset) {
  return [
    lerp(minimum[0], maximum[0], seededRandom(seed, index, channelOffset)),
    lerp(minimum[1], maximum[1], seededRandom(seed, index, channelOffset + 1)),
    lerp(minimum[2], maximum[2], seededRandom(seed, index, channelOffset + 2)),
  ];
}

function safeRange(minimum, maximum) {
  return [
    Math.min(minimum[0], maximum[0]),
    Math.min(minimum[1], maximum[1]),
    Math.min(minimum[2], maximum[2]),
  ];
}

function safeRangeMaximum(minimum, maximum) {
  return [
    Math.max(minimum[0], maximum[0]),
    Math.max(minimum[1], maximum[1]),
    Math.max(minimum[2], maximum[2]),
  ];
}

function getTransform(mode, index, count, controls, seed) {
  if (mode === "linear") {
    const amount = count > 1 ? index / (count - 1) : 0;
    return {
      position: scaleVector(controls.positionEnd, amount),
      rotation: scaleVector(controls.rotationEnd, amount),
      scale: lerpVector([1, 1, 1], controls.scaleEnd, amount),
    };
  }

  if (mode === "random") {
    if (index === 0) {
      return {
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
      };
    }
    const positionMin = safeRange(controls.positionMin, controls.positionMax);
    const positionMax = safeRangeMaximum(controls.positionMin, controls.positionMax);
    const rotationMin = safeRange(controls.rotationMin, controls.rotationMax);
    const rotationMax = safeRangeMaximum(controls.rotationMin, controls.rotationMax);
    const scaleMin = safeRange(controls.scaleMin, controls.scaleMax);
    const scaleMax = safeRangeMaximum(controls.scaleMin, controls.scaleMax);
    return {
      position: randomVector(positionMin, positionMax, seed, index, 0),
      rotation: randomVector(rotationMin, rotationMax, seed, index, 3),
      scale: randomVector(scaleMin, scaleMax, seed, index, 6),
    };
  }

  return {
    position: scaleVector(controls.positionStep, index),
    rotation: scaleVector(controls.rotationStep, index),
    scale: [
      Math.pow(Math.max(0.001, controls.scaleStep[0]), index),
      Math.pow(Math.max(0.001, controls.scaleStep[1]), index),
      Math.pow(Math.max(0.001, controls.scaleStep[2]), index),
    ],
  };
}

function vectorDefinition(PZ, definition) {
  const axisDefinition = (index, fallbackName) => ({
    dynamic: true,
    name: definition.axisNames?.[index] || fallbackName,
    type: PZ.property.type.NUMBER,
    value: definition.value[index],
    ...(definition.min ? { min: definition.min[index] } : {}),
    ...(definition.max ? { max: definition.max[index] } : {}),
    // CM3's own rotation vectors carry the degree-to-radian scaleFactor on the
    // group (used to render the row in degrees while the stored value is in
    // radians) and on each axis (used by the per-axis keyframe controls).
    // Mirror both so the units match CM3's shape rotation.
    ...(definition.scaleFactor ? { scaleFactor: definition.scaleFactor } : {}),
    step: definition.step || 1,
    decimals: definition.decimals ?? 2,
  });

  return {
    dynamic: true,
    group: true,
    name: definition.name,
    type: PZ.property.type.VECTOR3,
    ...(definition.scaleFactor ? { scaleFactor: definition.scaleFactor } : {}),
    ...(definition.linkRatio ? { linkRatio: true } : {}),
    objects: [
      axisDefinition(0, "X"),
      axisDefinition(1, "Y"),
      axisDefinition(2, "Z"),
    ],
  };
}

function createPropertyCategory(PZ, owner, name, definitions) {
  const properties = new PZ.propertyList(definitions, owner);
  Object.defineProperty(properties, "_zoidiumCategoryName", {
    value: name,
    configurable: true,
  });
  const propertyIndex = owner.children.indexOf(owner.properties);
  owner.children.splice(propertyIndex + 1, 0, properties);
  return properties;
}

function makeProperties(PZ, mode, markDirty) {
  const properties = {
    count: {
      dynamic: true,
      name: "Count",
      type: PZ.property.type.NUMBER,
      value: 5,
      min: 1,
      max: MAX_REPEATS,
      step: 1,
      decimals: 0,
      changed: function () {
        markDirty(this.parentObject);
      },
    },
  };

  const rotation = Math.PI / 180;
  if (mode === "step") {
    properties.positionStep = vectorDefinition(PZ, {
      name: "Position",
      value: [10, 0, 0],
      step: 1,
      decimals: 2,
    });
    properties.rotationStep = vectorDefinition(PZ, {
      name: "Rotation",
      value: [0, 0, 0],
      scaleFactor: rotation,
      step: 1,
      decimals: 1,
    });
    properties.scaleStep = vectorDefinition(PZ, {
      name: "Scale",
      value: [1, 1, 1],
      min: [0.001, 0.001, 0.001],
      step: 0.01,
      decimals: 3,
      linkRatio: true,
    });
  } else if (mode === "linear") {
    properties.positionEnd = vectorDefinition(PZ, {
      name: "Position",
      value: [40, 0, 0],
      step: 1,
      decimals: 2,
    });
    properties.rotationEnd = vectorDefinition(PZ, {
      name: "Rotation",
      // Rotation vectors store radians, like CM3's own shape rotation. 90
      // degrees is the intended default, so store Math.PI / 2.
      value: [0, 0, Math.PI / 2],
      scaleFactor: rotation,
      step: 1,
      decimals: 1,
    });
    properties.scaleEnd = vectorDefinition(PZ, {
      name: "Scale",
      value: [1, 1, 1],
      min: [0.001, 0.001, 0.001],
      step: 0.01,
      decimals: 3,
      linkRatio: true,
    });
  } else if (mode === "random") {
    properties.positionMin = vectorDefinition(PZ, {
      name: "Min position",
      value: [-10, -10, -10],
      step: 1,
      decimals: 2,
    });
    properties.positionMax = vectorDefinition(PZ, {
      name: "Max position",
      value: [10, 10, 10],
      step: 1,
      decimals: 2,
    });
    properties.rotationMin = vectorDefinition(PZ, {
      name: "Min rotation",
      value: [0, 0, 0],
      scaleFactor: rotation,
      step: 1,
      decimals: 1,
    });
    properties.rotationMax = vectorDefinition(PZ, {
      name: "Max rotation",
      value: [0, 0, 0],
      scaleFactor: rotation,
      step: 1,
      decimals: 1,
    });
    properties.scaleMin = vectorDefinition(PZ, {
      name: "Min scale",
      value: [1, 1, 1],
      min: [0.001, 0.001, 0.001],
      step: 0.01,
      decimals: 3,
      linkRatio: true,
    });
    properties.scaleMax = vectorDefinition(PZ, {
      name: "Max scale",
      value: [1, 1, 1],
      min: [0.001, 0.001, 0.001],
      step: 0.01,
      decimals: 3,
      linkRatio: true,
    });
    properties.seed = {
      name: "Seed",
      type: PZ.property.type.NUMBER,
      value: 1,
      step: 1,
      decimals: 0,
    };
  }

  if (mode === "echo") {
    properties.delay = {
      dynamic: true,
      name: "Offset",
      type: PZ.property.type.NUMBER,
      value: 5,
      min: 0,
      max: 100000,
      step: 1,
      decimals: 3,
      changed: function () {
        markDirty(this.parentObject);
      },
    };
  }

  return properties;
}

function objectSignature(root, output) {
  if (!root) {
    output.push("null");
    return;
  }
  const geometry = root.geometry?.uuid || "";
  const material = Array.isArray(root.material)
    ? root.material.map((item) => item?.uuid || "").join(",")
    : root.material?.uuid || "";
  output.push(`${root.uuid || ""}:${geometry}:${material}:${root.children.length}`);
  for (const child of root.children) objectSignature(child, output);
}

function copyObjectState(source, target) {
  if (!source || !target) return;
  target.position.copy(source.position);
  target.quaternion.copy(source.quaternion);
  target.scale.copy(source.scale);
  target.visible = source.visible;
  target.matrixAutoUpdate = source.matrixAutoUpdate;
  if (source.rotation?.order) target.rotation.order = source.rotation.order;
  if (source.layers && target.layers) target.layers.mask = source.layers.mask;
  target.renderDepth = source.renderDepth;
  const length = Math.min(source.children.length, target.children.length);
  for (let index = 0; index < length; index += 1) {
    copyObjectState(source.children[index], target.children[index]);
  }
}

function cloneMaterial(material) {
  const clone = material && typeof material.clone === "function"
    ? material.clone()
    : material;
  if (clone === material || !material?.uniforms || !clone?.uniforms) return clone;

  // ShaderMaterial.clone() in Three.js r91 clones Texture uniforms into new
  // Texture objects whose upload version is zero. Reuse the source textures
  // while keeping scalar and vector uniforms, such as particle time, isolated
  // for each echo.
  for (const [name, sourceUniform] of Object.entries(material.uniforms)) {
    if (sourceUniform?.value?.isTexture && clone.uniforms[name]) {
      clone.uniforms[name].value = sourceUniform.value;
    }
  }
  return clone;
}

function copyRenderCallbacks(source, target) {
  if (!source || !target) return;
  for (const name of ["onBeforeRender", "onAfterRender"]) {
    if (Object.prototype.hasOwnProperty.call(source, name)) {
      target[name] = source[name];
    }
  }
  const length = Math.min(
    source.children?.length || 0,
    target.children?.length || 0
  );
  for (let index = 0; index < length; index += 1) {
    copyRenderCallbacks(source.children[index], target.children[index]);
  }
}

function cloneRenderTree(source) {
  const clone = source.clone(true);
  clone.traverse((node) => {
    if (node.geometry && typeof node.geometry.clone === "function") {
      node.geometry = node.geometry.clone();
    }
    if (Array.isArray(node.material)) {
      node.material = node.material.map(cloneMaterial);
    } else if (node.material) {
      node.material = cloneMaterial(node.material);
    }
  });
  copyRenderCallbacks(source, clone);
  markGeneratedRenderTree(clone);
  return clone;
}

function disposeClonedResources(root) {
  if (!root?.traverse) return;
  restoreDeformedTree(root);
  root.traverse((node) => {
    node.geometry?.dispose?.();
    const materials = Array.isArray(node.material)
      ? node.material
      : node.material
        ? [node.material]
        : [];
    for (const material of materials) material?.dispose?.();
  });
}

function markGeneratedRenderTree(root) {
  root?.traverse?.((node) => {
    if (node?.isMesh) node.__zoidiumEffectorGeneratedClone = true;
  });
}

function createEffectorBaseClass(PZ, THREE) {
  const GroupBase = PZ.object3d.group || PZ.object3d;
  return class EffectorObject extends GroupBase {
    constructor() {
      super();
      this.threeObj = null;
      if (!this.objects) this.objects = new PZ.objectList(this, PZ.object3d);
      this.objects.name = "Source objects";
      if (!this.children.includes(this.objects)) this.children.push(this.objects);
      // Name freshly added source shapes after their kind, as the repeaters do.
      this._onObjectsChanged = () => {
        Promise.resolve().then(() => nameNewSourceShapes(this.objects));
      };
      this.objects.onListChanged?.watch?.(this._onObjectsChanged);
      if (PZ.object3d.group?.propertyDefinitions) {
        this.properties.addAll(PZ.object3d.group.propertyDefinitions);
      }
      if (!this.properties.enabled) {
        this.properties.addAll({
          enabled: {
            dynamic: true,
            name: "Enabled",
            type: PZ.property.type.OPTION,
            value: 1,
            items: "off;on",
          },
        });
      }
    }

    load(data) {
      const normalized = migrateEffectorData(data);
      this._legacyField = normalized.legacyField;
      this.threeObj = new THREE.Object3D();
      this.threeObj.__zoidiumEffectorOwner = this;
      this.properties.load(normalized.properties);
      if (this.threeObj.layers && this.properties.reflectionVisibility) {
        const visibility = optionPropertyValue(this.properties.reflectionVisibility, 0, 0);
        this.threeObj.layers.mask = 0;
        if (visibility === 0 || visibility === 2) this.threeObj.layers.enable?.(0);
        if (visibility === 1 || visibility === 2) this.threeObj.layers.enable?.(10);
      }
      if (this.customProperties && Array.isArray(normalized.customProperties)) {
        for (const propertyData of normalized.customProperties) {
          if (!propertyData || typeof PZ.property?.create !== "function") continue;
          const property = PZ.property.create(propertyData.type);
          this.customProperties.push(property);
          property.load(propertyData);
        }
      }
      if (Array.isArray(normalized.objects)) {
        for (const childData of normalized.objects) {
          if (!childData || childData.type === undefined) continue;
          const child = PZ.object3d.create(childData.type);
          this.objects.push(child);
          child.loading = child.load(childData);
        }
      }
      // Restored children keep their stored names; later additions are renamed.
      for (const source of this.objects) source.__zoidiumSourceFromData = true;
      this.properties.name.set(PZ.object3d.getName(this));
      this.parentChanged();
    }

    toJSON() {
      const data = {
        type: this.type,
        schemaVersion: EFFECTOR_SCHEMA_VERSION,
        legacyField: this._legacyField === true,
        properties: this.properties,
        objects: this.objects,
      };
      if (this.customProperties) data.customProperties = this.customProperties;
      return data;
    }

    update(frame) {
      const currentFrame = Number.isFinite(frame) ? frame : 0;
      if (this.threeObj) {
        if (this.properties.enabled) {
          this.threeObj.visible = optionPropertyValue(this.properties.enabled, currentFrame, 1) === 1;
        }
        if (this.threeObj.position && this.properties.position) {
          this.threeObj.position.set(
            ...vectorValue(propertyValue(this.properties.position, currentFrame, [0, 0, 0]), [0, 0, 0])
          );
        }
        if (this.threeObj.rotation && this.properties.rotation) {
          this.threeObj.rotation.set(
            ...vectorValue(propertyValue(this.properties.rotation, currentFrame, [0, 0, 0]), [0, 0, 0])
          );
        }
        if (this.threeObj.scale && this.properties.scale) {
          this.threeObj.scale.set(
            ...vectorValue(propertyValue(this.properties.scale, currentFrame, [1, 1, 1]), [1, 1, 1])
          );
        }
        if (this.properties.eulerOrder) {
          this.threeObj.rotation.order = propertyValue(this.properties.eulerOrder, currentFrame, "XYZ");
        }
      }
      for (const child of this.objects) child.update(frame);
    }

    async prepare(frame) {
      for (const child of this.objects) {
        await child.loading;
        await child.prepare(frame);
      }
      await deformationSupport?.prepareObject?.(this, frame);
    }

    unload() {
      restoreDeformedTree(this.threeObj);
      this.objects.onListChanged?.unwatch?.(this._onObjectsChanged);
      for (const child of this.objects) child.unload();
      if (this.threeObj?.parent) this.threeObj.parent.remove(this.threeObj);
      this.threeObj = null;
    }
  };
}

function propertyValue(property, frame, fallback) {
  if (!property) return fallback;
  try {
    const value = typeof property.get === "function" ? property.get(frame) : property.value;
    return value === undefined ? fallback : value;
  } catch (_error) {
    return fallback;
  }
}

function numberPropertyValue(property, frame, fallback) {
  return numberValue(propertyValue(property, frame, fallback), fallback);
}

function optionPropertyValue(property, frame, fallback) {
  return Math.round(numberPropertyValue(property, frame, fallback));
}

function fieldFromProperties(properties, frame, legacy = false) {
  return {
    legacy,
    rotation: vectorValue(propertyValue(properties.fieldRotation, frame, [0, 0, 0]), [0, 0, 0]),
    falloff: numberPropertyValue(properties.fieldFalloff, frame, 100),
    curve: optionPropertyValue(properties.fieldCurve, frame, 0),
    invert: optionPropertyValue(properties.fieldInvert, frame, 0) === 1,
    sweep: numberPropertyValue(properties.fieldSweep, frame, 100),
    noiseScale: numberPropertyValue(properties.fieldNoiseScale, frame, 100),
    evolution: numberPropertyValue(properties.fieldNoiseEvolution, frame, 0),
    seed: numberPropertyValue(properties.seed, frame, 1),
    type: optionPropertyValue(properties.field, frame, 0),
    position: vectorValue(propertyValue(properties.fieldPosition, frame, [0, 0, 0]), [0, 0, 0]),
    scale: vectorValue(propertyValue(properties.fieldScale, frame, [100, 100, 100]), [100, 100, 100]),
  };
}

function fieldProperties(PZ) {
  const number = (name, value, min, max) => ({ dynamic: true, name, type: PZ.property.type.NUMBER, value, min, max, step: 1, decimals: 1 });
  const option = (name, value, items) => ({ dynamic: true, name, type: PZ.property.type.OPTION, value, items });
  const vector = (name, value, min) => vectorDefinition(PZ, { name, value, min: min === undefined ? undefined : [min, min, min], step: 1, decimals: 1 });
  return {
    field: option("Field", 0, "infinite;linear;box;sphere;cylinder;noise"),
    fieldPosition: vector("Field position", [0, 0, 0]),
    fieldRotation: vector("Field rotation", [0, 0, 0]),
    fieldScale: vector("Field scale", [100, 100, 100], 0.01),
    fieldFalloff: number("Falloff", 100, 0, 100),
    fieldCurve: option("Falloff curve", 0, "linear;smooth;ease in;ease out"),
    fieldInvert: option("Invert field", 0, "off;on"),
    fieldSweep: number("Sweep", 100, 0, 100),
    fieldNoiseScale: number("Noise scale", 100, 0.01, 10000),
    fieldNoiseEvolution: number("Noise evolution", 0),
  };
}

// Pure evaluation lives in effector-core.js and effector-fracture.js. These
// holders are set by loadEffectorLibrary() and are read at evaluation time.
let library = loadLibraryFromRequire();
let meshDeformerCache = null;
let meshDeformerThree = null;
let meshJobs = null;
let deformationSupport = null;
let cancelRedraw = null;
const warnedMessages = new Set();

function warnOnceFor(key, message) {
  if (warnedMessages.has(key)) return;
  warnedMessages.add(key);
  console.warn(message);
}

function getMeshDeformer(THREE) {
  if (!meshDeformerCache || meshDeformerThree !== THREE) {
    meshDeformerCache = library.mesh.createMeshDeformer(THREE, meshJobs);
    meshDeformerThree = THREE;
  }
  return meshDeformerCache;
}

function restoreDeformedTree(root) {
  if (meshDeformerCache) meshDeformerCache.restoreTree(root);
}

function createTwistClass(PZ, THREE, type = TWIST_TYPE) {
  const BaseEffector = createEffectorBaseClass(PZ, THREE);
  class TwistObject extends BaseEffector {
    constructor() {
      super();
      this.properties.addAll({
        axis: {
          name: "Axis",
          type: PZ.property.type.OPTION,
          value: 1,
          items: "X;Y;Z",
        },
        subdivision: {
          name: "Subdivision", type: PZ.property.type.OPTION,
          value: 2, items: "1;2;4;8;16",
        },
        angle: {
          dynamic: true,
          name: "Angle",
          type: PZ.property.type.NUMBER,
          value: 0,
          min: -1440,
          max: 1440,
          step: 1,
          decimals: 1,
          scaleFactor: DEGREES_TO_RADIANS,
        },
        offset: {
          dynamic: true,
          name: "Offset",
          type: PZ.property.type.NUMBER,
          value: 0,
          step: 1,
          decimals: 2,
        },
        ...fieldProperties(PZ),
      });
      this.type = type;
    }

    workerCommand(frame) {
      return { kind: "twist", angle: numberPropertyValue(this.properties.angle, frame, 0),
        axis: optionPropertyValue(this.properties.axis, frame, 1), offset: numberPropertyValue(this.properties.offset, frame, 0), field: fieldFromProperties(this.properties, frame, this._legacyField) };
    }

    // Pure function of (positions, angle, axis, offset) at this frame.
    deformPositions(positions, frame, context) {
      const angle = numberPropertyValue(this.properties.angle, frame, 0);
      if (!angle) return positions;
      return library.core.twistPositions(
        positions,
        angle,
        optionPropertyValue(this.properties.axis, frame, 1),
        numberPropertyValue(this.properties.offset, frame, 0),
        library.core.fieldForBounds(fieldFromProperties(this.properties, frame, this._legacyField), context?.bounds),
        context?.bounds
      );
    }
  }

  TwistObject.prototype.defaultName = "Twist";
  return TwistObject;
}

function createWarpClass(PZ, THREE, type = WARP_TYPE) {
  const BaseEffector = createEffectorBaseClass(PZ, THREE);
  class WarpObject extends BaseEffector {
    constructor() {
      super();
      this.properties.addAll({
        axis: {
          name: "Axis",
          type: PZ.property.type.OPTION,
          value: 0,
          items: "X;Z",
        },
        subdivision: {
          name: "Subdivision", type: PZ.property.type.OPTION,
          value: 2, items: "1;2;4;8;16",
        },
        amount: {
          dynamic: true,
          name: "Strength",
          type: PZ.property.type.NUMBER,
          value: 0,
          min: -720,
          max: 720,
          step: 1,
          decimals: 1,
          scaleFactor: DEGREES_TO_RADIANS,
        },
        offset: {
          dynamic: true,
          name: "Offset",
          type: PZ.property.type.NUMBER,
          value: 0,
          step: 1,
          decimals: 2,
        },
        ...fieldProperties(PZ),
      });
      this.type = type;
    }

    workerCommand(frame) {
      return { kind: "warp", strength: numberPropertyValue(this.properties.amount, frame, 0),
        axis: optionPropertyValue(this.properties.axis, frame, 0), offset: numberPropertyValue(this.properties.offset, frame, 0),
        field: fieldFromProperties(this.properties, frame, this._legacyField) };
    }

    deformPositions(positions, frame, context) {
      const strength = numberPropertyValue(this.properties.amount, frame, 0);
      if (!strength) return positions;
      return library.core.warpPositions(
        positions,
        strength,
        optionPropertyValue(this.properties.axis, frame, 0),
        numberPropertyValue(this.properties.offset, frame, 0),
        library.core.fieldForBounds(fieldFromProperties(this.properties, frame, this._legacyField), context?.bounds),
        context?.bounds
      );
    }
  }

  WarpObject.prototype.defaultName = "Warp";
  return WarpObject;
}

function createPlainClass(PZ, THREE) {
  const Base = createEffectorBaseClass(PZ, THREE);
  class Plain extends Base {
    constructor() {
      super();
      const vector = (name, value) => vectorDefinition(PZ, { name, value, step: 0.1, decimals: 2 });
      this.properties.addAll({
        offsetPosition: vector("Position offset", [0, 0, 0]),
        offsetRotation: vector("Rotation offset", [0, 0, 0]),
        offsetScale: vector("Scale offset", [0, 0, 0]),
        uniformScale: { dynamic: true, name: "Uniform scale", type: PZ.property.type.NUMBER, value: 0, step: 0.1 },
        ...fieldProperties(PZ),
      });
      this.type = "zoidium:repeater/plain";
    }
    workerCommand(frame) {
      const vector = name => vectorValue(propertyValue(this.properties[name], frame, [0, 0, 0]), [0, 0, 0]);
      const uniform = numberPropertyValue(this.properties.uniformScale, frame, 0);
      return { kind: "plain", position: vector("offsetPosition"), rotation: vector("offsetRotation"),
        scale: vector("offsetScale").map(v => 1 + v + uniform), field: fieldFromProperties(this.properties, frame, this._legacyField) };
    }
    deformPositions(positions, frame, context) {
      const command = this.workerCommand(frame);
      command.field = library.core.fieldForBounds(command.field, context?.bounds);
      return library.core.plainPositions(positions, context.stage, command);
    }
  }
  Plain.prototype.defaultName = "Plain";
  return Plain;
}

function createDelayClass(PZ, THREE) {
  const Base = createEffectorBaseClass(PZ, THREE);
  class Delay extends Base {
    constructor() {
      super();
      this.properties.addAll({
        mode: { name: "Mode", type: PZ.property.type.OPTION, value: 0, items: "Blend;Average;Spring" },
        strength: { dynamic: true, name: "Strength", type: PZ.property.type.NUMBER, value: 75, min: 0, max: 100 },
        window: { name: "History frames", type: PZ.property.type.NUMBER, value: 12, min: 1, max: 24, decimals: 0 },
      });
      this.type = "zoidium:repeater/delay";
    }
    workerCommand(frame) {
      return { kind: "delay", mode: optionPropertyValue(this.properties.mode, frame, 0),
        strength: numberPropertyValue(this.properties.strength, frame, 75) / 100,
        window: integerValue(propertyValue(this.properties.window, frame, 12), 12, 1, 24) };
    }
    deformPositions(positions) { return positions; }
  }
  Delay.prototype.defaultName = "Delay";
  return Delay;
}

function createVoronoiClass(PZ, THREE, type = VORONOI_TYPE) {
  const BaseEffector = createEffectorBaseClass(PZ, THREE);
  class VoronoiObject extends BaseEffector {
    constructor() {
      super();
      this.properties.addAll({
        distribution: { name: "Distribution", type: PZ.property.type.OPTION, value: 0, items: "uniform;surface;center;edges" },
        cellScale: { name: "Cell scale", type: PZ.property.type.VECTOR3, value: [100, 100, 100], min: 0.01, step: 1, decimals: 1 },
        cells: {
          name: "Cells",
          type: PZ.property.type.NUMBER,
          value: DEFAULT_FRACTURE_CELLS,
          min: 1,
          max: MAX_FRACTURE_CELLS,
          step: 1,
          decimals: 0,
        },
        seed: {
          name: "Seed",
          type: PZ.property.type.NUMBER,
          value: 1,
          step: 1,
          decimals: 0,
        },
        closed: {
          name: "Inner faces",
          type: PZ.property.type.OPTION,
          value: 1,
          items: "open;closed",
        },
        offset: {
          dynamic: true,
          name: "Offset fragments",
          type: PZ.property.type.NUMBER,
          value: 0,
          min: 0,
          max: 100,
          step: 1,
          decimals: 1,
        },
        colors: {
          name: "Fragment colors",
          type: PZ.property.type.OPTION,
          value: 1,
          items: "material;random",
        },
        distance: {
          dynamic: true,
          name: "Distance",
          type: PZ.property.type.NUMBER,
          value: 0,
          min: -1000,
          max: 1000,
          step: 1,
          decimals: 2,
        },
        scatter: {
          dynamic: true,
          name: "Scatter",
          type: PZ.property.type.NUMBER,
          value: 0,
          min: -1000,
          max: 1000,
          step: 1,
          decimals: 2,
        },
        spin: {
          dynamic: true,
          name: "Spin",
          type: PZ.property.type.NUMBER,
          value: 0,
          min: -3600,
          max: 3600,
          step: 1,
          decimals: 1,
          scaleFactor: DEGREES_TO_RADIANS,
        },
        fragmentDirection: vectorDefinition(PZ, { name: "Direction", value: [0, 0, 0], step: 1, decimals: 2 }),
        fragmentRotation: vectorDefinition(PZ, { name: "Rotation", value: [0, 0, 0], step: 1, decimals: 1 }),
        fragmentScale: { dynamic: true, name: "Fragment scale", type: PZ.property.type.NUMBER, value: 100, min: 0, max: 1000, step: 1, decimals: 1 },
        gravity: { dynamic: true, name: "Gravity", type: PZ.property.type.NUMBER, value: 0, min: -1000, max: 1000, step: 1, decimals: 2 },
        randomness: { dynamic: true, name: "Randomness", type: PZ.property.type.NUMBER, value: 0, min: 0, max: 100, step: 1, decimals: 1 },
        ...fieldProperties(PZ),
      });
      this.type = type;
    }

    workerCommand(frame) {
      return { kind: "fracture", topology: {
        cells: library.fracture.clampCells(numberPropertyValue(this.properties.cells, frame, DEFAULT_FRACTURE_CELLS)),
        seed: Math.trunc(numberPropertyValue(this.properties.seed, frame, 1)),
        closed: optionPropertyValue(this.properties.closed, frame, 1) === 1,
        distribution: optionPropertyValue(this.properties.distribution, frame, 0),
        cellScale: vectorValue(propertyValue(this.properties.cellScale, frame, [100, 100, 100]), [100, 100, 100]),
      }, limits: FRACTURE_LIMITS, motion: {
        distance: numberPropertyValue(this.properties.distance, frame, 0),
        scatter: numberPropertyValue(this.properties.scatter, frame, 0),
        offset: numberPropertyValue(this.properties.offset, frame, 0),
        spin: numberPropertyValue(this.properties.spin, frame, 0),
        direction: vectorValue(propertyValue(this.properties.fragmentDirection, frame, [0, 0, 0]), [0, 0, 0]),
        rotation: vectorValue(propertyValue(this.properties.fragmentRotation, frame, [0, 0, 0]), [0, 0, 0]),
        fragmentScale: numberPropertyValue(this.properties.fragmentScale, frame, 100),
        gravity: numberPropertyValue(this.properties.gravity, frame, 0),
        randomness: numberPropertyValue(this.properties.randomness, frame, 0),
        field: fieldFromProperties(this.properties, frame, this._legacyField),
      } };
    }

    // Topology stage: cached by the mesh deformer per (input, cells, seed, closed).
    produceStage(positions, stage, frame, derive) {
      const topology = this.workerCommand(frame).topology;
      const key = "voronoi:" + JSON.stringify(topology);
      return derive(stage, key, positions, () => {
        const result = library.fracture.buildVoronoiFracture(
          { positions, index: stage.index, uvs: stage.uvs, normals: stage.attributes.normal?.array },
          topology,
          FRACTURE_LIMITS
        );
        if (result.error) {
          warnOnceFor(
            "voronoi:" + result.error,
            "Voronoi Fracture skipped this mesh: " + fractureErrorText(result.error) + "."
          );
          return null;
        }
        return result;
      });
    }

    surfaceOptions(frame) {
      return { vertexColors: optionPropertyValue(this.properties.colors, frame, 1) === 1 };
    }

    // Per-frame motion of the cached pieces. Pure in (time, properties).
    deformPositions(positions, frame, context) {
      const stage = context && context.stage;
      if (!stage || !stage.pieceIds) return positions;
      return library.fracture.applyFragmentMotion(
        positions,
        stage,
        this.workerCommand(frame).motion,
        context.matrix || null
      );
    }
  }

  VoronoiObject.prototype.defaultName = "Voronoi Fracture";
  return VoronoiObject;
}

function fractureErrorText(code) {
  if (code === "work-limit") return "the source and cell count exceed the fracture work budget; reduce Cells or simplify the source";
  if (code === "source-limit") return "the source mesh has more than " + FRACTURE_LIMITS.maxSourceTriangles + " triangles";
  if (code === "output-limit") return "the fracture would exceed " + FRACTURE_LIMITS.maxOutputTriangles + " triangles";
  if (code === "empty") return "the mesh has no triangles";
  if (code === "degenerate") return "the mesh has no extent";
  return "the geometry is invalid";
}

// Use the highest uniform subdivision level requested by active deformers.
function curvePolygonCount(effectors, frame) {
  let polygonCount = 1;
  for (const effector of effectors) {
    const p = effector.properties;
    const intensity = p.angle || p.amount;
    if (intensity && !numberPropertyValue(intensity, frame, 0)) continue;
    if (p.subdivision) polygonCount = Math.max(polygonCount, 4 ** library.core.clampIndex(optionPropertyValue(p.subdivision, frame, 2), 4));
    else if (p.curveQuality && optionPropertyValue(p.curveQuality, frame, 1)) polygonCount = Math.max(polygonCount, library.core.subdivisionPolygons(numberPropertyValue(p.polygonCount, frame, 16)));
  }
  return polygonCount;
}

function traverseDeformMeshes(root, callback) {
  if (!root?.traverse) return;
  root.traverse((mesh) => {
    if (mesh?.isMesh && mesh.geometry) callback(mesh);
  });
}

function findRenderNodePath(root, target, path = []) {
  if (!root || !target) return null;
  if (root === target) return path;
  if (!Array.isArray(root.children)) return null;
  for (let index = 0; index < root.children.length; index += 1) {
    const result = findRenderNodePath(root.children[index], target, path.concat(index));
    if (result) return result;
  }
  return null;
}

function getRenderNode(root, path) {
  let node = root;
  for (const index of path || []) node = node?.children?.[index];
  return node || null;
}

// CM3 constructs BoxHelper at selection time. Field guides use that same
// editor-only layer, never the scene's render/export layer or a separate panel.
function installFieldHelpers(THREE) {
  const Original = THREE.BoxHelper, helpers = new Set();
  if (!Original || !THREE.LineSegments || !THREE.LineBasicMaterial) return () => {};
  function FieldHelper(root, color) {
    for (const helper of helpers) if (!helper.parent) {
      helper.geometry.dispose(); helper.material.dispose(); helpers.delete(helper);
    }
    const owner = root?.__zoidiumEffectorOwner;
    if (!owner) return new Original(root, color);
    const geometry = new THREE.BufferGeometry();
    geometry.addAttribute("position", new THREE.BufferAttribute(new Float32Array(4096 * 3), 3));
    geometry.attributes.position.dynamic = true;
    geometry.setDrawRange(0, 0);
    const material = new THREE.LineBasicMaterial({ color: 0xffa040, depthTest: false, transparent: true, opacity: 0.8 });
    const helper = new THREE.LineSegments(geometry, material);
    helper.frustumCulled = false;
    helper.layers.set(1);
    helper.update = () => {
      const frame = owner._effectorFrame || 0;
      const field = library.core.fieldForBounds(fieldFromProperties(owner.properties, frame, owner._legacyField), owner._fieldBounds);
      const key = JSON.stringify(field);
      if (helper._fieldKey !== key) {
        helper._fieldKey = key;
        const points = fieldGuidePoints(field);
        geometry.attributes.position.array.set(points);
        geometry.attributes.position.needsUpdate = true;
        geometry.setDrawRange(0, points.length / 3);
      }
      helper.matrixAutoUpdate = false;
      helper.matrix.copy(root.matrixWorld);
      helper.matrixWorld.copy(root.matrixWorld);
    };
    helper.onBeforeRender = helper.update;
    helper.update();
    helpers.add(helper);
    return helper;
  }
  FieldHelper.prototype = Original.prototype;
  THREE.BoxHelper = FieldHelper;
  return () => {
    if (THREE.BoxHelper === FieldHelper) THREE.BoxHelper = Original;
    for (const helper of helpers) {
      helper.parent?.remove(helper); helper.geometry.dispose(); helper.material.dispose();
    }
    helpers.clear();
  };
}

function fieldGuidePoints(field) {
  const points = [], type = field?.type;
  if (!type || type === 5) return points;
  const legacy = (field.legacy || field.falloff === undefined) &&
    (field.rotation || [0, 0, 0]).every(v => !v) && (field.sweep ?? 100) === 100 &&
    (field.falloff ?? 100) === 100 && !field.curve && !field.invert;
  const scale = legacy ? field.scale : field.worldScale || field.scale;
  const radii = legacy && type === 3 ? [0, 1, 2].map(() => Math.max(Math.abs(scale[0]), 0.001)) :
    scale.map(v => Math.max(Math.abs(v), 0.001) / 2);
  const line = (a, b) => {
    for (const p of [a, b]) {
      const q = library.core.rotateXYZ(p, field.rotation || [0, 0, 0]);
      points.push(...q.map((v, i) => v + field.position[i]));
    }
  };
  const falloff = Math.max(0, Math.min(1, (field.falloff ?? 100) / 100));
  const extents = legacy && type === 2 ? [1, 2] : falloff > 0 && falloff < 1 ? [1, 1 - falloff] : [1];
  for (const ratio of extents) {
    const r = radii.map(v => v * ratio);
    if (type === 1) {
      const width = legacy ? Math.abs(scale[0]) : Math.max((field.high - field.low) * falloff, 0.001);
      const plane = legacy ? 0 : field.low - width + (field.high - field.low + width) * field.sweep / 100;
      for (const x of [plane, plane + width]) {
        const corners = [[x, -r[1], -r[2]], [x, r[1], -r[2]], [x, r[1], r[2]], [x, -r[1], r[2]]];
        for (let i = 0; i < 4; i++) line(corners[i], corners[(i + 1) % 4]);
      }
      break;
    }
    if (type === 2) {
      const corners = Array.from({ length: 8 }, (_, i) => r.map((v, a) => i & (1 << a) ? v : -v));
      for (let i = 0; i < 8; i++) for (let a = 0; a < 3; a++) if (!(i & (1 << a))) line(corners[i], corners[i | (1 << a)]);
    } else {
      const circle = (a, b, fixedAxis, fixedValue) => {
        for (let i = 0; i < 48; i++) {
          const p = [0, 0, 0], q = [0, 0, 0];
          p[a] = r[a] * Math.cos(i * Math.PI / 24); p[b] = r[b] * Math.sin(i * Math.PI / 24);
          q[a] = r[a] * Math.cos((i + 1) * Math.PI / 24); q[b] = r[b] * Math.sin((i + 1) * Math.PI / 24);
          if (fixedAxis !== undefined) p[fixedAxis] = q[fixedAxis] = fixedValue;
          line(p, q);
        }
      };
      if (type === 3) { circle(0, 1); circle(1, 2); circle(2, 0); }
      if (type === 4) {
        circle(0, 2, 1, -r[1]); circle(0, 2, 1, r[1]);
        for (const a of [0, 2]) for (const sign of [-1, 1]) {
          const p = [0, -r[1], 0], q = [0, r[1], 0]; p[a] = q[a] = sign * r[a]; line(p, q);
        }
      }
    }
  }
  return points;
}

function createDeformationSupport(PZ, THREE) {
  const sceneClass = PZ.layer?.scene;
  const prototype = sceneClass?.prototype;
  if (!prototype || typeof prototype.update !== "function") {
    throw new Error("Effector requires the CM3 3D scene update API.");
  }
  if (prototype.__zoidiumEffectorDeformPatch) {
    return {
      deactivate() {},
      apply: prototype.__zoidiumEffectorDeformSupport?.apply,
      prepareObject: prototype.__zoidiumEffectorDeformSupport?.prepareObject,
    };
  }

  const layers = new Set();
  const originalUpdate = prototype.update;
  const originalPrepare = prototype.prepare;
  const originalUnload = prototype.unload;
  const meshDeformer = getMeshDeformer(THREE);
  const disposeFieldHelpers = installFieldHelpers(THREE);

  let preparingMeshes = null;
  let tasks = null;
  function deformMeshesUnder(root, chain, frame) {
    const polygonCount = curvePolygonCount(chain.map((entry) => entry.effector), frame);
    traverseDeformMeshes(root, (mesh) => {
      preparingMeshes?.add(mesh);
      if (tasks) tasks.push({ mesh, chain, frame, polygonCount });
      else meshDeformer.deformMesh(mesh, chain, frame, polygonCount);
    });
  }

  // The chain lists enabled deformers from outermost to innermost. Each entry
  // keeps the render node that carries the deformer's transform, so deformers
  // evaluate in their own frame.
  function walkRenderedObject(object, chain, frame, renderRoot) {
    if (!object) return;
    const liveRoot = renderRoot || object.threeObj;
    if (liveRoot) liveRoot.__zoidiumEffectorTransformOwner = object;
    const isDeformer = typeof object.deformPositions === "function";
    const enabled = !object.properties?.enabled ||
      optionPropertyValue(object.properties.enabled, frame, 1) === 1;
    const nextChain = isDeformer && enabled
      ? chain.concat({ effector: object, node: renderRoot || object.threeObj })
      : chain;

    if (object.__zoidiumRepeater) {
      const sources = object.objects && typeof object.objects.length === "number"
        ? Array.from(object.objects)
        : [];
      for (const instance of object._instanceRoots || []) {
        for (const clone of instance.clones || []) {
          const sourceObject = sources.find((source) => source?.threeObj === clone.source);
          if (sourceObject) {
            walkRenderedObject(sourceObject, nextChain, frame, clone.clone);
          } else {
            deformMeshesUnder(clone.clone, nextChain, frame);
          }
        }
      }
      return;
    }

    if (object.objects && typeof object.objects.length === "number") {
      const sourceRoot = object.threeObj;
      for (const child of object.objects) {
        const path = findRenderNodePath(sourceRoot, child?.threeObj);
        const childRoot = path ? getRenderNode(renderRoot || sourceRoot, path) : null;
        walkRenderedObject(child, nextChain, frame, childRoot);
      }
      return;
    }
    deformMeshesUnder(renderRoot || object.threeObj, nextChain, frame);
  }

  function walk(objects, chain, frame) {
    if (!objects || typeof objects.length !== "number") return;
    for (const object of objects) {
      walkRenderedObject(object, chain, frame, object?.threeObj);
    }
  }

  function restoreRenderedObject(object, seen) {
    if (!object || seen.has(object)) return;
    seen.add(object);
    if (object.__zoidiumRepeater) {
      for (const instance of object._instanceRoots || []) restoreDeformedTree(instance.root);
    }
    restoreDeformedTree(object.threeObj);
    if (object.objects && typeof object.objects.length === "number") {
      for (const child of object.objects) restoreRenderedObject(child, seen);
    }
  }

  function evaluateTree(run) {
    tasks = [];
    try {
      run();
      const bounds = new Map();
      for (const task of tasks) {
        const stage = meshDeformer.sourceStage(task.mesh);
        if (!stage) continue;
        for (const entry of task.chain) {
          const relation = library.core.relativeTransform(entry.node?.matrixWorld?.elements, task.mesh.matrixWorld?.elements);
          if (!relation) continue;
          let b = bounds.get(entry.node);
          if (!b) { b = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] }; bounds.set(entry.node, b); }
          const m = relation.forward, p = stage.positions;
          for (let i = 0; i < p.length; i += 3) {
            const x = p[i], y = p[i + 1], z = p[i + 2];
            const qx = m ? m[0] * x + m[4] * y + m[8] * z + m[12] : x;
            const qy = m ? m[1] * x + m[5] * y + m[9] * z + m[13] : y;
            const qz = m ? m[2] * x + m[6] * y + m[10] * z + m[14] : z;
            b.min[0] = Math.min(b.min[0], qx); b.max[0] = Math.max(b.max[0], qx);
            b.min[1] = Math.min(b.min[1], qy); b.max[1] = Math.max(b.max[1], qy);
            b.min[2] = Math.min(b.min[2], qz); b.max[2] = Math.max(b.max[2], qz);
          }
        }
      }
      for (const task of tasks) {
        const chain = task.chain.map(entry => ({ ...entry, bounds: bounds.get(entry.node) }));
        for (const entry of chain) { entry.effector._fieldBounds = entry.bounds; entry.effector._effectorFrame = task.frame; }
        meshDeformer.deformMesh(task.mesh, chain, task.frame, task.polygonCount);
      }
    } finally { tasks = null; }
  }

  function apply(layer, frame) {
    if (!layer?.objects) return;
    layers.add(layer);
    layer.threeObj?.updateMatrixWorld?.(true);
    evaluateTree(() => walk(layer.objects, [], Number.isFinite(frame) ? frame : 0));
  }

  function restore(layer) {
    if (!layer?.objects) return;
    const seen = new Set();
    for (const object of layer.objects) restoreRenderedObject(object, seen);
  }

  // CM3 calls Scene.prepare from sequence.prepare before export getVideoFrame.
  // Update after child preparation to capture animated/generated source meshes.
  async function settle(evaluate) {
    for (;;) {
      const meshes = new Set();
      preparingMeshes = meshes;
      try { evaluate(); } finally { preparingMeshes = null; }
      const pending = meshDeformer.pending(meshes);
      if (!pending.length) return;
      await Promise.all(pending);
    }
  }

  async function prepareObject(object, frame) {
    if (!meshJobs || object.__zoidiumRepeater) return;
    // The outer effector prepares the full chain after its children are ready.
    for (let parent = object.parent; parent && parent !== object; parent = parent.parent) {
      if (typeof parent.deformPositions === "function" || parent.__zoidiumRepeater) return;
      if (parent === parent.parent) break;
    }
    object.update(frame);
    object.parentLayer?.threeObj?.updateMatrixWorld?.(true);
    await settle(() => evaluateTree(() => walkRenderedObject(object, [], frame, object.threeObj)));
  }

  const patchedPrepare = async function prepareWithEffectors(frame, ...args) {
    await originalPrepare?.call(this, frame, ...args);
    if (!meshJobs) return;
    const affected = objects => Array.from(objects || []).some(object =>
      typeof object?.deformPositions === "function" || affected(object?.objects));
    if (!affected(this.objects)) return;
    originalUpdate.call(this, frame);
    await settle(() => apply(this, frame));
  };
  const patchedUnload = function unloadWithEffectors(...args) {
    restore(this);
    layers.delete(this);
    return originalUnload?.apply(this, args);
  };
  prototype.prepare = patchedPrepare;
  prototype.unload = patchedUnload;

  const patchedUpdate = function updateWithEffectors(frame) {
    originalUpdate.call(this, frame);
    apply(this, frame);
  };
  patchedUpdate.__zoidiumEffectorDeformPatch = true;
  prototype.update = patchedUpdate;
  prototype.__zoidiumEffectorDeformPatch = true;
  prototype.__zoidiumEffectorDeformSupport = { apply, restore, prepareObject };

  return {
    apply,
    prepareObject,
    deactivate() {
      for (const layer of layers) restore(layer);
      layers.clear();
      disposeFieldHelpers();
      meshDeformer.dispose();
      if (prototype.prepare === patchedPrepare) prototype.prepare = originalPrepare;
      if (prototype.unload === patchedUnload) prototype.unload = originalUnload;
      if (prototype.update === patchedUpdate) prototype.update = originalUpdate;
      delete prototype.__zoidiumEffectorDeformPatch;
      delete prototype.__zoidiumEffectorDeformSupport;
    },
  };
}

// Numeric types 7/8/9 come from the Davidium Effector+ project format. They
// load as the namespaced classes, and saving writes the namespaced type.
function migrateLegacyEffectorRecord(data) {
  if (!data || typeof data !== "object") return data;
  const mapped = LEGACY_EFFECTOR_TYPES[data.type];
  return mapped ? { ...data, type: mapped } : data;
}

// Loads the pure library from the CommonJS require when running under Node
// tests. Returns null in the Zoidium runtime, where require is undefined.
function loadLibraryFromRequire() {
  if (typeof require !== "function") return null;
  try {
    return {
      core: require("./effector-core.js"),
      fracture: require("./effector-fracture.js"),
      mesh: require("./effector-mesh.js"),
    };
  } catch (_error) {
    return null;
  }
}

// Evaluates the bundled library sources. Each file receives a small require
// shim that resolves sibling names in the same bundle.
function loadLibraryFromAssets(getAsset) {
  if (typeof getAsset !== "function") {
    throw new Error("Effector requires the plugin bundle asset resolver.");
  }
  const cache = new Map();
  const load = (id) => {
    const name = String(id).replace(/^\.\//, "");
    if (cache.has(name)) return cache.get(name).exports;
    const source = getAsset("text", "./plugins/scene-plus/" + name);
    if (typeof source !== "string") {
      throw new Error("Effector is missing its bundled source: " + name);
    }
    const module = { exports: {} };
    cache.set(name, module);
    new Function("module", "exports", "require", source)(module, module.exports, load);
    return module.exports;
  };
  return {
    core: load("effector-core.js"),
    fracture: load("effector-fracture.js"),
    mesh: load("effector-mesh.js"),
    jobs: load("effector-jobs.js"),
    workerSource: load("effector-jobs.js").createWorkerSource(Object.fromEntries(
      ["earcut.js", "effector-core.js", "effector-fracture.js", "effector-mesh.js", "effector-evaluate.js"].map(name =>
        [name, getAsset("text", "./plugins/scene-plus/" + name)]))),
  };
}

function defaultSourceData(data) {
  const normalized = data && typeof data === "object" ? cloneJson(data) : {};
  if (!Array.isArray(normalized.objects)) normalized.objects = [];
  if (!normalized.properties || typeof normalized.properties !== "object") {
    normalized.properties = {};
  }
  if (
    !normalized.repeaterProperties ||
    typeof normalized.repeaterProperties !== "object"
  ) {
    normalized.repeaterProperties = {};
  }
  normalized.schemaVersion = SCHEMA_VERSION;
  return normalized;
}

function createRepeaterClass(PZ, THREE, mode, type) {
  const markDirty = (owner) => owner?.markRepeaterDirty?.();
  const propertyDefinitions = makeProperties(PZ, mode, markDirty);

  return class RepeaterObject extends PZ.object3d.group {
    constructor() {
      super();
      this.__zoidiumRepeater = true;
      this._mode = mode;
      this._instanceRoots = [];
      this._echoKey = null;
      this._cloneDirty = true;
      this._cloneSignature = "";
      this.objects.name = "Source objects";
      this.repeaterProperties = createPropertyCategory(
        PZ,
        this,
        "Repeater",
        propertyDefinitions
      );
      this._onObjectsChanged = () => {
        this.markRepeaterDirty();
        Promise.resolve().then(() => {
          this.nameAddedSourceShapes();
          this.detachTemplateObjects();
        });
      };
      this.objects.onListChanged.watch(this._onObjectsChanged);
      this.type = type;
    }

    markRepeaterDirty() {
      this._cloneDirty = true;
    }

    // Name a freshly added source shape after its kind. Children restored from
    // saved data are tagged in load() and are never renamed.
    nameAddedSourceShapes() {
      nameNewSourceShapes(this.objects);
    }

    detachTemplateObjects() {
      if (!this.threeObj) return;
      for (const source of this.objects) {
        if (source?.threeObj && source.threeObj.parent === this.threeObj) {
          this.threeObj.remove(source.threeObj);
        }
      }
    }

    load(data) {
      const normalized = defaultSourceData(data);
      super.load(normalized);
      // Children restored from saved data keep their stored names; mark them so
      // the deferred namer treats later additions only.
      for (const source of this.objects) source.__zoidiumSourceFromData = true;
      this.repeaterProperties.load(normalized.repeaterProperties);
      this.detachTemplateObjects();
      this.markRepeaterDirty();
    }

    toJSON() {
      const data = super.toJSON();
      data.type = this.type;
      data.schemaVersion = SCHEMA_VERSION;
      data.repeaterProperties = this.repeaterProperties;
      return data;
    }

    async prepare(frame) {
      await super.prepare(frame);
      await Promise.all(this.objects.map((source) => source?.loading));
      this.detachTemplateObjects();
      if (this._mode === "echo") this.rebuildEchoInstances(frame);
      else this.rebuildInstances(frame);
    }

    clearInstances() {
      if (this.threeObj) {
        for (const instance of this._instanceRoots) {
          if (this._mode === "echo") disposeClonedResources(instance.root);
          else restoreDeformedTree(instance.root);
          this.threeObj.remove(instance.root);
        }
      }
      this._instanceRoots = [];
      this._echoKey = null;
    }

    rebuildEchoInstances(frame) {
      if (!this.threeObj) return;
      // Preparation and rendering evaluate the same frame. Reuse those clones
      // so a completed asynchronous deformation survives the render update.
      // Authored source data catches edits to earlier animated keys as well.
      const echoKey = JSON.stringify([frame, this.objects]);
      if (!this._cloneDirty && this._echoKey === echoKey) return;
      this.clearInstances();
      const currentFrame = Math.max(0, numberValue(frame, 0));
      const count = getCount(this.repeaterProperties.count, currentFrame);
      const delay = Math.max(
        0,
        numberValue(this.repeaterProperties.delay?.get?.(currentFrame), 0),
      );
      const sources = this.objects.filter((source) => source?.threeObj);
      const echoFrames = getEchoFrames(currentFrame, count, delay);

      for (let index = 0; index < echoFrames.length; index += 1) {
        const root = new THREE.Object3D();
        root.name = `${this.defaultName || "Echo Repeater"} ${index + 1}`;
        const clones = [];
        const sourceFrame = echoFrames[index];

        // Echoes are evaluated from an explicit source frame. No result from
        // an earlier playback tick is used to construct the current output.
        try {
          for (const source of sources) source.update(sourceFrame);
          for (const source of sources) {
            const clone = cloneRenderTree(source.threeObj);
            root.add(clone);
            clones.push({ source: source.threeObj, clone });
          }
        } finally {
          for (const source of sources) source.update(currentFrame);
        }

        this.threeObj.add(root);
        this._instanceRoots.push({ root, clones, sourceFrame });
      }

      this._cloneDirty = false;
      this._echoKey = echoKey;
    }

    rebuildInstances(frame) {
      if (!this.threeObj) return;
      this.clearInstances();
      const count = getCount(this.repeaterProperties.count, frame);
      const sources = this.objects.filter((source) => source?.threeObj);
      for (let index = 0; index < count; index += 1) {
        const root = new THREE.Object3D();
        root.name = `${this.defaultName || "Repeater"} ${index + 1}`;
        const clones = [];
        for (const source of sources) {
          const clone = source.threeObj.clone(true);
          markGeneratedRenderTree(clone);
          root.add(clone);
          clones.push({ source: source.threeObj, clone });
        }
        this.threeObj.add(root);
        this._instanceRoots.push({ root, clones });
      }
      const signature = [];
      for (const source of sources) objectSignature(source.threeObj, signature);
      this._cloneSignature = signature.join("|");
      this._cloneDirty = false;
    }

    update(frame) {
      super.update(frame);
      this.detachTemplateObjects();
      if (this._mode === "echo") {
        this.rebuildEchoInstances(frame);
        return;
      }
      const sources = this.objects.filter((source) => source?.threeObj);
      const signatureParts = [];
      for (const source of sources) objectSignature(source.threeObj, signatureParts);
      const signature = signatureParts.join("|");
      const count = getCount(this.repeaterProperties.count, frame);
      if (
        this._cloneDirty ||
        signature !== this._cloneSignature ||
        this._instanceRoots.length !== count
      ) {
        this.rebuildInstances(frame);
      }

      const controls = this.readControls(frame);
      const seed = numberValue(this.repeaterProperties.seed?.get?.(), 1);
      for (let index = 0; index < this._instanceRoots.length; index += 1) {
        const instance = this._instanceRoots[index];
        const transform = getTransform(this._mode, index, count, controls, seed);
        instance.root.position.set(...transform.position);
        instance.root.rotation.set(...transform.rotation);
        instance.root.rotation.order = this.properties.eulerOrder.get(frame);
        instance.root.scale.set(...transform.scale);
        for (const clone of instance.clones) copyObjectState(clone.source, clone.clone);
      }
    }

    readControls(frame) {
      const read = (name, fallback) =>
        vectorValue(this.repeaterProperties[name]?.get?.(frame), fallback);
      if (this._mode === "linear") {
        return {
          positionEnd: read("positionEnd", [0, 0, 0]),
          rotationEnd: read("rotationEnd", [0, 0, 0]),
          scaleEnd: read("scaleEnd", [1, 1, 1]),
        };
      }
      if (this._mode === "random") {
        return {
          positionMin: read("positionMin", [0, 0, 0]),
          positionMax: read("positionMax", [0, 0, 0]),
          rotationMin: read("rotationMin", [0, 0, 0]),
          rotationMax: read("rotationMax", [0, 0, 0]),
          scaleMin: read("scaleMin", [1, 1, 1]),
          scaleMax: read("scaleMax", [1, 1, 1]),
        };
      }
      return {
        positionStep: read("positionStep", [0, 0, 0]),
        rotationStep: read("rotationStep", [0, 0, 0]),
        scaleStep: read("scaleStep", [1, 1, 1]),
      };
    }

    unload() {
      this.clearInstances();
      this.detachTemplateObjects();
      this.objects.onListChanged.unwatch(this._onObjectsChanged);
      super.unload();
    }
  };
}


function activate(context) {
  const { PZ, window, object3d } = context;
  const THREE = window?.THREE;
  if (!PZ || !THREE || !object3d || !PZ.objectList) {
    throw new Error("Effector requires the Zoidium 3D object registry.");
  }
  if (!library) library = loadLibraryFromAssets(context.getAsset);

  const unregister = [];
  context.lifecycle?.onDispose?.(() => deactivate.call(this));
  if (library.workerSource) {
    let redrawRequest = null;
    cancelRedraw = () => {
      if (redrawRequest !== null) window.cancelAnimationFrame(redrawRequest);
      redrawRequest = null;
    };
    const jobs = library.jobs.createMeshJobs(library.workerSource, window, () => {
      const viewport = window.CM?.mainViewport;
      if (!viewport?.enabled || redrawRequest !== null) return;
      redrawRequest = window.requestAnimationFrame(() => {
        redrawRequest = null;
        if (!viewport.enabled || meshJobs !== jobs) return;
        viewport.__zoidiumPlayerPlusRenderOnce = true;
        try { viewport._render?.(); } finally { viewport.__zoidiumPlayerPlusRenderOnce = false; }
      });
    });
    meshJobs = jobs;
    meshDeformerCache = null;
  }
  try {
    deformationSupport = createDeformationSupport(PZ, THREE);
    const definitions = [
      ["step", "zoidium:repeater/repeater", "Repeater"],
      ["linear", "zoidium:repeater/linear-repeater", "Linear Repeater"],
      ["random", "zoidium:repeater/random-repeater", "Random Repeater"],
      ["echo", "zoidium:repeater/echo-repeater", "Echo Repeater"],
    ];
    for (const [mode, type, name] of definitions) {
      const RepeaterObject = createRepeaterClass(PZ, THREE, mode, type);
      unregister.push(
        object3d.registerClass({
          type,
          schemaVersion: SCHEMA_VERSION,
          name,
          factory: () => new RepeaterObject(),
        })
      );
    }
    const effectorClasses = [
      ["zoidium:repeater/plain", "Plain", createPlainClass(PZ, THREE)],
      ["zoidium:repeater/delay", "Delay", createDelayClass(PZ, THREE)],
      [TWIST_TYPE, "Twist", createTwistClass(PZ, THREE)],
      [WARP_TYPE, "Warp", createWarpClass(PZ, THREE)],
      [VORONOI_TYPE, "Voronoi Fracture", createVoronoiClass(PZ, THREE)],
    ];
    for (const [type, name, EffectorClass] of effectorClasses) {
      unregister.push(
        object3d.registerClass({
          type,
          schemaVersion: EFFECTOR_SCHEMA_VERSION,
          name,
          migrate: migrateLegacyEffectorRecord,
          factory: () => new EffectorClass(),
        })
      );
    }
  } catch (error) {
    for (const unregisterClass of unregister.reverse()) {
      try {
        unregisterClass();
      } catch (_unregisterError) {
        // Preserve the registration error while best-effort cleaning up.
      }
    }
    deformationSupport?.deactivate();
    cancelRedraw?.();
    cancelRedraw = null;
    meshJobs?.dispose();
    deformationSupport = null;
    meshJobs = null;
    meshDeformerCache = null;
    throw error;
  }
  this.__zoidiumRepeaterUnregister = unregister;
  this.__zoidiumEffectorSupport = deformationSupport;
}

function deactivate() {
  cancelRedraw?.();
  cancelRedraw = null;
  for (const unregister of this.__zoidiumRepeaterUnregister || []) {
    try {
      unregister();
    } catch (error) {
      console.error("Effector could not unregister a 3D object class", error);
    }
  }
  this.__zoidiumRepeaterUnregister = [];
  this.__zoidiumEffectorSupport?.deactivate?.();
  this.__zoidiumEffectorSupport = null;
  deformationSupport = null;
  meshJobs?.dispose();
  meshJobs = null;
  meshDeformerCache = null;
}

module.exports = {
  activate,
  deactivate,
  _test: {
    defaultSourceData,
    createPropertyCategory,
    createRepeaterClass,
    nameNewSourceShapes,
    cloneMaterial,
    cloneRenderTree,
    createDeformationSupport,
    createEffectorBaseClass,
    installFieldHelpers,
    fieldGuidePoints,
    createPlainClass,
    createDelayClass,
    createTwistClass,
    createWarpClass,
    createVoronoiClass,
    curvePolygonCount,
    fieldFromProperties,
    getCount,
    getEchoFrame,
    getEchoFrames,
    getTransform,
    makeProperties,
    migrateLegacyEffectorRecord,
    migrateEffectorData,
    seededRandom,
    getMeshDeformer,
    loadLibraryFromAssets,
    library: () => library,
  },
};
