"use strict";

// ExpressText+ container class, text patches and activation.
const { clearDelayCache } = require("./expresstext-delay-cache.js");
const { DELAY_MODE_LABELS, DELAY_ORDER_LABELS, EXPRESS_TEXT_NAME, EXPRESS_TEXT_TYPE, FIELD_LABELS, RANDOM_MODE_LABELS, RANDOM_SPACE_LABELS, REPEATER_MAX_COPIES, REPEATER_MODE_LABELS, SCHEMA_VERSION, SPLINE_MODE_LABELS, SPLINE_PATH_LABELS, SPLINE_PLANE_LABELS, SPLINE_TRANSFORM_LABELS, TWIST_AXIS_LABELS, WRAP_DIRECTION_LABELS, state } = require("./expresstext-constants.js");
const { fieldWeight, isLetterSelected, numberValue, parseLetterSelection, resolveSelection, selectedList, splitSelectionTokens, strengthWeight, vector3 } = require("./expresstext-select.js");
const { compileFormula, parseFormula, tokenizeFormula } = require("./expresstext-formula.js");
const { delayRank, fractalNoise3, hashLattice, hashSeed, seededRandom, shakeValue, shuffledStrata, valueNoise3 } = require("./expresstext-random.js");
const { blankControls, letterContext, readProp, readVector, staticProps } = require("./expresstext-eval.js");
const { eulerFromBasis, evaluateFormula, evaluateOrbit, evaluatePlain, evaluateRandom, evaluateShake, evaluateSpline, evaluateTwist, evaluateWrap, localBaseOf, randomUnit, rotateAxisX, rotateAxisY, rotateAxisZ, rotateEulerXYZ, sampleSplinePath, worldBaseOf } = require("./expresstext-effectors.js");
const { haltonSequence, splitVoronoiCells, voronoiChunkPose } = require("./expresstext-voronoi.js");
const { DELAY_BLEND_CATCH, DELAY_EVEN_SPAN, DELAY_SIM_WINDOW, DELAY_SPRING_DAMP, DELAY_SPRING_DAMP_MIN, DELAY_SPRING_STIFF, blankDelayVelocity, blendDelayOutput, chaseToward, delayLinkParams, evaluateStack, plainListsAt, runDelayLetterStage, simulateDelayLetter } = require("./expresstext-delay.js");
const { EFFECTOR_PIVOT_KEYS, customSections, customsChildren, groupReader, kindOfGroup, kindOfKey, rawArray, reattachCustomDefinitions, sectionGroupOf, stackLayersFor } = require("./expresstext-sections.js");
const { EFFECTOR_KINDS, EFFECTOR_NAMES, EFFECTOR_ORDER, EFFECTOR_TYPES, createContainerPropertyDefinitions, createDelayPropertyDefinitions, createFormulaPropertyDefinitions, createOrbitPropertyDefinitions, createPlainPropertyDefinitions, createRandomPropertyDefinitions, createRepeaterPropertyDefinitions, createShakePropertyDefinitions, createSplinePropertyDefinitions, createTwistPropertyDefinitions, createVoronoiPropertyDefinitions, createWrapPropertyDefinitions, customPropertyClass, effectorEntryDefs, newEffectorInstance, registerEffectorEntries, unregisterEffectorEntries, withPrefix } = require("./expresstext-properties.js");
const { collectExpressObjects, expressContainerOf, expressStackOf, getAncestorObject, getExpressCenterOffset, getExpressLayout, getExpressTextCenter, repeaterCopyOffset, repeaterCopyOpacity, repeaterSpecsFor } = require("./expresstext-layout.js");
const { applyLetterTransform, buildExpressRendering, containerLetterRun, containerTexts, disposeExpressRendering, eulerParts, geometryTriangleArrays, getSplitState, layoutLetterCount, ownTransformOf, restoreExpressRendering, sourceExtrudeOptions, syncExpressRendering, textWorldOf, throughParent, updateExpressRendering } = require("./expresstext-render.js");

/* ------------------------------------------------- container + patching */

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

function defaultExpressData(data, fallbackName) {
  const input = data && typeof data === "object" ? data : {};
  return {
    properties: { ...(input.properties || {}), name: input.properties?.name ?? fallbackName ?? EXPRESS_TEXT_NAME },
    characterProperties: input.characterProperties || {},
    customProperties: input.customProperties || [],
    objects: input.objects || [],
    expressProperties: input.expressProperties || {},
  };
}

const EXPRESS_SHAKE_TYPE = "zoidium:expresstext-plus/shake";
const EXPRESS_PLAIN_TYPE = "zoidium:expresstext-plus/plain";
const EXPRESS_RANDOM_TYPE = "zoidium:expresstext-plus/random";
const EXPRESS_FORMULA_TYPE = "zoidium:expresstext-plus/formula";
const EXPRESS_SPLINE_TYPE = "zoidium:expresstext-plus/spline";
const EXPRESS_ORBIT_TYPE = "zoidium:expresstext-plus/orbit";
const EXPRESS_REPEATER_TYPE = "zoidium:expresstext-plus/repeater";
const EXPRESS_TWIST_TYPE = "zoidium:expresstext-plus/twist";
const EXPRESS_WRAP_TYPE = "zoidium:expresstext-plus/wrap";
const EXPRESS_VORONOI_TYPE = "zoidium:expresstext-plus/voronoi";
const EXPRESS_DELAY_TYPE = "zoidium:expresstext-plus/delay";

function getExpressDefinitions() {
  return [
    {
      type: EXPRESS_TEXT_TYPE,
      schemaVersion: SCHEMA_VERSION,
      name: EXPRESS_TEXT_NAME,
      kind: null,
      objectsName: "Text",
      createProperties: (PZ) => createContainerPropertyDefinitions(PZ),
    },
    {
      type: EXPRESS_SHAKE_TYPE,
      schemaVersion: SCHEMA_VERSION,
      name: "Shake",
      kind: "shake",
      objectsName: "Modifiers",
      createProperties: (PZ) => createShakePropertyDefinitions(PZ),
    },
    {
      type: EXPRESS_PLAIN_TYPE,
      schemaVersion: SCHEMA_VERSION,
      name: "Plain",
      kind: "plain",
      objectsName: "Modifiers",
      createProperties: (PZ) => createPlainPropertyDefinitions(PZ),
    },
    {
      type: EXPRESS_RANDOM_TYPE,
      schemaVersion: SCHEMA_VERSION,
      name: "Random",
      kind: "random",
      objectsName: "Modifiers",
      createProperties: (PZ) => createRandomPropertyDefinitions(PZ),
    },
    {
      type: EXPRESS_FORMULA_TYPE,
      schemaVersion: SCHEMA_VERSION,
      name: "Formula",
      kind: "formula",
      objectsName: "Modifiers",
      createProperties: (PZ) => createFormulaPropertyDefinitions(PZ),
    },
    {
      type: EXPRESS_DELAY_TYPE,
      schemaVersion: SCHEMA_VERSION,
      name: "Delay",
      kind: "delay",
      objectsName: "Modifiers",
      createProperties: (PZ) => createDelayPropertyDefinitions(PZ),
    },
    {
      type: EXPRESS_SPLINE_TYPE,
      schemaVersion: SCHEMA_VERSION,
      name: "Spline",
      kind: "spline",
      objectsName: "Modifiers",
      createProperties: (PZ) => createSplinePropertyDefinitions(PZ),
    },
    {
      type: EXPRESS_ORBIT_TYPE,
      schemaVersion: SCHEMA_VERSION,
      name: "Orbit",
      kind: "orbit",
      objectsName: "Modifiers",
      createProperties: (PZ) => createOrbitPropertyDefinitions(PZ),
    },
    {
      type: EXPRESS_REPEATER_TYPE,
      schemaVersion: SCHEMA_VERSION,
      name: "Repeater",
      kind: "repeater",
      objectsName: "Modifiers",
      createProperties: (PZ) => createRepeaterPropertyDefinitions(PZ),
    },
    {
      type: EXPRESS_TWIST_TYPE,
      schemaVersion: SCHEMA_VERSION,
      name: "Twist",
      kind: "twist",
      objectsName: "Modifiers",
      createProperties: (PZ) => createTwistPropertyDefinitions(PZ),
    },
    {
      type: EXPRESS_WRAP_TYPE,
      schemaVersion: SCHEMA_VERSION,
      name: "Wrap",
      kind: "wrap",
      objectsName: "Modifiers",
      createProperties: (PZ) => createWrapPropertyDefinitions(PZ),
    },
    {
      type: EXPRESS_VORONOI_TYPE,
      schemaVersion: SCHEMA_VERSION,
      name: "Voronoi",
      kind: "voronoi",
      objectsName: "Modifiers",
      createProperties: (PZ) => createVoronoiPropertyDefinitions(PZ),
    },
  ];
}

function createExpressObjectClass(PZ, definition) {
  const propertyDefinitions = definition.createProperties(PZ);

  class ExpressObject extends PZ.object3d.group {
    constructor() {
      super();
      this.objects.name = definition.objectsName;
      // The customs list carries our scoped item class, so the stock +
      // dialog on ExpressText+ containers offers only effectors. The row
      // keeps its stock "Custom properties" label.
      try {
        const itemClass =
          (definition.kind ? null : customPropertyClass(PZ)) ||
          (PZ.property && PZ.property.dynamic);
        if (itemClass && PZ.objectList && this.customProperties) {
          const scoped = new PZ.objectList(this, itemClass);
          scoped.name = "Custom properties";
          const at = this.children.indexOf(this.customProperties);
          try {
            if (at >= 0) this.children.splice(at, 1, scoped);
            else this.children.push(scoped);
          } catch (_splice) {
            this.children.push(scoped);
          }
          this.customProperties = scoped;
        }
      } catch (_scope) {}
      this.expressProperties = createPropertyCategory(
        PZ,
        this,
        "ExpressText",
        propertyDefinitions
      );
      this.type = definition.type;
      // The base group constructor installs its own bound load (with
      // migration handling) which shadows prototype overrides, so hook the
      // post-load work here: orphan effector revive, customs reattach and
      // the ExpressText values load. Untouched data passes through exactly
      // as received.
      try {
        const stockLoad = this.load;
        const self = this;
        this.load = function (data) {
          let loadData = data;
          let stashed = null;
          try {
            const children = rawArray(data && data.objects);
            const rest = [];
            stashed = [];
            for (const child of children) {
              const type = child && child.type;
              if (typeof type === "string" && EFFECTOR_KINDS[type] && newEffectorInstance(type)) {
                stashed.push(child);
              } else {
                rest.push(child);
              }
            }
            if (stashed.length && data && typeof data === "object") {
              loadData = { ...data, objects: rest };
            }
          } catch (_split) {
            stashed = null;
          }
          let out = null;
          try {
            out = typeof stockLoad === "function"
              ? stockLoad.call(self, loadData)
              : PZ.object3d.group.prototype.load.call(self, loadData);
          } catch (_load) {}
          try {
            for (const childData of stashed || []) {
              const instance = newEffectorInstance(childData && childData.type);
              if (instance) {
                const loaded = instance.load(childData);
                if (loaded && typeof loaded.then === "function" && "loading" in instance) {
                  instance.loading = loaded;
                }
                self.objects.push(instance);
              }
            }
          } catch (_revive) {}
          try {
            reattachCustomDefinitions(
              self.customProperties,
              data && data.customProperties
            );
          } catch (_reattach) {}
          try {
            if (self.expressProperties && data && data.expressProperties) {
              self.expressProperties.load(data.expressProperties);
            }
          } catch (_props) {}
          return out;
        };
      } catch (_hook) {}
    }

    toJSON() {
      const data = super.toJSON();
      data.type = definition.type;
      data.schemaVersion = definition.schemaVersion;
      data.expressProperties = this.expressProperties;
      return data;
    }
  }

  ExpressObject.prototype.defaultName = definition.name;
  if (definition.kind) {
    ExpressObject.prototype.zoidiumExpressEffector = definition.kind;
  } else {
    ExpressObject.prototype.zoidiumExpressTextObject = true;
  }
  return ExpressObject;
}

function installTextPatches(PZ) {
  try {
    const text = PZ.object3d && PZ.object3d.text;
    if (!text || !text.prototype || typeof text.prototype.update !== "function") return false;
    if (text.prototype.update.__expressTextPlus) {
      text.prototype.update.__expressTextPlusAlive = true;
      return true;
    }
    const originalUpdate = text.prototype.update;
    const patchedUpdate = function (frame) {
      const out = originalUpdate.call(this, frame);
      try {
        if (!patchedUpdate.__expressTextPlusAlive) return out;
        syncExpressRendering(this, frame);
      } catch (_error) {}
      return out;
    };
    patchedUpdate.__expressTextPlus = true;
    patchedUpdate.__expressTextPlusAlive = true;
    patchedUpdate.__expressTextPlusOriginal = originalUpdate;
    text.prototype.update = patchedUpdate;
    state.textPatched = true;
    state.originalTextUpdate = originalUpdate;

    if (typeof text.prototype.updateGeometry === "function" && !text.prototype.updateGeometry.__expressTextPlus) {
      const originalGeometry = text.prototype.updateGeometry;
      const patchedGeometry = function (...args) {
        const out = originalGeometry.call(this, ...args);
        try {
          // Fresh native geometry just landed (a size/bevel/font row
          // changed): drop our letters so the next sync rebuilds from it.
          // Never swap the stale snapshot back in here — that froze the
          // text at its first-built state.
          const splitState = state.splitStates.get(this);
          if (splitState) disposeExpressRendering(splitState);
        } catch (_error) {}
        return out;
      };
      patchedGeometry.__expressTextPlus = true;
      patchedGeometry.__expressTextPlusOriginal = originalGeometry;
      text.prototype.updateGeometry = patchedGeometry;
      state.originalTextUpdateGeometry = originalGeometry;
    }

    const originalUnload = text.prototype.unload;
    if (typeof originalUnload === "function" && !originalUnload.__expressTextPlus) {
      const patchedUnload = function (...args) {
        try {
          restoreExpressRendering(this);
        } catch (_error) {}
        return originalUnload.call(this, ...args);
      };
      patchedUnload.__expressTextPlus = true;
      text.prototype.unload = patchedUnload;
    }
    return true;
  } catch (_error) {
    return false;
  }
}

function restoreTextPatches() {
  try {
    const text = state.PZ?.object3d?.text;
    if (text?.prototype?.update?.__expressTextPlus) {
      if (text.prototype.update.__expressTextPlusOriginal) {
        text.prototype.update = text.prototype.update.__expressTextPlusOriginal;
      }
    }
    if (text?.prototype?.updateGeometry?.__expressTextPlusOriginal) {
      text.prototype.updateGeometry = text.prototype.updateGeometry.__expressTextPlusOriginal;
    }
  } catch (_error) {}
  state.textPatched = false;
  state.originalTextUpdate = null;
  state.originalTextUpdateGeometry = null;
}

/* ------------------------------------------------------------- activation */

function activate(context) {
  if (state.PZ) return;
  const { PZ, window, object3d } = context || {};
  const THREE = window?.THREE;
  if (
    !PZ?.object3d?.group ||
    !PZ.object3d.text ||
    !PZ.property ||
    !THREE?.TextGeometry ||
    !object3d ||
    typeof object3d.registerClass !== "function"
  ) {
    throw new Error("ExpressText+ needs the CM3 3D Text API and Zoidium object registry.");
  }
  state.PZ = PZ;
  state.THREE = THREE || null;
  state.editor = (context && context.editor) || null;
  if (!installTextPatches(PZ)) {
    deactivate();
    throw new Error("ExpressText+ could not install its 3D Text bindings.");
  }
  try {
    for (const definition of getExpressDefinitions()) {
      const ObjectClass = createExpressObjectClass(PZ, definition);
      state.objectClasses.push(ObjectClass);
      if (definition.kind) {
        // Effectors stay private to the single group: constructible
        // through the factory map, invisible to the picker and the
        // global type registry.
        state.effectorClasses[definition.type] = ObjectClass;
        continue;
      }
      state.unregisterObjectClasses.push(
        object3d.registerClass({
          type: definition.type,
          schemaVersion: definition.schemaVersion,
          name: definition.name,
          factory: () => new ObjectClass(),
        })
      );
    }
  } catch (error) {
    deactivate();
    throw error;
  }
  // Effector entries for the stock Custom properties + dialog, scoped to
  // ExpressText+ containers only. Best-effort: without the host registry
  // the customs row keeps the stock five and everything else works.
  registerEffectorEntries(PZ);
  try {
    console.log(
      "[ExpressText+] effector engine v11 (geometry rebuilds follow, never freeze; bundle v10)"
    );
  } catch (_log) {}
}

function deactivate() {
  clearDelayCache();
  unregisterEffectorEntries();
  restoreTextPatches();
  for (const textObject of Array.from(state.splitTexts)) {
    try {
      restoreExpressRendering(textObject);
    } catch (_error) {}
  }
  for (const unregister of state.unregisterObjectClasses) {
    try {
      unregister();
    } catch (error) {
      console.error("ExpressText+ could not unregister its container", error);
    }
  }
  state.PZ = null;
  state.THREE = null;
  state.editor = null;
  state.objectClasses = [];
  state.effectorClasses = {};
  state.unregisterObjectClasses = [];
  state.splitStates = new WeakMap();
  state.splitTexts = new Set();
}

module.exports = {
  activate,
  deactivate,
  _test: {
    EXPRESS_TEXT_TYPE,
    EXPRESS_SHAKE_TYPE,
    EXPRESS_PLAIN_TYPE,
    EXPRESS_RANDOM_TYPE,
    EXPRESS_FORMULA_TYPE,
    EXPRESS_SPLINE_TYPE,
    EXPRESS_ORBIT_TYPE,
    EXPRESS_REPEATER_TYPE,
    EXPRESS_TWIST_TYPE,
    EXPRESS_WRAP_TYPE,
    EXPRESS_VORONOI_TYPE,
    EXPRESS_DELAY_TYPE,
    SCHEMA_VERSION,
    FIELD_LABELS,
    DELAY_MODE_LABELS,
    RANDOM_MODE_LABELS,
    RANDOM_SPACE_LABELS,
    SPLINE_MODE_LABELS,
    SPLINE_PATH_LABELS,
    SPLINE_PLANE_LABELS,
    SPLINE_TRANSFORM_LABELS,
    REPEATER_MODE_LABELS,
    REPEATER_MAX_COPIES,
    TWIST_AXIS_LABELS,
    WRAP_DIRECTION_LABELS,
    repeaterSpecsFor,
    repeaterCopyOffset,
    repeaterCopyOpacity,
    rotateEulerXYZ,
    eulerFromBasis,
    rotateAxisX,
    rotateAxisY,
    rotateAxisZ,
    containerTexts,
    textWorldOf,
    ownTransformOf,
    throughParent,
    worldBaseOf,
    localBaseOf,
    layoutLetterCount,
    containerLetterRun,
    DELAY_ORDER_LABELS,
    numberValue,
    vector3,
    parseLetterSelection,
    splitSelectionTokens,
    resolveSelection,
    isLetterSelected,
    selectedList,
    strengthWeight,
    fieldWeight,
    hashSeed,
    seededRandom,
    hashLattice,
    valueNoise3,
    fractalNoise3,
    shuffledStrata,
    randomUnit,
    delayRank,
    shakeValue,
    plainListsAt,
    delayLinkParams,
    chaseToward,
    blankDelayVelocity,
    runDelayLetterStage,
    simulateDelayLetter,
    DELAY_EVEN_SPAN,
    DELAY_BLEND_CATCH,
    DELAY_SPRING_STIFF,
    DELAY_SPRING_DAMP,
    DELAY_SPRING_DAMP_MIN,
    DELAY_SIM_WINDOW,
    blendDelayOutput,
    readProp,
    readVector,
    staticProps,
    blankControls,
    evaluateShake,
    evaluatePlain,
    evaluateRandom,
    evaluateFormula,
    evaluateSpline,
    evaluateOrbit,
    evaluateTwist,
    evaluateWrap,
    sampleSplinePath,
    haltonSequence,
    splitVoronoiCells,
    voronoiChunkPose,
    geometryTriangleArrays,
    eulerParts,
    sourceExtrudeOptions,
    tokenizeFormula,
    parseFormula,
    compileFormula,
    evaluateStack,
    letterContext,
    getExpressLayout,
    getExpressCenterOffset,
    getExpressTextCenter,
    customsChildren,
    sectionGroupOf,
    groupReader,
    kindOfKey,
    kindOfGroup,
    customSections,
    rawArray,
    reattachCustomDefinitions,
    stackLayersFor,
    getSplitState,
    buildExpressRendering,
    disposeExpressRendering,
    restoreExpressRendering,
    applyLetterTransform,
    updateExpressRendering,
    collectExpressObjects,
    expressContainerOf,
    expressStackOf,
    customPropertyClass,
    effectorEntryDefs,
    registerEffectorEntries,
    unregisterEffectorEntries,
    EFFECTOR_ORDER,
    EFFECTOR_NAMES,
    EFFECTOR_TYPES,
    EFFECTOR_KINDS,
    newEffectorInstance,
    getExpressDefinitions,
    createExpressObjectClass,
    EFFECTOR_PIVOT_KEYS,
    getAncestorObject,
    createContainerPropertyDefinitions,
    createShakePropertyDefinitions,
    createPlainPropertyDefinitions,
    createRandomPropertyDefinitions,
    createFormulaPropertyDefinitions,
    createSplinePropertyDefinitions,
    createOrbitPropertyDefinitions,
    createRepeaterPropertyDefinitions,
    createTwistPropertyDefinitions,
    createWrapPropertyDefinitions,
    createVoronoiPropertyDefinitions,
    createDelayPropertyDefinitions,
    defaultExpressData,
    withPrefix,
  },
};
