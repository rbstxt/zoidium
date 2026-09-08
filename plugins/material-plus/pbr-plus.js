"use strict";

const PBR_MATERIAL_ID = "pbrplus";
const PBR_MATERIAL_NAME = "PBR+ Material";

const state = {
  active: false,
  PZ: null,
  THREE: null,
  plugin: null,
  previousFactory: undefined,
  hadPreviousFactory: false,
  factory: null,
};

const WRAP_VALUES = Object.freeze([
  "ClampToEdgeWrapping",
  "RepeatWrapping",
  "MirroredRepeatWrapping",
]);

function readNumber(property, frame, fallback) {
  try {
    const value = property?.get?.(frame);
    return Number.isFinite(Number(value)) ? Number(value) : fallback;
  } catch (_error) {
    return fallback;
  }
}

function readColor(property, frame, fallback) {
  try {
    const value = property?.get?.(frame);
    if (Array.isArray(value) && value.length >= 3) {
      return [
        Number(value[0]) || 0,
        Number(value[1]) || 0,
        Number(value[2]) || 0,
      ];
    }
  } catch (_error) {
    // Use the caller's fallback when a color property is unavailable.
  }
  return fallback.slice();
}

function readVector2(property, frame, fallback) {
  try {
    const value = property?.get?.(frame);
    if (Array.isArray(value) && value.length >= 2) {
      return [
        Number.isFinite(Number(value[0])) ? Number(value[0]) : fallback[0],
        Number.isFinite(Number(value[1])) ? Number(value[1]) : fallback[1],
      ];
    }
  } catch (_error) {
    // Use the fallback below when a vector property is unavailable.
  }
  return fallback.slice();
}

function getOptionValue(property, fallback) {
  const value = Number(property?.value);
  return Number.isFinite(value) ? value : fallback;
}

function getWrapConstant(THREE, index) {
  const name = WRAP_VALUES[index] || WRAP_VALUES[1];
  return THREE[name] ?? THREE.RepeatWrapping;
}

function textureSlots(material) {
  return Object.values(material._zoidiumTextureSlots || {});
}

function disposeTextureSlot(material, slot) {
  const oldAsset = slot.asset;
  const oldTexture = slot.texture;
  slot.asset = null;
  slot.image = null;
  slot.texture = null;
  slot.value = null;

  if (
    material.threeObj &&
    material.threeObj[slot.materialProperty] === oldTexture
  ) {
    material.threeObj[slot.materialProperty] = null;
    material.threeObj.needsUpdate = true;
  }

  if (oldAsset) {
    try {
      material.parentProject?.assets?.unload(oldAsset);
    } catch (error) {
      console.error("Material+ could not unload a PBR texture asset", error);
    }
  }
  oldTexture?.dispose?.();
}

function applyTextureSettings(material, updateWrapping, frame) {
  const wrap = getOptionValue(material.properties.wrap, 1);
  const currentFrame = Number.isFinite(Number(frame)) ? Number(frame) : 0;
  const repeat = readVector2(material.properties.repeat, currentFrame, [1, 1]);
  const offset = readVector2(material.properties.offset, currentFrame, [0, 0]);
  const center = readVector2(material.properties.center, currentFrame, [0, 0]);
  const rotation = readNumber(material.properties.rotation, currentFrame, 0);

  for (const slot of textureSlots(material)) {
    const texture = slot.texture;
    if (!texture) continue;
    if (updateWrapping) {
      texture.wrapS = getWrapConstant(state.THREE, wrap);
      texture.wrapT = getWrapConstant(state.THREE, wrap);
      texture.needsUpdate = true;
    }
    texture.repeat.set(repeat[0], repeat[1]);
    texture.offset.set(offset[0], offset[1]);
    texture.center.set(center[0], center[1]);
    texture.rotation = rotation;
  }
}

function loadTextureSlot(material, slot, value) {
  slot.generation += 1;
  const generation = slot.generation;
  disposeTextureSlot(material, slot);

  if (!value || !material.parentProject?.assets || !material.threeObj) {
    return;
  }

  let asset = null;
  try {
    asset = material.parentProject.assets.load(value);
    const image = new state.PZ.asset.image(asset);
    const texture = image.getTexture(true);
    slot.asset = asset;
    slot.image = image;
    slot.texture = texture;
    slot.value = value;
    material.threeObj[slot.materialProperty] = texture;
    applyTextureSettings(material, true, 0);
    material.threeObj.needsUpdate = true;

    const loading = image.loading;
    if (loading && typeof loading.then === "function") {
      Promise.resolve(loading).then(() => {
        if (slot.generation !== generation || slot.texture !== texture) return;
        texture.needsUpdate = true;
      }).catch((error) => {
        if (slot.generation !== generation || slot.texture !== texture) return;
        console.error("Material+ could not decode a PBR texture", error);
      });
    }
  } catch (error) {
    if (asset) {
      try {
        material.parentProject.assets.unload(asset);
      } catch (_unloadError) {
        // Keep the original load error as the useful diagnostic.
      }
    }
    material.threeObj[slot.materialProperty] = null;
    material.threeObj.needsUpdate = true;
    console.error("Material+ could not load a PBR texture", error);
  }
}

function loadAllTextureSlots(material) {
  for (const slot of textureSlots(material)) {
    const property = material.properties[slot.propertyName];
    loadTextureSlot(material, slot, property?.value || null);
  }
}

function releaseEnvironmentMap(material) {
  if (material._zoidiumEnvironmentSource?.releaseTexture) {
    try {
      material._zoidiumEnvironmentSource.releaseTexture();
    } catch (error) {
      console.error("Material+ could not release a PBR environment map", error);
    }
  }
  material._zoidiumEnvironmentSource = null;
  material._zoidiumEnvironmentLayer = null;
  if (material.threeObj?.envMap) {
    material.threeObj.envMap = null;
    material.threeObj.needsUpdate = true;
  }
}

function syncEnvironmentMap(material) {
  if (!material.threeObj) return;

  const enabled = getOptionValue(material.properties.reflection, 0) === 1;
  const layer = material.parentLayer;
  const source = layer?.envMap;

  if (!enabled || !source?.getTexture) {
    if (material._zoidiumEnvironmentSource || material.threeObj.envMap) {
      releaseEnvironmentMap(material);
    }
    return;
  }

  if (
    material._zoidiumEnvironmentSource === source &&
    material._zoidiumEnvironmentLayer === layer
  ) {
    return;
  }

  releaseEnvironmentMap(material);
  try {
    material.threeObj.envMap = source.getTexture();
    material._zoidiumEnvironmentSource = source;
    material._zoidiumEnvironmentLayer = layer;
    material.threeObj.needsUpdate = true;
  } catch (error) {
    console.error("Material+ could not load a PBR environment map", error);
    releaseEnvironmentMap(material);
  }
}

function applyRenderSettings(material) {
  if (!material.threeObj) return;

  const transparent = getOptionValue(material.properties.transparent, 0) === 1;
  const blendingIndex = getOptionValue(material.properties.blending, 1);
  const sideIndex = getOptionValue(material.properties.side, 0);
  const alphaTest = Math.max(0, Math.min(1, getOptionValue(material.properties.alphaTest, 0)));

  const blendingValues = [
    state.THREE.NoBlending,
    state.THREE.NormalBlending,
    state.THREE.AdditiveBlending,
    state.THREE.SubtractiveBlending,
    state.THREE.MultiplyBlending,
  ];
  const sideValues = [
    state.THREE.FrontSide,
    state.THREE.BackSide,
    state.THREE.DoubleSide,
  ];

  const nextBlending = blendingValues[blendingIndex] ?? state.THREE.NormalBlending;
  const nextSide = sideValues[sideIndex] ?? state.THREE.FrontSide;
  const needsUpdate =
    material.threeObj.transparent !== transparent ||
    material.threeObj.blending !== nextBlending ||
    material.threeObj.side !== nextSide ||
    material.threeObj.alphaTest !== alphaTest;

  material.threeObj.transparent = transparent;
  material.threeObj.blending = nextBlending;
  material.threeObj.side = nextSide;
  material.threeObj.alphaTest = alphaTest;
  if (needsUpdate) material.threeObj.needsUpdate = true;
}

function trackMaterial(material, plugin) {
  plugin = plugin || {};
  state.PZ.zoidium?.trackPluginMaterial?.(
    material,
    {
      id: plugin.id || "material-plus",
      name: plugin.name || "Material+",
      version: String(plugin.version || "1"),
      author: plugin.author || "Zoidium",
      material: PBR_MATERIAL_ID,
      materialName: PBR_MATERIAL_NAME,
      compatibility: "incompatible",
    },
    false
  );
}

function createTextureProperty(name, slotName) {
  return {
    name,
    type: state.PZ.property.type.ASSET,
    assetType: state.PZ.asset.type.IMAGE,
    accept: "image/*",
    value: null,
    changed: function () {
      const material = this.parentObject;
      if (material?._zoidiumLoading) return;
      loadTextureSlot(material, material._zoidiumTextureSlots[slotName], this.value);
    },
  };
}

function createMaterialFactory(plugin) {
  const propertyDefinitions = {
    color: {
      dynamic: true,
      group: true,
      objects: [
        { dynamic: true, name: "Color.R", type: state.PZ.property.type.NUMBER, value: 1, min: 0, max: 1 },
        { dynamic: true, name: "Color.G", type: state.PZ.property.type.NUMBER, value: 1, min: 0, max: 1 },
        { dynamic: true, name: "Color.B", type: state.PZ.property.type.NUMBER, value: 1, min: 0, max: 1 },
      ],
      name: "Color",
      type: state.PZ.property.type.COLOR,
    },
    texture: createTextureProperty("Texture (Base color)", "baseColor"),
    emissive: {
      dynamic: true,
      group: true,
      objects: [
        { dynamic: true, name: "Emissive.R", type: state.PZ.property.type.NUMBER, value: 0, min: 0, max: 1 },
        { dynamic: true, name: "Emissive.G", type: state.PZ.property.type.NUMBER, value: 0, min: 0, max: 1 },
        { dynamic: true, name: "Emissive.B", type: state.PZ.property.type.NUMBER, value: 0, min: 0, max: 1 },
      ],
      name: "Emissive",
      type: state.PZ.property.type.COLOR,
    },
    emissiveIntensity: {
      dynamic: true,
      name: "Emissive intensity",
      type: state.PZ.property.type.NUMBER,
      value: 1,
      min: 0,
      step: 0.01,
      decimals: 3,
    },
    emissiveMap: createTextureProperty("Emissive map", "emissiveMap"),
    roughness: {
      dynamic: true,
      name: "Roughness",
      type: state.PZ.property.type.NUMBER,
      value: 0.5,
      min: 0,
      max: 1,
      step: 0.01,
    },
    roughnessMap: createTextureProperty("Roughness map", "roughnessMap"),
    metalness: {
      dynamic: true,
      name: "Metalness",
      type: state.PZ.property.type.NUMBER,
      value: 0,
      min: 0,
      max: 1,
      step: 0.01,
    },
    metalnessMap: createTextureProperty("Metalness map", "metalnessMap"),
    normalMap: createTextureProperty("Normal map", "normalMap"),
    normalScale: {
      dynamic: true,
      name: "Normal scale",
      type: state.PZ.property.type.NUMBER,
      value: 1,
      min: 0,
      step: 0.01,
      decimals: 3,
    },
    alphaMap: createTextureProperty("Alpha map", "alphaMap"),
    alphaTest: {
      name: "Alpha threshold",
      type: state.PZ.property.type.NUMBER,
      value: 0,
      min: 0,
      max: 1,
      step: 0.01,
      changed: function () {
        const material = this.parentObject;
        if (material?._zoidiumLoading) return;
        applyRenderSettings(material);
      },
    },
    reflection: {
      name: "Reflection",
      type: state.PZ.property.type.OPTION,
      value: 0,
      items: "off;on",
      changed: function () {
        const material = this.parentObject;
        if (material?._zoidiumLoading) return;
        syncEnvironmentMap(material);
      },
    },
    reflectionIntensity: {
      dynamic: true,
      name: "Reflection intensity",
      type: state.PZ.property.type.NUMBER,
      value: 1,
      min: 0,
      step: 0.01,
      decimals: 3,
    },
    transparent: {
      name: "Transparency",
      type: state.PZ.property.type.OPTION,
      value: 0,
      items: "off;on",
      changed: function () {
        const material = this.parentObject;
        if (material?._zoidiumLoading) return;
        applyRenderSettings(material);
      },
    },
    opacity: {
      dynamic: true,
      name: "Opacity",
      type: state.PZ.property.type.NUMBER,
      value: 1,
      min: 0,
      max: 1,
      step: 0.01,
    },
    blending: {
      name: "Blending",
      type: state.PZ.property.type.OPTION,
      value: 1,
      items: "none;normal;additive;subtractive;multiply",
      changed: function () {
        const material = this.parentObject;
        if (material?._zoidiumLoading) return;
        applyRenderSettings(material);
      },
    },
    side: {
      name: "Render side",
      type: state.PZ.property.type.OPTION,
      value: 0,
      items: "front;back;both",
      changed: function () {
        const material = this.parentObject;
        if (material?._zoidiumLoading) return;
        applyRenderSettings(material);
      },
    },
    wrap: {
      name: "Wrap",
      type: state.PZ.property.type.OPTION,
      value: 1,
      items: "none;tile;reflect",
      changed: function () {
        const material = this.parentObject;
        if (material?._zoidiumLoading) return;
        applyTextureSettings(material, true);
      },
    },
    repeat: {
      dynamic: true,
      group: true,
      objects: [
        { dynamic: true, name: "Repeat.U", type: state.PZ.property.type.NUMBER, step: 0.1, decimals: 3, value: 1 },
        { dynamic: true, name: "Repeat.V", type: state.PZ.property.type.NUMBER, step: 0.1, decimals: 3, value: 1 },
      ],
      name: "Repeat",
      type: state.PZ.property.type.VECTOR2,
      step: 0.1,
      decimals: 3,
      linkRatio: true,
    },
    offset: {
      dynamic: true,
      group: true,
      objects: [
        { dynamic: true, name: "Offset.U", type: state.PZ.property.type.NUMBER, step: 0.1, decimals: 3, value: 0 },
        { dynamic: true, name: "Offset.V", type: state.PZ.property.type.NUMBER, step: 0.1, decimals: 3, value: 0 },
      ],
      name: "Offset",
      type: state.PZ.property.type.VECTOR2,
      step: 0.1,
      decimals: 3,
    },
    center: {
      dynamic: true,
      group: true,
      objects: [
        { dynamic: true, name: "Center.U", type: state.PZ.property.type.NUMBER, step: 0.1, decimals: 3, value: 0 },
        { dynamic: true, name: "Center.V", type: state.PZ.property.type.NUMBER, step: 0.1, decimals: 3, value: 0 },
      ],
      name: "Center",
      type: state.PZ.property.type.VECTOR2,
      step: 0.1,
      decimals: 3,
    },
    rotation: {
      dynamic: true,
      name: "Rotation",
      type: state.PZ.property.type.NUMBER,
      value: 0,
      step: 0.5,
      scaleFactor: Math.PI / 180,
    },
  };

  return function () {
    const material = this;
    material.defaultName = PBR_MATERIAL_NAME;
    material._zoidiumLoading = true;
    material._zoidiumTextureSlots = {
      baseColor: { propertyName: "texture", materialProperty: "map", asset: null, image: null, texture: null, value: null, generation: 0 },
      emissiveMap: { propertyName: "emissiveMap", materialProperty: "emissiveMap", asset: null, image: null, texture: null, value: null, generation: 0 },
      roughnessMap: { propertyName: "roughnessMap", materialProperty: "roughnessMap", asset: null, image: null, texture: null, value: null, generation: 0 },
      metalnessMap: { propertyName: "metalnessMap", materialProperty: "metalnessMap", asset: null, image: null, texture: null, value: null, generation: 0 },
      normalMap: { propertyName: "normalMap", materialProperty: "normalMap", asset: null, image: null, texture: null, value: null, generation: 0 },
      alphaMap: { propertyName: "alphaMap", materialProperty: "alphaMap", asset: null, image: null, texture: null, value: null, generation: 0 },
    };
    material.properties.addAll(propertyDefinitions);
    material._zoidiumLoading = false;

    material.load = function (data) {
      material._zoidiumLoading = true;
      material.threeObj = new state.THREE.MeshStandardMaterial({
        color: 0xffffff,
        roughness: 0.5,
        metalness: 0,
        transparent: false,
        premultipliedAlpha: false,
      });
      try {
        material.properties.load(data && data.properties);
      } finally {
        material._zoidiumLoading = false;
      }
      loadAllTextureSlots(material);
      applyRenderSettings(material);
      syncEnvironmentMap(material);
      material.update(0);
      trackMaterial(material, plugin);
    };

    material.update = function (frame) {
      if (!material.threeObj) return;

      const color = readColor(material.properties.color, frame, [1, 1, 1]);
      const emissive = readColor(material.properties.emissive, frame, [0, 0, 0]);
      const roughness = Math.max(0, Math.min(1, readNumber(material.properties.roughness, frame, 0.5)));
      const metalness = Math.max(0, Math.min(1, readNumber(material.properties.metalness, frame, 0)));
      const emissiveIntensity = Math.max(0, readNumber(material.properties.emissiveIntensity, frame, 1));
      const normalScale = Math.max(0, readNumber(material.properties.normalScale, frame, 1));
      const reflectionIntensity = Math.max(0, readNumber(material.properties.reflectionIntensity, frame, 1));
      const opacity = Math.max(0, Math.min(1, readNumber(material.properties.opacity, frame, 1)));

      material.threeObj.color.setRGB(color[0], color[1], color[2]);
      material.threeObj.emissive.setRGB(emissive[0], emissive[1], emissive[2]);
      material.threeObj.emissiveIntensity = emissiveIntensity;
      material.threeObj.roughness = roughness;
      material.threeObj.metalness = metalness;
      material.threeObj.normalScale.set(normalScale, normalScale);
      material.threeObj.envMapIntensity = reflectionIntensity;
      material.threeObj.opacity = opacity;

      applyTextureSettings(material, false, frame);
      if (
        material._zoidiumEnvironmentLayer !== material.parentLayer ||
        material._zoidiumEnvironmentSource !== material.parentLayer?.envMap
      ) {
        syncEnvironmentMap(material);
      }
    };

    material.prepare = async function () {
      await Promise.all(
        textureSlots(material)
          .map((slot) => slot.image?.loading)
          .filter((loading) => loading && typeof loading.then === "function")
      );
    };

    material.toJSON = function () {
      return { type: material.type, properties: material.properties };
    };

    material.unload = function () {
      state.PZ.zoidium?.untrackPluginMaterial?.(material);
      releaseEnvironmentMap(material);
      for (const slot of textureSlots(material)) {
        slot.generation += 1;
        disposeTextureSlot(material, slot);
      }
      material.threeObj?.dispose?.();
      material.threeObj = null;
    };
  };
}

function activate(context) {
  if (state.active) return;

  const PZ = context.PZ || context.window?.PZ;
  const THREE = context.window?.THREE || (typeof globalThis !== "undefined" ? globalThis.THREE : null);
  if (!PZ?.material?.fnList || !PZ?.asset?.image || !THREE?.MeshStandardMaterial) {
    throw new Error("Material+ PBR+ Material requires the CM3 material, image, and Three.js APIs.");
  }

  state.active = true;
  state.PZ = PZ;
  state.THREE = THREE;
  state.plugin = context.plugin || {};
  state.hadPreviousFactory = Object.prototype.hasOwnProperty.call(
    PZ.material.fnList,
    PBR_MATERIAL_ID
  );
  state.previousFactory = PZ.material.fnList[PBR_MATERIAL_ID];
  state.factory = Promise.resolve(createMaterialFactory(state.plugin));
  state.factory._zoidiumMaterialMode = "native";
  PZ.material.fnList[PBR_MATERIAL_ID] = state.factory;
}

function deactivate() {
  if (!state.active) return;
  if (state.PZ?.material?.fnList?.[PBR_MATERIAL_ID] === state.factory) {
    if (state.hadPreviousFactory) {
      state.PZ.material.fnList[PBR_MATERIAL_ID] = state.previousFactory;
    } else {
      delete state.PZ.material.fnList[PBR_MATERIAL_ID];
    }
  }
  state.active = false;
  state.PZ = null;
  state.THREE = null;
  state.plugin = null;
  state.previousFactory = undefined;
  state.hadPreviousFactory = false;
  state.factory = null;
}

module.exports = { activate, deactivate };
