"use strict";

// Repeater object classes: step, linear, random, and echo repeaters with
// their property categories, instance cloning, and per-frame transforms.

const {
  SCHEMA_VERSION, cloneJson, getCount, getEchoFrames, getTransform,
  nameNewSourceShapes, numberValue, vectorValue,
} = require("./scene-values.js");
const { createPropertyCategory, makeProperties } = require("./scene-fields.js");
const {
  cloneRenderTree, copyObjectState, disposeClonedResources,
  markGeneratedRenderTree, objectSignature, restoreDeformedTree,
} = require("./scene-clone.js");

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
      else this.refreshInstances(frame);
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

      // Group repeated/clamped times without sharing any cloned resources.
      const byFrame = new Map();
      for (let index = 0; index < echoFrames.length; index += 1) {
        const sourceFrame = echoFrames[index];
        if (!byFrame.has(sourceFrame)) byFrame.set(sourceFrame, []);
        byFrame.get(sourceFrame).push(index);
      }
      try {
        for (const [sourceFrame, indices] of byFrame) {
          for (const source of sources) source.update(sourceFrame);
          for (const index of indices) {
            const root = new THREE.Object3D();
            root.name = `${this.defaultName || "Echo Repeater"} ${index + 1}`;
            const clones = [];
            for (const source of sources) {
              const clone = cloneRenderTree(source.threeObj);
              root.add(clone);
              clones.push({ source: source.threeObj, clone });
            }
            this.threeObj.add(root);
            this._instanceRoots.push({ root, clones, sourceFrame });
          }
        }
      } finally {
        for (const source of sources) source.update(currentFrame);
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
      this.refreshInstances(frame);
    }

    refreshInstances(frame) {
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

module.exports = {
  defaultSourceData, createRepeaterClass
};
