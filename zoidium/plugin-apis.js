// Zoidium Plugin APIs — shared helpers behind the five plugin kinds.
//
// Kinds (see plugins/manifest.schema.json and docs/plugin-api.md):
//   shader-pack   — declarative GLSL effects + groups (no JavaScript)
//   native-fx     — multipass effects incl. time operations (filter / temporal)
//   object        — 3D shapes and containers (primitive / container)
//   material-pack — 3D materials
//   extension     — anything else, including panels (module activate/deactivate)
//   core          — hidden built-in extensions (see plugins/core/)
//
// This file is loaded before plugins/plugin-manager.js (see
// zoidium/runtime-config.js) so native-effect sources and modules can use
// it as a plain browser global. Modules also receive it as context.apis.
(function (global) {
  "use strict";

  var KINDS = Object.freeze({
    SHADER_PACK: "shader-pack",
    NATIVE_FX: "native-fx",
    OBJECT: "object",
    MATERIAL_PACK: "material-pack",
    EXTENSION: "extension",
    CORE: "core",
  });

  function isObject(value) {
    return !!value && typeof value === "object" && !Array.isArray(value);
  }

  // Install the no-op lifecycle methods every native effect needs so filter
  // and temporal authors only describe what is unique to their effect.
  // Defaults always win over inherited host methods: CM3 hands each factory
  // a real PZ.effect instance whose prototype already defines load and friends,
  // so missing is never true. Keeping the host load recurses forever and hangs.
  function installLifecycleDefaults(effect, overrides) {
    var methods = overrides || {};
    if (typeof methods.load === "function") effect.load = methods.load;
    else {
      effect.load = function load(data) {
        if (effect.properties && typeof effect.properties.load === "function") {
          effect.properties.load(data && data.properties);
        }
      };
    }
    if (typeof methods.update === "function") effect.update = methods.update;
    else effect.update = function update() {};
    if (typeof methods.prepare === "function") effect.prepare = methods.prepare;
    else {
      effect.prepare = async function prepare() {};
    }
    if (typeof methods.resize === "function") effect.resize = methods.resize;
    else effect.resize = function resize() {};
    if (typeof methods.unload === "function") effect.unload = methods.unload;
    else effect.unload = function unload() {};
    if (typeof methods.toJSON === "function") effect.toJSON = methods.toJSON;
    else {
      effect.toJSON = function toJSON() {
        return { type: effect.type, properties: effect.properties };
      };
    }
  }

  // Temporal effect: a deterministic time operator (offset / posterize).
  // The host (plugins/core/temporal-render.js) reads effect._zoidiumTemporal
  // and rewrites which frame is evaluated. Authors never touch frames.
  // spec: { kind, displayName, properties, getOperator(effect, frame) }
  function defineTemporal(spec) {
    var effect = this;
    if (!isObject(spec) || (spec.kind !== "time-offset" && spec.kind !== "posterize-time")) {
      throw new Error("ZoidiumPluginApis.defineTemporal requires kind time-offset or posterize-time");
    }
    if (!isObject(spec.properties)) {
      throw new Error("ZoidiumPluginApis.defineTemporal requires a properties object");
    }
    if (typeof spec.getOperator !== "function") {
      throw new Error("ZoidiumPluginApis.defineTemporal requires getOperator(effect, frame)");
    }
    if (typeof spec.displayName === "string" && spec.displayName) {
      effect.defaultName = spec.displayName;
    }
    effect._zoidiumTemporal = { kind: spec.kind, getOperator: spec.getOperator };
    var PZ = global.PZ;
    if (!PZ || !effect.properties || typeof effect.properties.addAll !== "function") {
      throw new Error("ZoidiumPluginApis.defineTemporal needs a CM3 effect instance (this)");
    }
    effect.properties.addAll(spec.properties);
    installLifecycleDefaults(effect, spec.lifecycle);
    return effect;
  }

  // Single-pass shader filter: the common native-fx shape (one fragment
  // shader, one THREE ShaderPass, per-frame uniform updates).
  // spec: { displayName, properties, fragShaderUrl, fragShader,
  //         uniforms, defines, update(frame), resize(), onLoad(asset) }
  function defineFilter(spec) {
    var effect = this;
    if (!isObject(spec) || !isObject(spec.properties)) {
      throw new Error("ZoidiumPluginApis.defineFilter requires a properties object");
    }
    if (typeof spec.fragShaderUrl !== "string" && typeof spec.fragShader !== "string") {
      throw new Error("ZoidiumPluginApis.defineFilter requires fragShaderUrl or fragShader");
    }
    var PZ = global.PZ;
    var THREE = global.THREE;
    if (!PZ || !THREE) {
      throw new Error("ZoidiumPluginApis.defineFilter needs PZ and THREE globals");
    }
    if (typeof spec.displayName === "string" && spec.displayName) {
      effect.defaultName = spec.displayName;
    }
    effect.shaderUrl = spec.fragShaderUrl || effect.shaderUrl;
    effect.propertyDefinitions = spec.properties;
    effect.properties.addAll(spec.properties, effect);

    effect.load = async function load(data) {
      effect.vertShader = effect.parentProject.assets.createFromPreset(
        PZ.asset.type.SHADER,
        "/assets/shaders/vertex/common.glsl"
      );
      effect.vertShader = new PZ.asset.shader(
        effect.parentProject.assets.load(effect.vertShader)
      );
      var bundled =
        typeof effect.shaderUrl === "string" && effect._zoidiumGetAsset
          ? effect._zoidiumGetAsset("text", effect.shaderUrl)
          : undefined;
      if (typeof bundled === "string") {
        effect._zoidiumBundledFragShader = true;
        effect.fragShader = { getShader: async function () { return bundled; } };
      } else if (typeof spec.fragShader === "string") {
        effect._zoidiumBundledFragShader = true;
        effect.fragShader = { getShader: async function () { return spec.fragShader; } };
      } else {
        effect._zoidiumBundledFragShader = false;
        var preset = effect.parentProject.assets.createFromPreset(
          PZ.asset.type.SHADER,
          effect.shaderUrl
        );
        effect.fragShader = new PZ.asset.shader(
          effect.parentProject.assets.load(preset)
        );
      }
      var uniforms = { tDiffuse: { type: "t", value: null } };
      Object.keys(spec.uniforms || {}).forEach(function (name) {
        var definition = spec.uniforms[name] || {};
        uniforms[name] = {
          type: definition.type || "f",
          value: cloneUniformValue(definition.value),
        };
      });
      var material = new THREE.ShaderMaterial({
        uniforms: uniforms,
        vertexShader: await effect.vertShader.getShader(),
        fragmentShader: await effect.fragShader.getShader(),
      });
      material.premultipliedAlpha = true;
      Object.keys(spec.defines || {}).forEach(function (name) {
        material.defines[name] = spec.defines[name];
      });
      effect.pass = new THREE.ShaderPass(material);
      if (typeof spec.onLoad === "function") await spec.onLoad(effect);
      effect.properties.load(data && data.properties);
    };

    effect.toJSON = function toJSON() {
      return { type: effect.type, properties: effect.properties };
    };

    effect.unload = function unload() {
      if (effect.vertShader) effect.parentProject.assets.unload(effect.vertShader);
      if (!effect._zoidiumBundledFragShader && effect.fragShader) {
        effect.parentProject.assets.unload(effect.fragShader);
      }
    };

    effect.update = function update(frame) {
      if (!effect.pass) return;
      if (typeof spec.update === "function") {
        spec.update.call(effect, frame, effect.pass.uniforms);
        return;
      }
      var enabled = effect.properties.enabled && effect.properties.enabled.get(frame);
      if (typeof enabled !== "undefined") effect.pass.enabled = enabled;
    };

    effect.resize = function resize() {
      if (typeof spec.resize === "function") {
        spec.resize.call(effect);
        return;
      }
      try {
        var resolution = effect.parentLayer.properties.resolution.get();
        if (effect.pass && effect.pass.uniforms.resolution) {
          effect.pass.uniforms.resolution.value.set(resolution[0], resolution[1]);
        }
      } catch (_error) {
        // Resolution is unavailable while the layer is detached.
      }
    };

    return effect;
  }

  function cloneUniformValue(value) {
    if (Array.isArray(value)) return value.slice();
    // Only plain option bags are copied. Class instances such as
    // THREE.Vector2 are passed through so their methods survive.
    if (isObject(value)) {
      var proto = Object.getPrototypeOf(value);
      if (proto === Object.prototype || proto === null) return Object.assign({}, value);
    }
    return value;
  }

  // Object helpers: numeric/option properties that flag procedural geometry
  // dirty, plus the flat/smooth shading switch used by primitive shapes.
  function numberValue(value, fallback) {
    var number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function integerValue(value, fallback, minimum) {
    return Math.max(minimum, Math.round(numberValue(value, fallback)));
  }

  function vectorValue(value, fallback) {
    if (!Array.isArray(value)) return fallback.slice();
    return [
      numberValue(value[0], fallback[0]),
      numberValue(value[1], fallback[1]),
      numberValue(value[2], fallback[2]),
    ];
  }

  function markGeometryDirty() {
    if (this && this.parentObject) {
      this.parentObject.geometryNeedsUpdate = true;
      this.parentObject._geometrySignature = undefined;
    }
  }

  function objectProperty(PZ, definition) {
    return PZ.property.create(
      Object.assign({}, definition, { dynamic: true, changed: markGeometryDirty })
    );
  }

  function applyShading(geometry, shading) {
    if (!geometry) return geometry;
    if (integerValue(shading, 0, 0) === 0) {
      if (typeof geometry.computeFlatVertexNormals === "function") {
        geometry.computeFlatVertexNormals();
      } else if (typeof geometry.computeFaceNormals === "function") {
        geometry.computeFaceNormals();
      }
    } else if (typeof geometry.computeVertexNormals === "function") {
      geometry.computeVertexNormals();
    }
    return geometry;
  }

  // Material helpers: safe texture disposal shared by material authors.
  function disposeMaterialTexture(material, assetKey, uniformKey) {
    var asset = material ? material[assetKey] : null;
    var uniform = material && material.threeObj && material.threeObj.uniforms
      ? material.threeObj.uniforms[uniformKey]
      : null;
    if (material) material[assetKey] = null;
    if (uniform) uniform.value = null;
    var texture = uniform ? uniform.value : null;
    if (asset && material.parentProject && material.parentProject.assets) {
      try {
        material.parentProject.assets.unload(asset);
      } catch (error) {
        if (global.console && global.console.error) {
          global.console.error("ZoidiumPluginApis could not unload a material asset", error);
        }
      }
    }
    if (texture && typeof texture.dispose === "function") texture.dispose();
  }

  var apis = {
    KINDS: KINDS,
    defineTemporal: defineTemporal,
    defineFilter: defineFilter,
    installLifecycleDefaults: installLifecycleDefaults,
    objects: {
      numberValue: numberValue,
      integerValue: integerValue,
      vectorValue: vectorValue,
      markGeometryDirty: markGeometryDirty,
      property: objectProperty,
      applyShading: applyShading,
    },
    materials: {
      disposeTexture: disposeMaterialTexture,
    },
  };

  global.ZoidiumPluginApis = apis;
  try {
    if (global.PZ && global.PZ.zoidium && typeof global.PZ.zoidium.define === "function") {
      global.PZ.zoidium.define("pluginApis", apis, "zoidium/plugin-apis");
    }
  } catch (_error) {
    // Diagnostics must never prevent the API layer from loading.
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
