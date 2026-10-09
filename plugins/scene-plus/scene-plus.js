"use strict";

const MAX_REPEATS = 128;
const SCHEMA_VERSION = 2;
const EFFECTOR_SCHEMA_VERSION = 1;
const TWIST_TYPE = "zoidium:repeater/twist";
const WARP_TYPE = "zoidium:repeater/warp";
const DEFORM_DATA_KEY = "__zoidiumEffectorDeform";
const DEGREES_TO_RADIANS = Math.PI / 180;
const CURVE_QUALITY_LOW = 0;
const CURVE_QUALITY_SMOOTH = 1;
const MIN_SMOOTH_POLYGON_COUNT = 1;
const DEFAULT_SMOOTH_POLYGON_COUNT = 16;
const MAX_SMOOTH_POLYGON_COUNT = 256;

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
  return { ...normalized, properties };
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
      value: [0, 0, 90],
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

function disposeDeformedCloneResources(root) {
  root?.traverse?.((node) => {
    const data = node?.userData?.[DEFORM_DATA_KEY];
    if (!data || data.geometry !== node.geometry) return;
    const baseGeometry = data.baseGeometry || data.geometry;
    if (data.geometry !== baseGeometry) data.geometry.dispose?.();
    baseGeometry.dispose?.();
    delete node.userData[DEFORM_DATA_KEY];
  });
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

function fieldWeight(x, y, z, type, position, scale) {
  if (!type) return 1;
  let weight = 1;
  if (type === 1) {
    const distance = x - position[0];
    weight = 1 - Math.max(0, distance) / (scale[0] || 1);
  } else if (type === 2) {
    const coordinates = [x, y, z];
    let distance = 0;
    for (let axis = 0; axis < 3; axis += 1) {
      const half = 0.5 * (scale[axis] || 1);
      distance = Math.max(distance, Math.abs(coordinates[axis] - position[axis]) / half);
    }
    weight = distance <= 1 ? 1 : 1 - (distance - 1);
  } else if (type === 3) {
    const dx = x - position[0];
    const dy = y - position[1];
    const dz = z - position[2];
    weight = 1 - Math.sqrt(dx * dx + dy * dy + dz * dz) / (Math.abs(scale[0]) || 1);
  }
  return Math.max(0, Math.min(1, weight));
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
      this.threeObj = new THREE.Object3D();
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
      this.properties.name.set(PZ.object3d.getName(this));
      this.parentChanged();
    }

    toJSON() {
      const data = {
        type: this.type,
        schemaVersion: EFFECTOR_SCHEMA_VERSION,
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
    }

    unload() {
      for (const child of this.objects) child.unload();
      if (this.threeObj?.parent) this.threeObj.parent.remove(this.threeObj);
      this.threeObj = null;
    }
  };
}

function rotatePositionsAroundAxis(positions, axis, angle) {
  if (!angle) return positions;
  const pairs = [
    [1, 2],
    [2, 0],
    [0, 1],
  ];
  const [first, second] = pairs[axis];
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  for (let index = 0; index + 2 < positions.length; index += 3) {
    const firstValue = positions[index + first];
    const secondValue = positions[index + second];
    positions[index + first] = firstValue * cosine - secondValue * sine;
    positions[index + second] = firstValue * sine + secondValue * cosine;
  }
  return positions;
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
        curveQuality: {
          name: "Curve quality",
          type: PZ.property.type.OPTION,
          value: CURVE_QUALITY_SMOOTH,
          items: "Low polygon;Smooth",
        },
        polygonCount: {
          name: "Polygons per triangle",
          type: PZ.property.type.NUMBER,
          value: DEFAULT_SMOOTH_POLYGON_COUNT,
          min: MIN_SMOOTH_POLYGON_COUNT,
          max: MAX_SMOOTH_POLYGON_COUNT,
          step: 1,
          decimals: 0,
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
      });
      this.type = type;
    }

    deformPositions(positions, frame, data, _mesh, context) {
      const angle = numberPropertyValue(this.properties.angle, frame, 0);
      if (!angle) return positions;

      const axis = Math.max(0, Math.min(2, optionPropertyValue(this.properties.axis, frame, 1)));
      const minimum = data.min[axis];
      const maximum = data.max[axis];
      const size = maximum - minimum;
      if (!(size > 0)) return positions;

      const offset = numberPropertyValue(this.properties.offset, frame, 0);
      const cache = data.twistCache || (data.twistCache = new Map());
      const previous = cache.get(this);
      if (
        context?.canUseOffsetRotation &&
        previous &&
        previous.angle === angle &&
        previous.axis === axis &&
        previous.size === size &&
        previous.positions.length === positions.length
      ) {
        positions.set(previous.positions);
        rotatePositionsAroundAxis(
          positions,
          axis,
          -angle * (offset - previous.offset) / size
        );
        cache.set(this, { angle, axis, offset, size, positions: new Float32Array(positions) });
        return positions;
      }

      const pivot = 0.5 * (minimum + maximum) + offset;
      const pairs = [
        [1, 2],
        [2, 0],
        [0, 1],
      ];
      const [first, second] = pairs[axis];
      for (let index = 0; index + 2 < positions.length; index += 3) {
        const theta = angle * ((positions[index + axis] - pivot) / size);
        const cosine = Math.cos(theta);
        const sine = Math.sin(theta);
        const firstValue = positions[index + first];
        const secondValue = positions[index + second];
        positions[index + first] = firstValue * cosine - secondValue * sine;
        positions[index + second] = firstValue * sine + secondValue * cosine;
      }
      if (context?.canUseOffsetRotation) {
        cache.set(this, { angle, axis, offset, size, positions: new Float32Array(positions) });
      } else {
        cache.delete(this);
      }
      return positions;
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
        curveQuality: {
          name: "Curve quality",
          type: PZ.property.type.OPTION,
          value: CURVE_QUALITY_SMOOTH,
          items: "Low polygon;Smooth",
        },
        polygonCount: {
          name: "Polygons per triangle",
          type: PZ.property.type.NUMBER,
          value: DEFAULT_SMOOTH_POLYGON_COUNT,
          min: MIN_SMOOTH_POLYGON_COUNT,
          max: MAX_SMOOTH_POLYGON_COUNT,
          step: 1,
          decimals: 0,
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
        field: {
          name: "Field",
          type: PZ.property.type.OPTION,
          value: 0,
          items: "infinite;linear;box;sphere",
        },
        fieldPosition: {
          name: "Field position",
          type: PZ.property.type.VECTOR3,
          value: [0, 0, 0],
          step: 1,
          decimals: 1,
        },
        fieldScale: {
          name: "Field scale",
          type: PZ.property.type.VECTOR3,
          value: [100, 100, 100],
          min: 0.01,
          step: 1,
          decimals: 1,
        },
      });
      this.type = type;
    }

    deformPositions(positions, frame, data) {
      const strength = numberPropertyValue(this.properties.amount, frame, 0);
      if (!strength) return positions;

      const axis = Math.max(0, Math.min(1, optionPropertyValue(this.properties.axis, frame, 0)));
      const [alongAxis, bendAxis] = axis === 0 ? [0, 1] : [0, 2];
      const minimum = data.min[alongAxis];
      const maximum = data.max[alongAxis];
      const size = maximum - minimum;
      if (!(size > 0)) return positions;

      const pivot =
        0.5 * (minimum + maximum) + numberPropertyValue(this.properties.offset, frame, 0);
      const curvature = strength / size;
      const fieldType = optionPropertyValue(this.properties.field, frame, 0);
      const fieldPosition = vectorValue(
        propertyValue(this.properties.fieldPosition, frame, [0, 0, 0]),
        [0, 0, 0]
      );
      const fieldScale = vectorValue(
        propertyValue(this.properties.fieldScale, frame, [100, 100, 100]),
        [100, 100, 100]
      );

      for (let index = 0; index + 2 < positions.length; index += 3) {
        let weight = 1;
        if (fieldType) {
          weight = fieldWeight(
            positions[index],
            positions[index + 1],
            positions[index + 2],
            fieldType,
            fieldPosition,
            fieldScale
          );
          if (weight <= 0) continue;
        }

        const effectiveCurvature = curvature * weight;
        if (!effectiveCurvature) continue;
        const radius = 1 / effectiveCurvature;
        const along = positions[index + alongAxis] - pivot;
        const theta = along * effectiveCurvature;
        positions[index + alongAxis] = pivot + radius * Math.sin(theta);
        positions[index + bendAxis] += radius * (1 - Math.cos(theta));
      }
      return positions;
    }
  }

  WarpObject.prototype.defaultName = "Warp";
  return WarpObject;
}

function ensureMeshUserData(mesh) {
  if (!mesh.userData || typeof mesh.userData !== "object") mesh.userData = {};
  return mesh.userData;
}

const polygonTemplateCache = new Map();

function midpoint(first, second) {
  return [
    0.5 * (first[0] + second[0]),
    0.5 * (first[1] + second[1]),
    0.5 * (first[2] + second[2]),
  ];
}

function splitTriangleFour([first, second, third]) {
  const firstSecond = midpoint(first, second);
  const secondThird = midpoint(second, third);
  const thirdFirst = midpoint(third, first);
  return [
    [first, firstSecond, thirdFirst],
    [firstSecond, second, secondThird],
    [thirdFirst, secondThird, third],
    [firstSecond, secondThird, thirdFirst],
  ];
}

function barycentricDistanceSquared(first, second) {
  const x = first[0] - second[0];
  const y = first[1] - second[1];
  const z = first[2] - second[2];
  return x * x + y * y + z * z;
}

function splitTriangleTwo([first, second, third]) {
  const firstSecondLength = barycentricDistanceSquared(first, second);
  const secondThirdLength = barycentricDistanceSquared(second, third);
  const thirdFirstLength = barycentricDistanceSquared(third, first);
  if (firstSecondLength >= secondThirdLength && firstSecondLength >= thirdFirstLength) {
    const edge = midpoint(first, second);
    return [
      [first, edge, third],
      [edge, second, third],
    ];
  }
  if (secondThirdLength >= thirdFirstLength) {
    const edge = midpoint(second, third);
    return [
      [second, edge, first],
      [edge, third, first],
    ];
  }
  const edge = midpoint(third, first);
  return [
    [third, edge, second],
    [edge, first, second],
  ];
}

function getSubdivisionTriangles(polygonCount) {
  const target = integerValue(
    polygonCount,
    DEFAULT_SMOOTH_POLYGON_COUNT,
    MIN_SMOOTH_POLYGON_COUNT,
    MAX_SMOOTH_POLYGON_COUNT
  );
  if (polygonTemplateCache.has(target)) return polygonTemplateCache.get(target);

  let triangles = [{ vertices: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], depth: 0 }];
  while (triangles.length * 4 <= target) {
    const next = [];
    for (const triangle of triangles) {
      for (const vertices of splitTriangleFour(triangle.vertices)) {
        next.push({ vertices, depth: triangle.depth + 1 });
      }
    }
    triangles = next;
  }
  while (triangles.length < target) {
    let splitIndex = 0;
    for (let index = 1; index < triangles.length; index += 1) {
      if (triangles[index].depth < triangles[splitIndex].depth) splitIndex = index;
    }
    const triangle = triangles[splitIndex];
    const nextDepth = triangle.depth + 1;
    triangles.splice(
      splitIndex,
      1,
      ...splitTriangleTwo(triangle.vertices).map((vertices) => ({
        vertices,
        depth: nextDepth,
      }))
    );
  }

  const result = triangles.map((triangle) => triangle.vertices);
  polygonTemplateCache.set(target, result);
  return result;
}

function materialIndexAtOffset(geometry, offset) {
  for (const group of geometry.groups || []) {
    if (offset >= group.start && offset < group.start + group.count) {
      return Number.isFinite(group.materialIndex) ? group.materialIndex : 0;
    }
  }
  return 0;
}

function attributeComponent(attribute, vertex, component) {
  const index = vertex * attribute.itemSize + component;
  return Number(attribute.array[index]) || 0;
}

function subdivideGeometry(THREE, geometry, polygonCount) {
  // Nonlinear deformation can only bend the vertices it receives. Refine the
  // triangles first so Smooth mode does not turn large text faces into visible
  // low-poly wedges. The requested count is per source triangle.
  if (
    polygonCount <= MIN_SMOOTH_POLYGON_COUNT ||
    !geometry ||
    geometry.__zoidiumEffectorSubdivided ||
    !geometry.attributes?.position ||
    typeof THREE?.BufferGeometry !== "function" ||
    typeof THREE?.BufferAttribute !== "function"
  ) {
    return geometry;
  }

  const attributes = Object.entries(geometry.attributes).filter(
    ([, attribute]) => attribute?.array && Number.isInteger(attribute.itemSize)
  );
  const position = geometry.attributes.position;
  if (!attributes.length || position.itemSize < 3) return geometry;

  const indexArray = geometry.index?.array || geometry.index || null;
  const vertexCount = indexArray
    ? indexArray.length
    : position.count ?? position.array.length / position.itemSize;
  const triangleCount = Math.floor(vertexCount / 3);
  if (!triangleCount) return geometry;

  const triangles = getSubdivisionTriangles(polygonCount);
  const output = new Map(attributes.map(([name]) => [name, []]));
  const outputGroups = [];
  let outputVertexCount = 0;

  const appendGroup = (start, materialIndex, count) => {
    const previous = outputGroups[outputGroups.length - 1];
    if (
      previous &&
      previous.materialIndex === materialIndex &&
      previous.start + previous.count === start
    ) {
      previous.count += count;
    } else {
      outputGroups.push({ start, count, materialIndex });
    }
  };

  for (let triangleIndex = 0; triangleIndex < triangleCount; triangleIndex += 1) {
    const offset = triangleIndex * 3;
    const sourceVertices = [
      indexArray ? Number(indexArray[offset]) : offset,
      indexArray ? Number(indexArray[offset + 1]) : offset + 1,
      indexArray ? Number(indexArray[offset + 2]) : offset + 2,
    ];
    const materialIndex = materialIndexAtOffset(geometry, offset);
    const groupStart = outputVertexCount;
    for (const smallTriangle of triangles) {
      for (const weights of smallTriangle) {
        for (const [name, attribute] of attributes) {
          const values = output.get(name);
          for (let component = 0; component < attribute.itemSize; component += 1) {
            values.push(
              weights[0] * attributeComponent(attribute, sourceVertices[0], component) +
              weights[1] * attributeComponent(attribute, sourceVertices[1], component) +
              weights[2] * attributeComponent(attribute, sourceVertices[2], component)
            );
          }
        }
        outputVertexCount += 1;
      }
    }
    appendGroup(groupStart, materialIndex, triangles.length * 3);
  }

  const result = new THREE.BufferGeometry();
  for (const [name, attribute] of attributes) {
    const values = output.get(name);
    const resultAttribute = new THREE.BufferAttribute(
      new Float32Array(values),
      attribute.itemSize,
      attribute.normalized
    );
    if (typeof result.addAttribute === "function") result.addAttribute(name, resultAttribute);
    else result.setAttribute?.(name, resultAttribute);
  }
  if (geometry.groups?.length && typeof result.addGroup === "function") {
    result.clearGroups?.();
    for (const group of outputGroups) {
      result.addGroup(group.start, group.count, group.materialIndex);
    }
  }
  result.name = geometry.name;
  result.computeBoundingBox?.();
  result.computeBoundingSphere?.();
  if (!result.attributes.normal) result.computeVertexNormals?.();
  result.__zoidiumEffectorSubdivided = true;
  return result;
}

function curvePolygonCount(chain, frame) {
  let polygonCount = CURVE_QUALITY_LOW;
  for (const effector of chain) {
    if (!effector.properties?.curveQuality) continue;
    const intensityProperty = effector.properties.angle || effector.properties.amount;
    if (intensityProperty && !numberPropertyValue(intensityProperty, frame, 0)) continue;
    const quality = optionPropertyValue(effector.properties.curveQuality, frame, CURVE_QUALITY_SMOOTH);
    if (quality === CURVE_QUALITY_SMOOTH) {
      polygonCount = Math.max(
        polygonCount,
        integerValue(
          numberPropertyValue(
            effector.properties.polygonCount,
            frame,
            DEFAULT_SMOOTH_POLYGON_COUNT
          ),
          DEFAULT_SMOOTH_POLYGON_COUNT,
          MIN_SMOOTH_POLYGON_COUNT,
          MAX_SMOOTH_POLYGON_COUNT
        )
      );
    }
  }
  return polygonCount;
}

function releaseDeformedMesh(mesh) {
  const data = mesh?.userData?.[DEFORM_DATA_KEY];
  if (!data) return;
  restoreDeformedMesh(mesh);
  if (
    data.baseGeometry &&
    data.geometry !== data.baseGeometry &&
    mesh.geometry === data.geometry
  ) {
    const workingGeometry = data.geometry;
    mesh.geometry = data.baseGeometry;
    workingGeometry.dispose?.();
    data.geometry = data.baseGeometry;
    data.positions = new Float32Array(data.baseGeometry.attributes.position.array);
    data.normals = data.baseGeometry.attributes.normal?.array
      ? new Float32Array(data.baseGeometry.attributes.normal.array)
      : null;
    data.minimum = data.min;
    data.maximum = data.max;
    data.polygonCount = CURVE_QUALITY_LOW;
  }
}

function getDeformMeshData(THREE, mesh, polygonCount = CURVE_QUALITY_LOW) {
  const userData = ensureMeshUserData(mesh);
  let data = userData[DEFORM_DATA_KEY];
  if (data && data.geometry !== mesh.geometry) {
    data = null;
    delete userData[DEFORM_DATA_KEY];
  }
  let geometry = mesh.geometry;
  if (!geometry) return null;
  if (data && data.polygonCount === polygonCount) return data;
  if (data) {
    releaseDeformedMesh(mesh);
    data = null;
    delete userData[DEFORM_DATA_KEY];
    geometry = mesh.geometry;
  }
  if (mesh.__zoidiumEffectorGeneratedClone && typeof geometry.clone === "function") {
    geometry = geometry.clone();
    mesh.geometry = geometry;
  }
  if (geometry.isGeometry && THREE.BufferGeometry && typeof THREE.BufferGeometry === "function") {
    const converted = new THREE.BufferGeometry().fromGeometry(geometry);
    geometry.dispose?.();
    mesh.geometry = converted;
    geometry = converted;
  }
  const baseGeometry = geometry;
  const subdividedGeometry = subdivideGeometry(THREE, geometry, polygonCount);
  if (subdividedGeometry !== geometry) {
    mesh.geometry = subdividedGeometry;
    geometry = subdividedGeometry;
  }
  const position = geometry.attributes?.position;
  if (!position?.array) return null;

  const positions = new Float32Array(position.array);
  const minimum = [Infinity, Infinity, Infinity];
  const maximum = [-Infinity, -Infinity, -Infinity];
  for (let index = 0; index + 2 < positions.length; index += 3) {
    for (let axis = 0; axis < 3; axis += 1) {
      minimum[axis] = Math.min(minimum[axis], positions[index + axis]);
      maximum[axis] = Math.max(maximum[axis], positions[index + axis]);
    }
  }
  data = {
    geometry,
    positions,
    normals: geometry.attributes?.normal?.array
      ? new Float32Array(geometry.attributes.normal.array)
      : null,
    minimum,
    maximum,
    frustumCulled: mesh.frustumCulled,
    baseGeometry,
    polygonCount,
  };
  // Keep the short property names used by the imported deformer algorithms.
  data.min = minimum;
  data.max = maximum;
  userData[DEFORM_DATA_KEY] = data;
  return data;
}

function restoreDeformedMesh(mesh) {
  const data = mesh?.userData?.[DEFORM_DATA_KEY];
  if (!data || data.geometry !== mesh.geometry) return;
  const position = data.geometry.attributes?.position;
  if (position?.array && position.array.length === data.positions.length) {
    position.array.set(data.positions);
    position.needsUpdate = true;
  }
  const normal = data.geometry.attributes?.normal;
  if (normal?.array && data.normals && normal.array.length === data.normals.length) {
    normal.array.set(data.normals);
    normal.needsUpdate = true;
  }
  data.geometry.computeBoundingSphere?.();
}

function materialGroupForVertex(geometry, vertex) {
  for (const group of geometry.groups || []) {
    if (vertex >= group.start && vertex < group.start + group.count) {
      return Number.isFinite(group.materialIndex) ? group.materialIndex : 0;
    }
  }
  return 0;
}

function computeSmoothVertexNormals(geometry) {
  const position = geometry?.attributes?.position;
  const normal = geometry?.attributes?.normal;
  if (!position?.array || !normal?.array || position.itemSize < 3 || normal.itemSize < 3) return;

  const sums = new Map();
  const coordinates = (vertex) => [
    position.array[vertex * position.itemSize],
    position.array[vertex * position.itemSize + 1],
    position.array[vertex * position.itemSize + 2],
  ];
  const keyFor = (vertex) => {
    const point = coordinates(vertex);
    const group = materialGroupForVertex(geometry, vertex);
    return `${group}:${Math.round(point[0] * 100000)}:${Math.round(point[1] * 100000)}:${Math.round(point[2] * 100000)}`;
  };

  for (let vertex = 0; vertex + 2 < position.count; vertex += 3) {
    const first = coordinates(vertex);
    const second = coordinates(vertex + 1);
    const third = coordinates(vertex + 2);
    const ab = [second[0] - first[0], second[1] - first[1], second[2] - first[2]];
    const ac = [third[0] - first[0], third[1] - first[1], third[2] - first[2]];
    const faceNormal = [
      ab[1] * ac[2] - ab[2] * ac[1],
      ab[2] * ac[0] - ab[0] * ac[2],
      ab[0] * ac[1] - ab[1] * ac[0],
    ];
    for (let offset = 0; offset < 3; offset += 1) {
      const key = keyFor(vertex + offset);
      const sum = sums.get(key) || [0, 0, 0];
      sum[0] += faceNormal[0];
      sum[1] += faceNormal[1];
      sum[2] += faceNormal[2];
      sums.set(key, sum);
    }
  }

  for (let vertex = 0; vertex < position.count; vertex += 1) {
    const sum = sums.get(keyFor(vertex)) || [0, 0, 1];
    const length = Math.hypot(sum[0], sum[1], sum[2]) || 1;
    normal.array[vertex * normal.itemSize] = sum[0] / length;
    normal.array[vertex * normal.itemSize + 1] = sum[1] / length;
    normal.array[vertex * normal.itemSize + 2] = sum[2] / length;
  }
  normal.needsUpdate = true;
}

function setDeformedMeshPositions(mesh, positions) {
  const data = mesh?.userData?.[DEFORM_DATA_KEY];
  if (!data || data.geometry !== mesh.geometry) return;
  const attribute = data.geometry.attributes?.position;
  if (!attribute?.array || attribute.array.length !== positions.length) return;
  let changed = false;
  for (let index = 0; index < positions.length; index += 1) {
    if (attribute.array[index] !== positions[index]) {
      changed = true;
      break;
    }
  }
  if (!changed) return;
  attribute.array.set(positions);
  attribute.needsUpdate = true;
  if (data.polygonCount > MIN_SMOOTH_POLYGON_COUNT) {
    if (!data.geometry.attributes.normal) data.geometry.computeVertexNormals?.();
    computeSmoothVertexNormals(data.geometry);
  } else {
    data.geometry.computeVertexNormals?.();
  }
  data.geometry.computeBoundingSphere?.();
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
    };
  }

  const layers = new Set();
  const originalUpdate = prototype.update;

  function deformMesh(mesh, chain, frame) {
    if (!chain.length) {
      restoreDeformedMesh(mesh);
      return;
    }
    const polygonCount = curvePolygonCount(chain, frame);
    const data = getDeformMeshData(THREE, mesh, polygonCount);
    if (!data) return;
    let positions = new Float32Array(data.positions);
    for (let index = 0; index < chain.length; index += 1) {
      const effector = chain[index];
      if (typeof effector.deformPositions !== "function") continue;
      positions = effector.deformPositions(positions, frame, data, mesh, {
        index,
        canUseOffsetRotation: index === 0,
      }) || positions;
    }
    setDeformedMeshPositions(mesh, positions);
  }

  function walkRenderedObject(object, chain, frame, renderRoot) {
    if (!object) return;
    const isDeformer = typeof object.deformPositions === "function";
    const enabled = !object.properties?.enabled ||
      optionPropertyValue(object.properties.enabled, frame, 1) === 1;
    const nextChain = isDeformer && enabled ? chain.concat(object) : chain;

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
            traverseDeformMeshes(clone.clone, (mesh) => deformMesh(mesh, nextChain, frame));
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
    traverseDeformMeshes(renderRoot || object.threeObj, (mesh) => deformMesh(mesh, nextChain, frame));
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
      for (const instance of object._instanceRoots || []) {
        traverseDeformMeshes(instance.root, restoreDeformedMesh);
      }
    }
    traverseDeformMeshes(object.threeObj, restoreDeformedMesh);
    if (object.objects && typeof object.objects.length === "number") {
      for (const child of object.objects) restoreRenderedObject(child, seen);
    }
  }

  function apply(layer, frame) {
    if (!layer?.objects) return;
    layers.add(layer);
    walk(layer.objects, [], Number.isFinite(frame) ? frame : 0);
  }

  function restore(layer) {
    if (!layer?.objects) return;
    const seen = new Set();
    for (const object of layer.objects) restoreRenderedObject(object, seen);
  }

  const support = { apply, restore };
  const patchedUpdate = function updateWithEffectors(frame) {
    originalUpdate.call(this, frame);
    apply(this, frame);
  };
  patchedUpdate.__zoidiumEffectorDeformPatch = true;
  prototype.update = patchedUpdate;
  prototype.__zoidiumEffectorDeformPatch = true;
  prototype.__zoidiumEffectorDeformSupport = support;

  const previousDeform = PZ.object3d.deform;
  const deformApi = previousDeform && typeof previousDeform === "object"
    ? previousDeform
    : {};
  const previousApply = deformApi.apply;
  const previousRestore = deformApi.restore;
  deformApi.apply = apply;
  deformApi.restore = restore;
  deformApi.__zoidiumEffectorSupport = true;
  PZ.object3d.deform = deformApi;

  return {
    apply,
    deactivate() {
      for (const layer of layers) restore(layer);
      layers.clear();
      if (prototype.update === patchedUpdate) prototype.update = originalUpdate;
      delete prototype.__zoidiumEffectorDeformPatch;
      delete prototype.__zoidiumEffectorDeformSupport;
      if (previousDeform) {
        if (previousApply === undefined) delete previousDeform.apply;
        else previousDeform.apply = previousApply;
        if (previousRestore === undefined) delete previousDeform.restore;
        else previousDeform.restore = previousRestore;
        delete previousDeform.__zoidiumEffectorSupport;
      } else if (PZ.object3d.deform === deformApi) {
        delete PZ.object3d.deform;
      }
    },
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
        Promise.resolve().then(() => this.detachTemplateObjects());
      };
      this.objects.onListChanged.watch(this._onObjectsChanged);
      this.type = type;
    }

    markRepeaterDirty() {
      this._cloneDirty = true;
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
          else disposeDeformedCloneResources(instance.root);
          this.threeObj.remove(instance.root);
        }
      }
      this._instanceRoots = [];
    }

    rebuildEchoInstances(frame) {
      if (!this.threeObj) return;
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

  const unregister = [];
  const deformationSupport = createDeformationSupport(PZ, THREE);
  try {
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
    const TwistObject = createTwistClass(PZ, THREE);
    const WarpObject = createWarpClass(PZ, THREE);
    unregister.push(
      object3d.registerClass({
        type: TWIST_TYPE,
        schemaVersion: EFFECTOR_SCHEMA_VERSION,
        name: "Twist",
        factory: () => new TwistObject(),
      })
    );
    unregister.push(
      object3d.registerClass({
        type: WARP_TYPE,
        schemaVersion: EFFECTOR_SCHEMA_VERSION,
        name: "Warp",
        factory: () => new WarpObject(),
      })
    );
  } catch (error) {
    for (const unregisterClass of unregister.reverse()) {
      try {
        unregisterClass();
      } catch (_unregisterError) {
        // Preserve the registration error while best-effort cleaning up.
      }
    }
    deformationSupport.deactivate();
    throw error;
  }
  this.__zoidiumRepeaterUnregister = unregister;
  this.__zoidiumEffectorSupport = deformationSupport;
}

function deactivate() {
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
}

module.exports = {
  activate,
  deactivate,
  _test: {
    defaultSourceData,
    createPropertyCategory,
    createRepeaterClass,
    cloneMaterial,
    cloneRenderTree,
    createDeformationSupport,
    createEffectorBaseClass,
    getCount,
    createTwistClass,
    createWarpClass,
    fieldWeight,
    getDeformMeshData,
    restoreDeformedMesh,
    setDeformedMeshPositions,
    getEchoFrame,
    getEchoFrames,
    getTransform,
    makeProperties,
    seededRandom,
  },
};
