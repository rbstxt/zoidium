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
      geometry: bundleRequire("./text-plus-geometry.js"),
    };
  }
  return {
    utils: require("./text-plus-utils.js"),
    properties: require("./text-plus-properties.js"),
    controls: require("./text-plus-controls.js"),
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
let propertyValue;let createTextShapes;
let textGeometryOptions;
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
      spacingInserted = true;
    }
  }
  if (!spacingInserted) definitions.spacing = spacingDefinition;
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

  if (typeof originalUpdateGeometry === "function") {
    const patchedUpdateGeometry = function updateGeometry() {
      const font = this.font?.font3d;
      const THREE = state.THREE;
      if (
        !font ||
        !this.threeObj ||
        typeof THREE?.ExtrudeGeometry !== "function"
      ) {
        return originalUpdateGeometry.apply(this, arguments);
      }

      const options = textGeometryOptions(this, font);
      const shapes = createTextShapes(
        font,
        propertyValue(this.properties?.text, 0, ""),
        options.size,
        options.curveSegments,
        propertyValue(this.properties?.spacing, 0, 0)
      );
      const geometry = new THREE.ExtrudeGeometry(shapes, options);
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
      return numberValue(property.get(), Number.NaN) !== expected;
    } catch (_error) {
      return false;
    }
  };
  return (
    differs("spacing", 0) ||
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
  let used = false;
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
  restoreTextPatches();
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
