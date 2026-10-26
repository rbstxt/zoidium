"use strict";

// UV Custom Material mirrors CM3's native Custom Material, but lays out the
// UVs of 3D Text and extruded geometry with the shared Material+ layout
// (uv-layout.js) so a texture keeps one texel density on every face. CM3's
// native Custom Material is left completely untouched, so existing projects
// keep their original look.

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
  layout: null,
};

const UV_LAYOUT_SOURCE = "./plugins/material-plus/uv-layout.js";

// Materials that still hold a normalized geometry, so deactivate() can restore.
const activeMaterials = new Set();

function uvReadNumber(property, frame, fallback) {
  try {
    const value = property?.get?.(frame);
    return Number.isFinite(Number(value)) ? Number(value) : fallback;
  } catch (_error) {
    // Host dynamic properties can be unavailable before native load.
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
    } catch (error) {
      console.warn("[Zoidium] UV Custom: could not unload a texture asset", error);
    }
  }
}

function uvLoadTexture(material, key, property, value) {
  uvDisposeTexture(material, key, property);
  if (!value || !material.parentProject?.assets || !material.threeObj) return;
  material[key] = new uvCustomState.PZ.asset.image(material.parentProject.assets.load(value));
  const texture = material[key].getTexture(true);
  const wrap = uvOptionValue(material.properties.wrap, 1);
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
      uvCustomState.layout.ensureMaterial(material);
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
      uvCustomState.layout.ensureMaterial(material);
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
      uvCustomState.layout.releaseMaterial(material);
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

  uvCustomState.layout = new Function(context.getAsset("text", UV_LAYOUT_SOURCE))()();
  uvCustomState.active = true;
  uvCustomState.PZ = PZ;
  uvCustomState.THREE = THREE;
  uvCustomState.plugin = context.plugin || {};
  // Register cleanup before mutating the host so a failed or disabled
  // plugin always restores the previous material factory.
  context.lifecycle?.onDispose?.(deactivate);
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
  for (const material of Array.from(activeMaterials)) uvCustomState.layout.releaseMaterial(material);
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
  uvCustomState.layout = null;
}

module.exports = {
  UV_CUSTOM_MATERIAL_ID,
  UV_CUSTOM_MATERIAL_NAME,
  activate,
  deactivate,
};
