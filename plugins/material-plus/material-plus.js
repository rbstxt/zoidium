"use strict";

const MaterialPlus = (() => {
  const MATERIAL_ID = "matcap";
  const VERTEX_SHADER_SOURCE =
    "./plugins/material-plus/shaders/matcap.vert.glsl?v=1";
  const FRAGMENT_SHADER_SOURCE =
    "./plugins/material-plus/shaders/matcap.frag.glsl?v=1";

  const state = {
    active: false,
    PZ: null,
    THREE: null,
    plugin: null,
    previousFactory: undefined,
    hadPreviousFactory: false,
    factory: null,
  };

  function readNumber(property, frame, fallback) {
    try {
      const value = property?.get?.(frame);
      return Number.isFinite(Number(value)) ? Number(value) : fallback;
    } catch (_error) {
      return fallback;
    }
  }

  function readColor(property, frame) {
    try {
      const value = property?.get?.(frame);
      if (Array.isArray(value) && value.length >= 3) {
        return [Number(value[0]) || 0, Number(value[1]) || 0, Number(value[2]) || 0];
      }
    } catch (_error) {
      // Use the white fallback below when a property is unavailable.
    }
    return [1, 1, 1];
  }

  function getOptionValue(property, fallback) {
    const value = Number(property?.value);
    return Number.isFinite(value) ? value : fallback;
  }

  function disposeTexture(material, assetKey, uniformKey) {
    const asset = material[assetKey];
    const texture = material.threeObj?.uniforms?.[uniformKey]?.value;
    material[assetKey] = null;
    if (material.threeObj?.uniforms?.[uniformKey]) {
      material.threeObj.uniforms[uniformKey].value = null;
    }
    if (asset) {
      try {
        material.parentProject?.assets?.unload(asset);
      } catch (error) {
        console.error("Material+ could not unload a Matcap asset", error);
      }
    }
    texture?.dispose?.();
  }

  function loadMatcapTexture(material, value) {
    disposeTexture(material, "matcapAsset", "matcapTexture");
    if (!value || !material.parentProject?.assets || !material.threeObj) return;

    try {
      material.matcapAsset = new state.PZ.asset.image(
        material.parentProject.assets.load(value)
      );
      const texture = material.matcapAsset.getTexture(true);
      texture.wrapS = state.THREE.ClampToEdgeWrapping;
      texture.wrapT = state.THREE.ClampToEdgeWrapping;
      texture.needsUpdate = true;
      material.threeObj.uniforms.matcapTexture.value = texture;
      material.threeObj.uniforms.hasMatcap.value = 1;
      material.threeObj.needsUpdate = true;
    } catch (error) {
      console.error("Material+ could not load the Matcap texture", error);
      material.matcapAsset = null;
      material.threeObj.uniforms.matcapTexture.value = null;
      material.threeObj.uniforms.hasMatcap.value = 0;
    }
  }

  function applyRenderSettings(material) {
    if (!material.threeObj) return;

    const transparent = getOptionValue(material.properties.transparent, 0) === 1;
    const blendingIndex = getOptionValue(material.properties.blending, 1);
    const sideIndex = getOptionValue(material.properties.side, 0);

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

    material.threeObj.transparent = transparent;
    material.threeObj.blending = blendingValues[blendingIndex] ?? state.THREE.NormalBlending;
    material.threeObj.side = sideValues[sideIndex] ?? state.THREE.FrontSide;
    material.threeObj.needsUpdate = true;
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
        material: MATERIAL_ID,
        materialName: "Matcap Material",
        compatibility: "incompatible",
      },
      false
    );
  }

  function createMaterialFactory(vertexShader, fragmentShader, plugin) {
    const propertyDefinitions = {
      matcap: {
        name: "Matcap",
        type: state.PZ.property.type.ASSET,
        assetType: state.PZ.asset.type.IMAGE,
        accept: "image/*",
        value: null,
        changed: function () {
          const material = this.parentObject;
          if (material?._zoidiumLoading) return;
          loadMatcapTexture(material, this.value);
        },
      },
      color: {
        dynamic: true,
        group: true,
        objects: [
          {
            dynamic: true,
            name: "Color.R",
            type: state.PZ.property.type.NUMBER,
            value: 1,
            min: 0,
            max: 1,
          },
          {
            dynamic: true,
            name: "Color.G",
            type: state.PZ.property.type.NUMBER,
            value: 1,
            min: 0,
            max: 1,
          },
          {
            dynamic: true,
            name: "Color.B",
            type: state.PZ.property.type.NUMBER,
            value: 1,
            min: 0,
            max: 1,
          },
        ],
        name: "Color",
        type: state.PZ.property.type.COLOR,
      },
      brightness: {
        dynamic: true,
        name: "Brightness",
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
        changed: function () {
          const material = this.parentObject;
          if (material?._zoidiumLoading) return;
          applyRenderSettings(material);
        },
        items: "off;on",
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
        changed: function () {
          const material = this.parentObject;
          if (material?._zoidiumLoading) return;
          applyRenderSettings(material);
        },
        items: "none;normal;additive;subtractive;multiply",
      },
      side: {
        name: "Render side",
        type: state.PZ.property.type.OPTION,
        value: 0,
        changed: function () {
          const material = this.parentObject;
          if (material?._zoidiumLoading) return;
          applyRenderSettings(material);
        },
        items: "front;back;both",
      },
    };

    return function () {
      const material = this;
      material.defaultName = "Matcap Material";
      material.matcapAsset = null;
      material._zoidiumLoading = true;
      material.properties.addAll(propertyDefinitions);
      material._zoidiumLoading = false;

      material.load = function (data) {
        material._zoidiumLoading = true;
        material.threeObj = new state.THREE.ShaderMaterial({
          uniforms: {
            matcapTexture: { value: null },
            hasMatcap: { value: 0 },
            tint: { value: new state.THREE.Vector3(1, 1, 1) },
            brightness: { value: 1 },
            opacity: { value: 1 },
          },
          vertexShader,
          fragmentShader,
          transparent: false,
          premultipliedAlpha: false,
        });
        material.properties.load(data && data.properties);
        material._zoidiumLoading = false;
        loadMatcapTexture(material, material.properties.matcap?.value);
        applyRenderSettings(material);
        trackMaterial(material, plugin);
      };

      material.update = function (frame) {
        if (!material.threeObj) return;
        const color = readColor(material.properties.color, frame);
        const brightness = Math.max(
          0,
          readNumber(material.properties.brightness, frame, 1)
        );
        const opacity = Math.max(
          0,
          Math.min(1, readNumber(material.properties.opacity, frame, 1))
        );
        material.threeObj.uniforms.tint.value.set(color[0], color[1], color[2]);
        material.threeObj.uniforms.brightness.value = brightness;
        material.threeObj.uniforms.opacity.value = opacity;
        material.threeObj.opacity = opacity;
      };

      material.prepare = async function () {
        if (material.matcapAsset) await material.matcapAsset.loading;
      };

      material.toJSON = function () {
        return { type: material.type, properties: material.properties };
      };

      material.unload = function () {
        state.PZ.zoidium?.untrackPluginMaterial?.(material);
        disposeTexture(material, "matcapAsset", "matcapTexture");
        material.threeObj?.dispose?.();
        material.threeObj = null;
      };
    };
  }

  function activate(context) {
    if (state.active) return;

    const PZ = context.PZ || context.window?.PZ;
    const THREE_API =
      context.window?.THREE ||
      (typeof THREE !== "undefined" ? THREE : null);
    const getAsset = context.getAsset;
    const vertexShader = getAsset?.("text", VERTEX_SHADER_SOURCE);
    const fragmentShader = getAsset?.("text", FRAGMENT_SHADER_SOURCE);

    if (!PZ?.material?.fnList || !THREE_API?.ShaderMaterial) {
      throw new Error("Material+ requires the CM3 material and Three.js APIs.");
    }
    if (typeof vertexShader !== "string" || typeof fragmentShader !== "string") {
      throw new Error("Material+ could not load its bundled Matcap shaders.");
    }

    state.active = true;
    state.PZ = PZ;
    state.THREE = THREE_API;
    state.plugin = context.plugin || {};
    state.hadPreviousFactory = Object.prototype.hasOwnProperty.call(
      PZ.material.fnList,
      MATERIAL_ID
    );
    state.previousFactory = PZ.material.fnList[MATERIAL_ID];
    state.factory = Promise.resolve(
      createMaterialFactory(vertexShader, fragmentShader, state.plugin)
    );
    state.factory._zoidiumMaterialMode = "native";
    PZ.material.fnList[MATERIAL_ID] = state.factory;
  }

  function deactivate() {
    if (!state.active) return;
    if (state.PZ?.material?.fnList?.[MATERIAL_ID] === state.factory) {
      if (state.hadPreviousFactory) {
        state.PZ.material.fnList[MATERIAL_ID] = state.previousFactory;
      } else {
        delete state.PZ.material.fnList[MATERIAL_ID];
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

  return { activate, deactivate };
})();

module.exports = MaterialPlus;
