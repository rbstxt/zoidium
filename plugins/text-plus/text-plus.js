"use strict";

// Text+ plugin entry: native 3D Text host patches and parent-object
// lifecycle. The implementation lives in the sibling files, loaded through
// the shared bundle loader in the shipped bundle and through local files in
// Node (tests).

function loadTextPlusParts(context) {
  if (
    context &&
    context.apis &&
    context.apis.modules &&
    typeof context.apis.modules.createRequire === "function" &&
    typeof context.getAsset === "function"
  ) {
    const bundleRequire = context.apis.modules.createRequire(context.getAsset, {
      root: "./plugins/text-plus/",
    });
    return {
      utils: bundleRequire("./text-plus-utils.js"),
      properties: bundleRequire("./text-plus-properties.js"),
      controls: bundleRequire("./text-plus-controls.js"),
      diagnostics: bundleRequire("./text-plus-diagnostics.js"),
      geometry: bundleRequire("./text-plus-geometry.js"),
    };
  }
  return {
    utils: require("./text-plus-utils.js"),
    properties: require("./text-plus-properties.js"),
    controls: require("./text-plus-controls.js"),
    diagnostics: require("./text-plus-diagnostics.js"),
    geometry: require("./text-plus-geometry.js"),
  };
}

let parts = null;
// Set once the first per-frame 3D Text rebuild failure is reported, so a
// persistent failure cannot flood the console; cleared by a later success.
let rebuildWarned = false;
let state;
let numberValue;
let TEXT_PLUS_TYPE;
let TEXT_PLUS_NAME;
let SCHEMA_VERSION;
let GRADIENT_TRANSFORM_TYPE;
let GRADIENT_TRANSFORM_SCHEMA_VERSION;
let GRADIENT_TRANSFORM_NAME;
let CHARACTER_SHAKE_TYPE;
let CHARACTER_SHAKE_SCHEMA_VERSION;
let CHARACTER_SHAKE_NAME;
let SELECTED_TRANSFORM_TYPE;
let SELECTED_TRANSFORM_SCHEMA_VERSION;
let SELECTED_TRANSFORM_NAME;
let SELECTED_SHAKE_TYPE;
let SELECTED_SHAKE_SCHEMA_VERSION;
let SELECTED_SHAKE_NAME;
let RANDOM_SCATTER_TYPE;
let RANDOM_SCATTER_SCHEMA_VERSION;
let RANDOM_SCATTER_NAME;
let defaultObjectData;
let defaultCharacterShakeData;
let defaultGradientTransformData;
let defaultSelectedTransformData;
let defaultSelectedShakeData;
let defaultRandomScatterData;
let createPropertyCategory;
let createTransformPropertyDefinitions;
let createGradientTransformPropertyDefinitions;
let createShakePropertyDefinitions;
let createRandomScatterPropertyDefinitions;
let propertyValue;
let createTextShapes;
let textGeometryOptions;
let hasVisibleCharacters;
let reportTextFontIssue;
let reportUnavailableFont;
let clearTextFontWarnings;
let resetTextFontDiagnostics;
let watchFontLoad;
let observeFontRevision;
let countGeometryVertices;
let collectTextPlusObjects;
let syncTextRendering;
let restoreTextRendering;

function refreshTextPlusBindings(loaded) {
  parts = loaded;
  state = loaded.utils.state;
  numberValue = loaded.utils.numberValue;
  TEXT_PLUS_TYPE = loaded.utils.TEXT_PLUS_TYPE;
  TEXT_PLUS_NAME = loaded.utils.TEXT_PLUS_NAME;
  SCHEMA_VERSION = loaded.utils.SCHEMA_VERSION;
  GRADIENT_TRANSFORM_TYPE = loaded.utils.GRADIENT_TRANSFORM_TYPE;
  GRADIENT_TRANSFORM_SCHEMA_VERSION =
    loaded.utils.GRADIENT_TRANSFORM_SCHEMA_VERSION;
  GRADIENT_TRANSFORM_NAME = loaded.utils.GRADIENT_TRANSFORM_NAME;
  CHARACTER_SHAKE_TYPE = loaded.utils.CHARACTER_SHAKE_TYPE;
  CHARACTER_SHAKE_SCHEMA_VERSION =
    loaded.utils.CHARACTER_SHAKE_SCHEMA_VERSION;
  CHARACTER_SHAKE_NAME = loaded.utils.CHARACTER_SHAKE_NAME;
  SELECTED_TRANSFORM_TYPE = loaded.utils.SELECTED_TRANSFORM_TYPE;
  SELECTED_TRANSFORM_SCHEMA_VERSION =
    loaded.utils.SELECTED_TRANSFORM_SCHEMA_VERSION;
  SELECTED_TRANSFORM_NAME = loaded.utils.SELECTED_TRANSFORM_NAME;
  SELECTED_SHAKE_TYPE = loaded.utils.SELECTED_SHAKE_TYPE;
  SELECTED_SHAKE_SCHEMA_VERSION = loaded.utils.SELECTED_SHAKE_SCHEMA_VERSION;
  SELECTED_SHAKE_NAME = loaded.utils.SELECTED_SHAKE_NAME;
  RANDOM_SCATTER_TYPE = loaded.utils.RANDOM_SCATTER_TYPE;
  RANDOM_SCATTER_SCHEMA_VERSION = loaded.utils.RANDOM_SCATTER_SCHEMA_VERSION;
  RANDOM_SCATTER_NAME = loaded.utils.RANDOM_SCATTER_NAME;
  defaultObjectData = loaded.utils.defaultObjectData;
  defaultCharacterShakeData = loaded.utils.defaultCharacterShakeData;
  defaultGradientTransformData = loaded.utils.defaultGradientTransformData;
  defaultSelectedTransformData = loaded.utils.defaultSelectedTransformData;
  defaultSelectedShakeData = loaded.utils.defaultSelectedShakeData;
  defaultRandomScatterData = loaded.utils.defaultRandomScatterData;
  createPropertyCategory = loaded.properties.createPropertyCategory;
  createTransformPropertyDefinitions =
    loaded.properties.createTransformPropertyDefinitions;
  createGradientTransformPropertyDefinitions =
    loaded.properties.createGradientTransformPropertyDefinitions;
  createShakePropertyDefinitions =
    loaded.properties.createShakePropertyDefinitions;
  createRandomScatterPropertyDefinitions =
    loaded.properties.createRandomScatterPropertyDefinitions;
  propertyValue = loaded.controls.propertyValue;
  hasVisibleCharacters = loaded.diagnostics.hasVisibleCharacters;
  reportTextFontIssue = loaded.diagnostics.reportTextFontIssue;
  reportUnavailableFont = loaded.diagnostics.reportUnavailableFont;
  clearTextFontWarnings = loaded.diagnostics.clearTextFontWarnings;
  resetTextFontDiagnostics = loaded.diagnostics.resetTextFontDiagnostics;
  watchFontLoad = loaded.diagnostics.watchFontLoad;
  observeFontRevision = loaded.diagnostics.observeFontRevision;
  countGeometryVertices = loaded.diagnostics.countGeometryVertices;
  collectTextPlusObjects = loaded.utils.collectTextPlusObjects;
  createTextShapes = loaded.geometry.createTextShapes;
  textGeometryOptions = loaded.geometry.textGeometryOptions;
  syncTextRendering = loaded.geometry.syncTextRendering;
  restoreTextRendering = loaded.geometry.restoreTextRendering;
  module.exports._test = buildTextPlusTestExports();
}

function ensureTextPlusParts(context) {
  if (!parts) refreshTextPlusBindings(loadTextPlusParts(context));
  return parts;
}

// The sibling files need no host context under plain Node require, but the
// bundle loader does; when neither is available yet, stay unbound and let
// ensureTextPlusParts(context) bind later at activation.
try {
  if (typeof require === "function") refreshTextPlusBindings(loadTextPlusParts(null));
} catch (error) {
  parts = null;
}

function buildTextPlusTestExports() {
  return {
    CHARACTER_SHAKE_TYPE: parts.utils.CHARACTER_SHAKE_TYPE,
    DELAY_ORDERS: parts.utils.DELAY_ORDERS,
    GRADIENT_TRANSFORM_TYPE: parts.utils.GRADIENT_TRANSFORM_TYPE,
    RANDOM_SCATTER_TYPE: parts.utils.RANDOM_SCATTER_TYPE,
    SELECTED_SHAKE_TYPE: parts.utils.SELECTED_SHAKE_TYPE,
    SELECTED_TRANSFORM_TYPE: parts.utils.SELECTED_TRANSFORM_TYPE,
    TEXT_PLUS_TYPE: parts.utils.TEXT_PLUS_TYPE,
    applyReferenceSpaceCharacterTransform:
      parts.geometry.applyReferenceSpaceCharacterTransform,
    collectTextPlusObjects: parts.utils.collectTextPlusObjects,
    createRandomScatterPropertyDefinitions:
      parts.properties.createRandomScatterPropertyDefinitions,
    createGradientTransformPropertyDefinitions:
      parts.properties.createGradientTransformPropertyDefinitions,
    createPropertyCategory: parts.properties.createPropertyCategory,
    textUsesExtendedProperties,
    observeFontRevision: parts.diagnostics.observeFontRevision,
    resetTextFontDiagnostics: parts.diagnostics.resetTextFontDiagnostics,
    createShakePropertyDefinitions:
      parts.properties.createShakePropertyDefinitions,
    createTransformPropertyDefinitions:
      parts.properties.createTransformPropertyDefinitions,
    defaultCharacterShakeData: parts.utils.defaultCharacterShakeData,
    defaultGradientTransformData: parts.utils.defaultGradientTransformData,
    defaultObjectData: parts.utils.defaultObjectData,
    defaultRandomScatterData: parts.utils.defaultRandomScatterData,
    defaultSelectedShakeData: parts.utils.defaultSelectedShakeData,
    defaultSelectedTransformData: parts.utils.defaultSelectedTransformData,
    getAncestorObject: parts.utils.getAncestorObject,
    getCenterOffset: parts.utils.getCenterOffset,
    getCharacterDelay: parts.utils.getCharacterDelay,
    getCharacterShakeControls: parts.controls.getCharacterShakeControls,
    getCharacterTransformControls: parts.controls.getCharacterTransformControls,
    getCharacterTransformReference:
      parts.geometry.getCharacterTransformReference,
    createTextShapes: parts.geometry.createTextShapes,
    getTextPropertyDefinitions,
    getDelayRank: parts.utils.getDelayRank,
    resolveCharacterRange: parts.utils.resolveCharacterRange,
    getEffectiveCharacterRange: parts.geometry.getEffectiveCharacterRange,
    reportCharacterBuildResult: parts.geometry.reportCharacterBuildResult,
    getMatrixToAncestor: parts.geometry.getMatrixToAncestor,
    getGradientTransformControls: parts.controls.getGradientTransformControls,
    getRandomOrder: parts.utils.getRandomOrder,
    getRandomScatterControls: parts.controls.getRandomScatterControls,
    getRandomScatterTransform: parts.utils.getRandomScatterTransform,
    getSelectedCharacterContext: parts.controls.getSelectedCharacterContext,
    getShakeAngle: parts.utils.getShakeAngle,
    getTextLayout: parts.utils.getTextLayout,
    textGeometryOptions: parts.geometry.textGeometryOptions,
    getTextCenter: parts.utils.getTextCenter,
    getTextPlusProperties: parts.properties.getTextPlusProperties,
    getTextPlusControls: parts.controls.getTextPlusControls,
    textUsesExtendedProperties,
    observeFontRevision: parts.diagnostics.observeFontRevision,
    resetTextFontDiagnostics: parts.diagnostics.resetTextFontDiagnostics,
    hasVisibleCharacters: parts.diagnostics.hasVisibleCharacters,
    describeTextFont: parts.diagnostics.describeTextFont,
    formatTextFontMessage: parts.diagnostics.formatTextFontMessage,
    reportTextFontIssue: parts.diagnostics.reportTextFontIssue,
    reportUnavailableFont: parts.diagnostics.reportUnavailableFont,
    countGeometryVertices: parts.diagnostics.countGeometryVertices,
    clearTextFontWarnings: parts.diagnostics.clearTextFontWarnings,
    watchFontLoad: parts.diagnostics.watchFontLoad,
    parseCharacterSelection: parts.controls.parseCharacterSelection,
    seededRandom: parts.utils.seededRandom,
    lerpVector: parts.controls.lerpVector,
    finiteBox: parts.geometry.finiteBox,
    expandBounds: parts.geometry.expandBounds,
  };
}

/* ------------------------------------------------------------------ plugin */

function createTextParentObjectClass(PZ, definition) {
  const propertyDefinitions = definition.createProperties(PZ);

  class TextParentObject extends PZ.object3d.group {
    constructor() {
      super();
      this.objects.name = definition.objectsName;
      this.characterProperties = createPropertyCategory(
        PZ,
        this,
        "Character",
        propertyDefinitions
      );
      this.type = definition.type;
    }

    load(data) {
      const normalized = definition.normalize(data);
      super.load(normalized);
      this.characterProperties.load(normalized.characterProperties);
      this.type = definition.type;
    }

    toJSON() {
      const data = super.toJSON();
      data.type = definition.type;
      data.schemaVersion = definition.schemaVersion;
      data.characterProperties = this.characterProperties;
      return data;
    }
  }

  TextParentObject.prototype.defaultName = definition.name;
  TextParentObject.prototype.zoidiumTextPlusObject = true;
  TextParentObject.prototype.zoidiumTextPlusMode = definition.mode;
  return TextParentObject;
}

function getTextParentDefinitions() {
  return [
    {
      type: TEXT_PLUS_TYPE,
      schemaVersion: SCHEMA_VERSION,
      name: TEXT_PLUS_NAME,
      mode: "character-transform",
      objectsName: "Text",
      createProperties: (PZ) => createTransformPropertyDefinitions(PZ, false),
      normalize: defaultObjectData,
    },
    {
      type: GRADIENT_TRANSFORM_TYPE,
      schemaVersion: GRADIENT_TRANSFORM_SCHEMA_VERSION,
      name: GRADIENT_TRANSFORM_NAME,
      mode: "gradient-transform",
      objectsName: "Text",
      createProperties: createGradientTransformPropertyDefinitions,
      normalize: defaultGradientTransformData,
    },
    {
      type: CHARACTER_SHAKE_TYPE,
      schemaVersion: CHARACTER_SHAKE_SCHEMA_VERSION,
      name: CHARACTER_SHAKE_NAME,
      mode: "character-shake",
      objectsName: "Text",
      createProperties: (PZ) => createShakePropertyDefinitions(PZ, false),
      normalize: defaultCharacterShakeData,
    },
    {
      type: SELECTED_TRANSFORM_TYPE,
      schemaVersion: SELECTED_TRANSFORM_SCHEMA_VERSION,
      name: SELECTED_TRANSFORM_NAME,
      mode: "selected-transform",
      objectsName: "Text",
      createProperties: (PZ) => createTransformPropertyDefinitions(PZ, true),
      normalize: defaultSelectedTransformData,
    },
    {
      type: SELECTED_SHAKE_TYPE,
      schemaVersion: SELECTED_SHAKE_SCHEMA_VERSION,
      name: SELECTED_SHAKE_NAME,
      mode: "selected-shake",
      objectsName: "Text",
      createProperties: (PZ) => createShakePropertyDefinitions(PZ, true),
      normalize: defaultSelectedShakeData,
    },
    {
      type: RANDOM_SCATTER_TYPE,
      schemaVersion: RANDOM_SCATTER_SCHEMA_VERSION,
      name: RANDOM_SCATTER_NAME,
      mode: "random-scatter",
      objectsName: "Text",
      createProperties: createRandomScatterPropertyDefinitions,
      normalize: defaultRandomScatterData,
    },
  ];
}

function getTextPropertyDefinitions(PZ) {
  const textClass = PZ.object3d.text;
  const original = textClass.propertyDefinitions || {};
  const changeFn = textClass.changeFn;
  const type = PZ.property.type;
  const originalBevelSize = original.bevelSize || {};

  const spacingDefinition = {
      name: "Horizontal spacing",
      type: type.NUMBER,
      value: 0,
      changed: changeFn,
      max: 200,
      min: -200,
      step: 0.5,
      decimals: 2,
  };
  // Per-character sequencing across several Text objects: "Index offset"
  // shifts this Text's letters within the word ("this Text starts at
  // character <offset>"), "Total characters" replaces the character count
  // used for delay and gradient math (0 keeps this Text's own count). Both
  // default to 0, which evaluates exactly like the local index and count.
  const characterRangeDefinitions = {
    characterIndexOffset: {
      dynamic: true,
      interpolated: true,
      name: "Index offset",
      type: type.NUMBER,
      value: 0,
      changed: changeFn,
      min: 0,
      step: 1,
      decimals: 0,
    },
    characterCountOverride: {
      dynamic: true,
      interpolated: true,
      name: "Total characters",
      type: type.NUMBER,
      value: 0,
      changed: changeFn,
      min: 0,
      step: 1,
      decimals: 0,
    },
  };
  const bevelSizeDefinition = {
      ...originalBevelSize,
      name: "Bevel size",
      type: type.VECTOR2,
      value: Array.isArray(originalBevelSize.value)
        ? originalBevelSize.value.slice()
        : [0.1, 0.5],
      subtitle1: "thickness",
      subtitle2: "width",
      changed: changeFn,
      min: 0,
      step: 0.05,
      decimals: 2,
  };
  const advancedBevelDefinitions = {
    bevelSide: {
      name: "Bevel side",
      type: type.OPTION,
      value: 0,
      items: "outside;inside",
      changed: changeFn,
    },
    bevelDetail: {
      name: "Bevel subdivision",
      type: type.NUMBER,
      value: 3,
      changed: changeFn,
      max: 100,
      min: 1,
      step: 1,
      decimals: 0,
    },
    bevelProfile: {
      name: "Cap profile",
      type: type.OPTION,
      value: 1,
      items: "flat;round",
      changed: changeFn,
    },
    bevelTension: {
      name: "Bevel tension",
      type: type.NUMBER,
      value: 0.5,
      changed: changeFn,
      min: 0,
      max: 1,
      step: 0.01,
      decimals: 2,
    },
  };

  const definitions = {};
  let spacingInserted = false;
  let bevelInserted = false;
  for (const [name, definition] of Object.entries(original)) {
    if (name === "spacing") continue;
    if (Object.prototype.hasOwnProperty.call(advancedBevelDefinitions, name)) {
      continue;
    }
    if (name === "bevelSize") {
      definitions.bevelSize = bevelSizeDefinition;
      definitions.bevelSide = advancedBevelDefinitions.bevelSide;
      definitions.bevelDetail = advancedBevelDefinitions.bevelDetail;
      definitions.bevelProfile = advancedBevelDefinitions.bevelProfile;
      definitions.bevelTension = advancedBevelDefinitions.bevelTension;
      bevelInserted = true;
    } else {
      definitions[name] = definition;
    }
    if (name === "detail") {
      definitions.spacing = spacingDefinition;
      definitions.characterIndexOffset =
        characterRangeDefinitions.characterIndexOffset;
      definitions.characterCountOverride =
        characterRangeDefinitions.characterCountOverride;
      spacingInserted = true;
    }
  }
  if (!spacingInserted) {
    definitions.spacing = spacingDefinition;
    definitions.characterIndexOffset =
      characterRangeDefinitions.characterIndexOffset;
    definitions.characterCountOverride =
      characterRangeDefinitions.characterCountOverride;
  }
  if (!bevelInserted) {
    definitions.bevelSize = bevelSizeDefinition;
    Object.assign(definitions, advancedBevelDefinitions);
  }
  return definitions;
}

function installTextPropertyPatches(PZ) {
  const textClass = PZ.object3d?.text;
  if (!textClass || !textClass.propertyDefinitions) return;
  const original = textClass.propertyDefinitions;
  const patched = getTextPropertyDefinitions(PZ);
  textClass.propertyDefinitions = patched;
  state.textPropertyDefinitionsOriginal = original;
  state.textPropertyDefinitionsPatched = patched;
}

function installTextPatches(PZ) {
  const textClass = PZ.object3d?.text;
  const prototype = textClass?.prototype;
  if (!prototype || typeof prototype.update !== "function") return false;
  const originalUpdate = prototype.update;
  const originalUpdateGeometry = prototype.updateGeometry;
  const originalUnload = prototype.unload;

  installTextPropertyPatches(PZ);
  const requestName = "zoidiumRequestCharacterSplit";
  const requestOriginal = Object.getOwnPropertyDescriptor(prototype, requestName);
  const requestPatched = function requestCharacterSplit(owner) {
    return parts.geometry.requestCharacterSplit(this, owner);
  };
  Object.defineProperty(prototype, requestName, {
    configurable: true, writable: true, value: requestPatched,
  });
  state.restoreCharacterRequest = () => {
    if (prototype[requestName] !== requestPatched) return;
    if (requestOriginal) Object.defineProperty(prototype, requestName, requestOriginal);
    else delete prototype[requestName];
  };

  if (typeof originalUpdateGeometry === "function") {
    const patchedUpdateGeometry = function updateGeometry() {
      const font = this.font?.font3d;
      const THREE = state.THREE;
      if (
        !font ||
        !this.threeObj ||
        typeof THREE?.ExtrudeGeometry !== "function"
      ) {
        if (this.threeObj && collectTextPlusObjects(this).length > 0) {
          watchFontLoad(this);
          reportUnavailableFont(this);
        }
        return originalUpdateGeometry.apply(this, arguments);
      }

      const rawText = propertyValue(this.properties?.text, 0, "");
      const options = textGeometryOptions(this, font);
      const shapes = createTextShapes(
        font,
        rawText,
        options.size,
        options.curveSegments,
        propertyValue(this.properties?.spacing, 0, 0)
      );
      const geometry = new THREE.ExtrudeGeometry(shapes, options);
      if (collectTextPlusObjects(this).length > 0 && hasVisibleCharacters(rawText)) {
        if (shapes.length === 0) reportTextFontIssue(this, "no-shapes");
        else if (countGeometryVertices(geometry) === 0) reportTextFontIssue(this, "zero-vertices");
      } else if (!hasVisibleCharacters(rawText)) {
        clearTextFontWarnings(this);
      }
      const previousGeometry = this.threeObj.geometry;
      if (previousGeometry && previousGeometry !== geometry) {
        previousGeometry.dispose?.();
      }
      this.threeObj.geometry = geometry;
      geometry.buffersNeedUpdate = true;
      this.center?.();
    };
    patchedUpdateGeometry._zoidiumTextPlusPatched = true;
    prototype.updateGeometry = patchedUpdateGeometry;
    state.textUpdateGeometryOriginal = originalUpdateGeometry;
    state.textUpdateGeometryPatched = patchedUpdateGeometry;
  }

  const patchedUpdate = function update(frame) {
    if (collectTextPlusObjects(this).length > 0) observeFontRevision(this);
    originalUpdate.call(this, frame);
    try {
      syncTextRendering(this, frame);
      rebuildWarned = false;
    } catch (error) {
      restoreTextRendering(this);
      if (!rebuildWarned) {
        rebuildWarned = true;
        console.warn("[Zoidium] text-plus: could not rebuild a 3D Text object", error);
      }
    }
  };
  patchedUpdate._zoidiumTextPlusPatched = true;

  const patchedUnload = function unload() {
    parts.geometry.clearCharacterSplitRequests(this);
    restoreTextRendering(this);
    if (typeof originalUnload === "function") {
      return originalUnload.apply(this, arguments);
    }
    return undefined;
  };
  patchedUnload._zoidiumTextPlusPatched = true;

  prototype.update = patchedUpdate;
  prototype.unload = patchedUnload;
  state.textUpdateOriginal = originalUpdate;
  state.textUpdatePatched = patchedUpdate;
  state.textUnloadOriginal = originalUnload;
  state.textUnloadPatched = patchedUnload;
  return true;
}

function restoreTextPatches() {
  const PZ = state.PZ;
  const prototype = PZ?.object3d?.text?.prototype;
  const textClass = PZ?.object3d?.text;
  if (prototype?.updateGeometry === state.textUpdateGeometryPatched) {
    prototype.updateGeometry = state.textUpdateGeometryOriginal;
  }
  if (prototype?.update === state.textUpdatePatched) {
    prototype.update = state.textUpdateOriginal;
  }
  if (prototype?.unload === state.textUnloadPatched) {
    prototype.unload = state.textUnloadOriginal;
  }
  if (textClass?.propertyDefinitions === state.textPropertyDefinitionsPatched) {
    textClass.propertyDefinitions = state.textPropertyDefinitionsOriginal;
  }
  state.textPropertyDefinitionsOriginal = null;
  state.textPropertyDefinitionsPatched = null;
  state.textUpdateGeometryOriginal = null;
  state.textUpdateGeometryPatched = null;
  state.textUpdateOriginal = null;
  state.textUpdatePatched = null;
  state.textUnloadOriginal = null;
  state.textUnloadPatched = null;
}

function textUsesExtendedProperties(textObject) {
  const properties = textObject?.properties;
  if (!properties) return false;
  const differs = (name, expected) => {
    const property = properties[name];
    if (!property || typeof property.get !== "function") return false;
    // An unreadable property cannot prove extended use; treat it as default.
    try {
      // Never read an animated property without an explicit frame: an
      // arg-less get() cannot terminate on multi-keyframe properties.
      // Any keyframe value differing from the default proves extended use.
      if (property.animated && property.keyframes) {
        const keyframes = property.keyframes;
        const count = Number.isSafeInteger(keyframes.length)
          ? keyframes.length
          : 0;
        for (let index = 0; index < count; index += 1) {
          if (numberValue(keyframes[index]?.value, Number.NaN) !== expected) {
            return true;
          }
        }
        return false;
      }
      return numberValue(property.get(0), Number.NaN) !== expected;
    } catch (_error) {
      return false;
    }
  };
  return (
    differs("spacing", 0) ||
    differs("characterIndexOffset", 0) ||
    differs("characterCountOverride", 0) ||
    differs("bevelSide", 0) ||
    differs("bevelDetail", 3) ||
    differs("bevelProfile", 1) ||
    differs("bevelTension", 0.5)
  );
}

function isInUse() {
  if (!parts) return false;
  const project = state.editor?.project;
  const TextObject = state.PZ?.object3d?.text;
  if (!project || !TextObject || typeof project.forEachItemOfType !== "function") {
    return false;
  }
  let used = state.splitTexts.size > 0;
  project.forEachItemOfType(TextObject, (textObject) => {
    if (textUsesExtendedProperties(textObject)) used = true;
  });
  return used;
}

function activate(context) {
  ensureTextPlusParts(context);
  if (state.PZ) return;
  const { PZ, window, object3d } = context || {};
  const THREE = window?.THREE;
  if (
    !PZ?.object3d?.group ||
    !PZ.object3d.text ||
    !PZ.property ||
    !THREE?.TextGeometry ||
    !object3d
  ) {
    throw new Error("Text+ requires the CM3 3D Text API and Zoidium object registry.");
  }

  context.lifecycle?.onDispose?.(deactivate);
  state.PZ = PZ;
  state.THREE = THREE;
  state.editor = context.editor || null;
  if (!installTextPatches(PZ)) {
    deactivate();
    throw new Error("Text+ could not install its 3D Text bindings.");
  }

  try {
    for (const definition of getTextParentDefinitions()) {
      const ObjectClass = createTextParentObjectClass(PZ, definition);
      state.objectClasses.push(ObjectClass);
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
}

function deactivate() {
  if (!parts) return;
  state.restoreCharacterRequest?.();
  state.restoreCharacterRequest = null;
  parts.geometry.clearCharacterSplitRequests();
  restoreTextPatches();
  resetTextFontDiagnostics();
  for (const textObject of Array.from(state.splitTexts)) {
    restoreTextRendering(textObject);
  }
  for (const unregister of state.unregisterObjectClasses) {
    try {
      unregister();
    } catch (error) {
      console.error("Text+ could not unregister a 3D parent object", error);
    }
  }
  state.PZ = null;
  state.THREE = null;
  state.editor = null;
  state.objectClasses = [];
  state.unregisterObjectClasses = [];
  state.splitStates = new WeakMap();
  state.splitTexts = new Set();
}

module.exports = {
  activate,
  deactivate,
  isInUse,
  _test: parts ? buildTextPlusTestExports() : {},
};
