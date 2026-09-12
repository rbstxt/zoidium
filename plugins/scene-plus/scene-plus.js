"use strict";

const MAX_REPEATS = 128;
const SCHEMA_VERSION = 2;

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
  return material && typeof material.clone === "function"
    ? material.clone()
    : material;
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
  if (!PZ || !THREE || !object3d) {
    throw new Error("Repeater requires the Zoidium 3D object registry.");
  }

  const unregister = [];
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
  this.__zoidiumRepeaterUnregister = unregister;
}

function deactivate() {
  for (const unregister of this.__zoidiumRepeaterUnregister || []) {
    try {
      unregister();
    } catch (error) {
      console.error("Repeater could not unregister a repeater object class", error);
    }
  }
  this.__zoidiumRepeaterUnregister = [];
}

module.exports = {
  activate,
  deactivate,
  _test: {
    defaultSourceData,
    createPropertyCategory,
    createRepeaterClass,
    getCount,
    getEchoFrame,
    getEchoFrames,
    getTransform,
    makeProperties,
    seededRandom,
  },
};
