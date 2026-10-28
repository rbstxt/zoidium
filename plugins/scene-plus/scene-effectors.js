"use strict";

// Effector object classes: the shared base plus Twist, Warp, Plain, Delay,
// and Voronoi Fracture. Deformers read the pure library through the shared
// plugin state, which the entry sets on activation.

const {
  DEGREES_TO_RADIANS, DEFAULT_FRACTURE_CELLS, EFFECTOR_SCHEMA_VERSION,
  FRACTURE_LIMITS, MAX_FRACTURE_CELLS, TWIST_TYPE,
  VORONOI_TYPE, WARP_TYPE, integerValue, migrateEffectorData,
  nameNewSourceShapes, vectorValue,
} = require("./scene-values.js");
const {
  fieldFromProperties, fieldProperties, numberPropertyValue,
  optionPropertyValue, propertyValue, vectorDefinition,
} = require("./scene-fields.js");
const { restoreDeformedTree } = require("./scene-clone.js");
const { liveObjectLayer } = require("./scene-deform.js");
const state = require("./scene-state.js");

function createEffectorBaseClass(PZ, THREE) {
  const GroupBase = PZ.object3d.group || PZ.object3d;
  return class EffectorObject extends GroupBase {
    constructor() {
      super();
      this.zoidiumSubdivisionMode = "current";
      this.threeObj = null;
      this._prepareGeneration = 0;
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
      this.zoidiumSubdivisionMode = normalized.zoidiumSubdivisionMode === "legacy" ? "legacy" : "current";
      if (this.zoidiumSubdivisionMode === "legacy" && this.properties.subdivision) {
        // Retain the selector's original level too. Other selector values use
        // current topology; undoing back to this level restores the exact old
        // count without an untracked mutation of the object's mode or count.
        const rawLevel = normalized.properties.subdivision;
        this.zoidiumLegacySubdivisionLevel = integerValue(normalized.zoidiumLegacySubdivisionLevel ?? rawLevel?.value ?? rawLevel, 2, 0, 4);
        this.properties.addAll({
          curveQuality: { name: "Curve quality", visible: false, type: PZ.property.type.OPTION, value: 1, items: "Low polygon;Smooth" },
          polygonCount: { name: "Polygons per triangle", visible: false, type: PZ.property.type.NUMBER, value: 16, min: 1, max: 256 },
        });
      }
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
      if (this.properties.subdivision) data.zoidiumSubdivisionMode = this.zoidiumSubdivisionMode;
      if (this.zoidiumSubdivisionMode === "legacy" && this.properties.subdivision) {
        data.zoidiumLegacySubdivisionLevel = this.zoidiumLegacySubdivisionLevel;
      }
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
      const started = this._prepareGeneration;
      const isCurrent = () => started === this._prepareGeneration && liveObjectLayer(this, PZ);
      if (!isCurrent()) return;
      for (const child of this.objects) {
        await child.loading;
        if (!isCurrent()) return;
        await child.prepare(frame);
        if (!isCurrent()) return;
      }
      await state.deformationSupport?.prepareObject?.(this, frame);
    }

    unload() {
      this._prepareGeneration += 1;
      restoreDeformedTree(this.threeObj);
      this.objects.onListChanged?.unwatch?.(this._onObjectsChanged);
      for (const child of this.objects) child.unload();
      if (this.threeObj?.parent) this.threeObj.parent.remove(this.threeObj);
      this.threeObj = null;
    }
  };
}

const warnedMessages = new Set();

function warnOnceFor(key, message) {
  if (warnedMessages.has(key)) return;
  warnedMessages.add(key);
  console.warn(message);
  return true;
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
      return state.library.core.twistPositions(
        positions,
        angle,
        optionPropertyValue(this.properties.axis, frame, 1),
        numberPropertyValue(this.properties.offset, frame, 0),
        state.library.core.fieldForBounds(fieldFromProperties(this.properties, frame, this._legacyField), context?.bounds),
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
      return state.library.core.warpPositions(
        positions,
        strength,
        optionPropertyValue(this.properties.axis, frame, 0),
        numberPropertyValue(this.properties.offset, frame, 0),
        state.library.core.fieldForBounds(fieldFromProperties(this.properties, frame, this._legacyField), context?.bounds),
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
      command.field = state.library.core.fieldForBounds(command.field, context?.bounds);
      return state.library.core.plainPositions(positions, context.stage, command);
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
  const status = require("./effector-fracture-status.js");
  const characters = require("./effector-fracture-characters.js");
  const BaseEffector = createEffectorBaseClass(PZ, THREE);
  class VoronoiObject extends BaseEffector {
    constructor() {
      super();
      state.meshJobs?.prewarm?.();
      status.installFractureStatus(this, PZ);
      this._releaseCharacterFilter = characters.acquireSelectionFilter(state.meshDeformerCache);
      this.properties.addAll({
        characters: { name: "Characters", type: PZ.property.type.TEXT, value: "" },
        invertCharacters: { name: "Invert selection", type: PZ.property.type.OPTION, value: 0, items: "off;on" },
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

    characterSelection(frame) {
      const text = String(propertyValue(this.properties.characters, frame, "") ?? "");
      if (text !== this._fractureSelectionText) {
        this._fractureSelectionText = text;
        this._fractureSelectionParsed = characters.parseCharacterSelection(text);
      }
      return this._fractureSelectionParsed;
    }

    syncCharacterSelection(frame) {
      if (!this._releaseCharacterFilter) {
        this._releaseCharacterFilter = characters.acquireSelectionFilter(state.meshDeformerCache);
      }
      const selection = this.characterSelection(frame);
      status.setFractureSelectionNote(this, selection.valid ? "" :
        "Warning: Invalid Characters range. Use one-based numbers such as 1-3, 6. No text characters are fractured.");
      characters.syncCharacterRequests(this, selection, restoreDeformedTree);
    }

    update(frame) {
      this.syncCharacterSelection(frame);
      super.update(frame);
    }

    async prepare(frame) {
      this.syncCharacterSelection(frame);
      await super.prepare(frame);
    }

    acceptsCharacterMesh(mesh, frame) {
      const selection = this.characterSelection(frame);
      if (selection.all) return true;
      const identity = mesh.userData?.zoidiumTextPlusCharacter;
      if (!identity) {
        if (mesh.children?.some(node => node.zoidiumTextPlusCharacters || node.userData?.zoidiumTextPlusCharacters)) return false;
        if (characters.textSourceForMesh(mesh)) {
          status.setFractureSelectionNote(this, "Warning: Character selection requires Text+ to be enabled. This Text stays unbroken.");
          return false;
        }
        if (selection.valid) status.setFractureSelectionNote(this, "Character selection is ignored for non-text sources.");
        return true;
      }
      return characters.matchesCharacter(selection, identity,
        optionPropertyValue(this.properties.invertCharacters, frame, 0) === 1);
    }

    setFractureJobStatus(consumer, pending, codes, cancelled) {
      status.setFractureJobStatus(this, consumer, pending, codes, cancelled);
    }

    unload() {
      characters.releaseCharacterRequests(this, restoreDeformedTree);
      this._releaseCharacterFilter?.();
      this._releaseCharacterFilter = null;
      super.unload();
      status.disposeFractureStatus(this);
    }

    workerCommand(frame) {
      return { kind: "fracture", topology: {
        cells: state.library.fracture.clampCells(numberPropertyValue(this.properties.cells, frame, DEFAULT_FRACTURE_CELLS)),
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
        const result = state.library.fracture.buildVoronoiFracture(
          { positions, index: stage.index, uvs: stage.uvs, normals: stage.attributes.normal?.array },
          topology,
          FRACTURE_LIMITS
        );
        if (result.error) {
          const message = fractureErrorText(result.error);
          this.setFractureJobStatus(stage, false, [result.error]);
          if (warnOnceFor("voronoi:" + result.error, "Voronoi Fracture skipped this mesh: " + message + ".")) {
            globalThis.ZoidiumUI?.notify({ title: "Voronoi Fracture warning", message });
          }
          return null;
        }
        if (result.warning) {
          const message = fractureErrorText(result.warning);
          warnOnceFor("voronoi:" + result.warning, "Voronoi Fracture: " + message + ".");
          this.setFractureJobStatus(stage, false, [result.warning]);
          globalThis.ZoidiumUI?.notify({ title: "Voronoi Fracture warning", message });
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
      return state.library.fracture.applyFragmentMotion(
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
  return state.library.fracture.fractureErrorText(code);
}

module.exports = {
  createEffectorBaseClass, createTwistClass, createWarpClass,
  createPlainClass, createDelayClass, createVoronoiClass, fractureErrorText
};
