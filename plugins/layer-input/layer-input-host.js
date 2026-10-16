"use strict";

// Layer Input host patches: shader inputs, the Layer Source Loaded through the shared bundle loader; created per activation
// by the plugin entry with (state, deps), where deps carries the sibling
// parts once the entry has wired them.

const shared = require("./layer-input-state.js");
const state = shared.state;

module.exports = function createHost(state, deps) {
  function getShaderSourceProperties(shader) {
    return deps.getSourceProperties(shader).filter(
      (property) => property?.definition?._zoidiumShaderLayerSource
    );
  }

  function getShaderPropertyName(shader, property) {
    const name = property?.properties?.name?.get?.() || property?.definition?.name || "";
    return typeof shader?.fixPropertyName === "function"
      ? shader.fixPropertyName(String(name))
      : String(name).replace(/\s/g, "_");
  }

  function getShaderEmptyTexture() {
    if (!state.shaderEmptyTexture) {
      const texture = new THREE.DataTexture(
        new Uint8Array([0, 0, 0, 0]),
        1,
        1,
        THREE.RGBAFormat
      );
      texture.minFilter = THREE.LinearFilter;
      texture.magFilter = THREE.LinearFilter;
      texture.generateMipmaps = false;
      texture.needsUpdate = true;
      state.shaderEmptyTexture = texture;
    }
    return state.shaderEmptyTexture;
  }

  function patchShaderInputUniforms(shader) {
    if (!shader?.pass?.uniforms) return;
    for (const property of getShaderSourceProperties(shader)) {
      const name = getShaderPropertyName(shader, property);
      const uniform = shader.pass.uniforms[name] || { type: "t", value: null };
      uniform.type = "t";
      uniform.value = getShaderEmptyTexture();
      shader.pass.uniforms[name] = uniform;
    }
  }

  // The shader effect turns every static custom property into a
  // material.defines entry, which THREE emits as "#define <name> <value>". A
  // layer source property holds a track token (or an empty string), so the
  // injected define is never valid GLSL. Drop the define before the renderer
  // compiles the material; the uniform created above carries the texture.
  function clearShaderInputDefines(shader) {
    const defines = shader?.pass?.material?.defines;
    if (!defines) return;
    for (const property of getShaderSourceProperties(shader)) {
      const name = getShaderPropertyName(shader, property);
      if (Object.prototype.hasOwnProperty.call(defines, name)) delete defines[name];
    }
  }

  function updateShaderInputUniforms(shader, frame) {
    if (!shader?.pass?.uniforms) return;
    for (const property of getShaderSourceProperties(shader)) {
      const uniform = shader.pass.uniforms[getShaderPropertyName(shader, property)];
      if (!uniform) continue;
      const source = deps.resolveShaderSource(shader, property, frame);
      uniform.value = source?.texture || getShaderEmptyTexture();
    }
  }

  function removeShaderWatcher(shader) {
    const watcher = state.shaderWatchers.get(shader);
    if (!watcher) return;
    for (const [observable, callback] of watcher.watches) {
      try {
        observable.unwatch(callback);
      } catch (_error) {
        // Detached shader properties are harmless during project replacement.
      }
    }
    state.shaderWatchers.delete(shader);
  }

  function syncShaderConsumer(shader) {
    if (getShaderSourceProperties(shader).length > 0) deps.registerConsumer(shader);
    else deps.unregisterConsumer(shader);
  }

  function registerShaderInstance(shader) {
    if (!shader || state.shaderWatchers.has(shader)) {
      if (shader) syncShaderConsumer(shader);
      return;
    }
    const watches = [];
    const changed = (property) => {
      if (!property?.definition?._zoidiumShaderLayerSource) return;
      syncShaderConsumer(shader);
      deps.scheduleValidation(deps.getProject(shader) || state.editor?.project);
    };
    for (const observable of [
      shader.customProperties?.onObjectAdded,
      shader.customProperties?.onObjectRemoved,
    ]) {
      if (!observable?.watch) continue;
      observable.watch(changed);
      watches.push([observable, changed]);
    }
    if (watches.length > 0) state.shaderWatchers.set(shader, { watches });
    syncShaderConsumer(shader);
  }

  function installShaderPropertyType() {
    const propertyTypes = state.PZ.ui.objectTypes.get(state.PZ.property);
    if (!Array.isArray(propertyTypes)) return;
    state.propertyTypeList = propertyTypes;
    const existing = propertyTypes.find(
      (entry) => entry?.type?._zoidiumShaderLayerSource
    );
    if (existing) {
      state.propertyTypeEntry = existing;
      return;
    }
    const type = {
      custom: true,
      type: state.PZ.property.type.LIST,
      value: "",
      items: [{ name: "(No source)", value: "" }],
      _zoidiumLayerSource: true,
      _zoidiumShaderLayerSource: true,
      _zoidiumLayerInputMode: shared.DEFAULT_SOURCE_MODE,
      changed: function () {
        const shader = this.parentObject;
        if (shader?._zoidiumLoading) return;
        state.api?.setSource(shader, this.value || "", { sourceProperty: this });
      },
    };
    const entry = { name: "Layer Input", type };
    const dynamicIndex = propertyTypes.findIndex(
      (item) => item?.category && item.name === "DYNAMIC"
    );
    if (dynamicIndex >= 0) propertyTypes.splice(dynamicIndex, 0, entry);
    else propertyTypes.push(entry);
    state.propertyTypeEntry = entry;
    state.propertyTypeEntryAdded = true;
  }

  function installShaderPatches() {
    const prototype = state.PZ.effect?.shader?.prototype;
    if (!prototype || prototype.update === state.patchedShaderUpdate) return;
    state.shaderPrototype = prototype;
    const originalShaderLoad = state.originalShaderLoad = shared.unwrapInactivePatch(prototype.load);
    const originalShaderUpdate = state.originalShaderUpdate = shared.unwrapInactivePatch(prototype.update);
    const originalShaderUpdateFragmentShader = state.originalShaderUpdateFragmentShader = shared.unwrapInactivePatch(prototype.updateFragmentShader);
    const originalShaderUnload = state.originalShaderUnload = shared.unwrapInactivePatch(prototype.unload);
    const installation = state.installation;
    state.patchedShaderLoad = async function () {
      const result = await originalShaderLoad.apply(this, arguments);
      if (installation.active) registerShaderInstance(this);
      return result;
    };
    state.patchedShaderUpdateFragmentShader = function () {
      const result = originalShaderUpdateFragmentShader.apply(this, arguments);
      clearShaderInputDefines(this);
      patchShaderInputUniforms(this);
      return result;
    };
    state.patchedShaderUpdate = function (frame) {
      const result = originalShaderUpdate.apply(this, arguments);
      updateShaderInputUniforms(this, frame);
      return result;
    };
    state.patchedShaderUnload = function () {
      removeShaderWatcher(this);
      deps.unregisterConsumer(this);
      return originalShaderUnload.apply(this, arguments);
    };
    state.patchedShaderLoad = shared.guardPatch(prototype, "load", state.patchedShaderLoad, originalShaderLoad);
    prototype.load = state.patchedShaderLoad;
    state.patchedShaderUpdateFragmentShader = shared.guardPatch(prototype, "updateFragmentShader", state.patchedShaderUpdateFragmentShader, originalShaderUpdateFragmentShader);
    prototype.updateFragmentShader = state.patchedShaderUpdateFragmentShader;
    state.patchedShaderUpdate = shared.guardPatch(prototype, "update", state.patchedShaderUpdate, originalShaderUpdate);
    prototype.update = state.patchedShaderUpdate;
    state.patchedShaderUnload = shared.guardPatch(prototype, "unload", state.patchedShaderUnload, originalShaderUnload);
    prototype.unload = state.patchedShaderUnload;

    const project = state.editor?.project;
    project?.traverse?.((object) => {
      if (object instanceof state.PZ.effect.shader) registerShaderInstance(object);
    });
  }

  function createLayerSourceMaterialFactory() {
    const propertyDefinitions = {
      source: {
        name: "Source Layer",
        type: state.PZ.property.type.LIST,
        value: "",
        items: [{ name: "(No source)", value: "" }, { name: "Image", value: "image" }],
        _zoidiumLayerSource: true,
        changed: function () {
          const material = this.parentObject;
          if (material?._zoidiumLoading) return;
          state.api?.setSource(material, this.value || "");
        },
      },
      sourceImage: {
        name: "Source Image",
        type: state.PZ.property.type.ASSET,
        assetType: state.PZ.asset.type.IMAGE,
        value: null,
        accept: "image/*",
        changed: function () {
          state.PZ.layerInput?.loadSourceImage(this.parentObject, this.value);
        },
      },
      opacity: {
        dynamic: !0,
        name: "Opacity",
        type: state.PZ.property.type.NUMBER,
        value: 1,
        min: 0,
        max: 1,
        step: 0.1,
      },
    };

    return function () {
      const material = this;
      material.defaultName = "Layer Source";
      material.__zoidiumLayerInputMaterial = true;
      material._zoidiumLoading = true;
      material.properties.addAll(propertyDefinitions);
      material._zoidiumLoading = false;

      material.load = function (data) {
        material._zoidiumLoading = true;
        material.threeObj = new THREE.MeshBasicMaterial({
          color: 0xffffff,
          transparent: true,
          opacity: 0,
          side: THREE.DoubleSide,
        });
        material.properties.load(data && data.properties);
        material._zoidiumLoading = false;
        deps.registerConsumer(material);
        state.PZ.zoidium?.trackPluginMaterial?.(
          material,
          {
            id: "layer-input",
            name: "Layer Input",
            version: "1",
            author: "Zoidium",
            material: "layersource",
            materialName: "Layer Source",
            compatibility: "incompatible",
          },
          false
        );
      };
      material.update = function (frame) {
        if (!material.threeObj) return;
        const opacity = deps.readNumericProperty(material.properties.opacity, frame, 1);
        const source = deps.resolveMaterial(material, frame) || null;
        const texture = source?.texture || null;
        if (material.threeObj.map !== texture) {
          material.threeObj.map = texture;
          material.threeObj.needsUpdate = true;
        }
        material.threeObj.opacity = source ? opacity : 0;
      };
      material.prepare = async function () { await material._zoidiumSourceImage?.loading; };
      material.toJSON = function () {
        return state.api
          ? state.api.deps.serializeConsumer(material)
          : { type: material.type, properties: material.properties };
      };
      material.unload = function () {
        deps.unregisterConsumer(material);
        state.PZ.zoidium?.untrackPluginMaterial?.(material);
        material.threeObj?.dispose?.();
        material.threeObj = null;
      };
    };
  }

  function installLayerSourceMaterial() {
    if (!state.PZ.material?.fnList) return;
    state.materialFactory = Promise.resolve(createLayerSourceMaterialFactory());
    state.materialFactory._zoidiumMaterialMode = "native";
    state.PZ.material.fnList.layersource = state.materialFactory;
  }

  function installCompositorPatch() {
    const prototype = state.PZ.compositor?.prototype;
    if (
      !prototype ||
      typeof prototype.renderEffects !== "function" ||
      prototype.renderSequence === state.patchedRenderSequence
    ) {
      return;
    }
    state.compositorPrototype = prototype;
    const originalRenderSequence = state.originalRenderSequence = shared.unwrapInactivePatch(prototype.renderSequence);
    const originalRenderEffects = state.originalRenderEffects = shared.unwrapInactivePatch(prototype.renderEffects);
    state.patchedRenderSequence = function (frame) {
      const runtime = deps.getRuntime(this);
      runtime.cache.clear();
      runtime.inProgress.clear();
      const context = { root: this, compositor: this, frame, depth: 0 };
      deps.pushContext(context);
      try {
        return originalRenderSequence.apply(this, arguments);
      } finally {
        deps.popContext();
        runtime.cache.clear();
        runtime.inProgress.clear();
      }
    };
    state.patchedRenderSequence = shared.guardPatch(prototype, "renderSequence", state.patchedRenderSequence, originalRenderSequence);
    prototype.renderSequence = state.patchedRenderSequence;

    state.patchedRenderEffects = function (effects, width, height) {
      const mode = this.__zoidiumLayerInputMode;
      if (!mode || deps.normalizeSourceMode(mode) === shared.DEFAULT_SOURCE_MODE) {
        return originalRenderEffects.apply(this, arguments);
      }
      return deps.renderSelectedEffects(this, effects, width, height, deps.normalizeSourceMode(mode));
    };
    state.patchedRenderEffects = shared.guardPatch(prototype, "renderEffects", state.patchedRenderEffects, originalRenderEffects);
    prototype.renderEffects = state.patchedRenderEffects;

    const originalUnload = state.originalUnload = shared.unwrapInactivePatch(prototype.unload);
    state.patchedUnload = function () {
      disposeRuntime(this);
      const result = originalUnload.apply(this, arguments);
      disposeCompositorExtras(this);
      return result;
    };
    state.patchedUnload = shared.guardPatch(prototype, "unload", state.patchedUnload, originalUnload);
    prototype.unload = state.patchedUnload;
  }

  function installViewportPatch() {
    const prototype = state.PZ.ui?.viewport?.prototype;
    if (!prototype || prototype._render === state.patchedViewportRender) return;
    state.viewportPrototype = prototype;
    const originalViewportRender = state.originalViewportRender = shared.unwrapInactivePatch(prototype._render);
    state.patchedViewportRender = function () {
      if (!this.renderMode || !this.compositor) {
        return originalViewportRender.apply(this, arguments);
      }
      const runtime = deps.getRuntime(this.compositor);
      runtime.cache.clear();
      runtime.inProgress.clear();
      const frame = this.editor?.playback?.currentFrame || 0;
      const context = { root: this.compositor, compositor: this.compositor, frame, depth: 0 };
      deps.pushContext(context);
      try {
        return originalViewportRender.apply(this, arguments);
      } finally {
        deps.popContext();
      }
    };
    state.patchedViewportRender = shared.guardPatch(prototype, "_render", state.patchedViewportRender, originalViewportRender);
    prototype._render = state.patchedViewportRender;
  }

  function disposeCompositorExtras(compositor) {
    if (compositor?.accumBuffers) {
      for (const target of compositor.accumBuffers) target?.dispose?.();
    }
    if (compositor?.canvasTexture) {
      compositor.canvasTexture.dispose?.();
      compositor.canvasTexture = null;
    }
  }

  function disposeRuntime(root) {
    const runtime = root?.__zoidiumLayerInputRuntime;
    if (!runtime) return;
    for (const target of runtime.targetPool.values()) target?.dispose?.();
    for (const capture of runtime.captures) {
      if (!capture) continue;
      state.originalUnload?.call(capture);
      disposeCompositorExtras(capture);
    }
    runtime.copyPass?.material?.dispose?.();
    runtime.cache.clear();
    runtime.inProgress.clear();
    runtime.targetPool.clear();
    runtime.captures.length = 0;
    runtime.copyPass = null;
    state.runtimes.delete(root);
    try {
      delete root.__zoidiumLayerInputRuntime;
    } catch (_error) {
      // Non-configurable host property: nulling still drops the reference.
      root.__zoidiumLayerInputRuntime = null;
    }
  }

  function restorePatches() {
    if (state.compositorPrototype?.renderSequence === state.patchedRenderSequence) {
      state.compositorPrototype.renderSequence = state.originalRenderSequence;
    }
    if (state.compositorPrototype?.renderEffects === state.patchedRenderEffects) {
      state.compositorPrototype.renderEffects = state.originalRenderEffects;
    }
    if (state.compositorPrototype?.unload === state.patchedUnload) {
      state.compositorPrototype.unload = state.originalUnload;
    }
    if (state.viewportPrototype?._render === state.patchedViewportRender) {
      state.viewportPrototype._render = state.originalViewportRender;
    }
    if (state.PZ.ui?.controls?.generateListInput === state.patchedListInput) {
      state.PZ.ui.controls.generateListInput = state.originalListInput;
    }
    if (state.trackPrototype?.load === state.patchedTrackLoad) {
      state.trackPrototype.load = state.originalTrackLoad;
    }
    if (state.trackPrototype?.toJSON === state.patchedTrackToJSON) {
      state.trackPrototype.toJSON = state.originalTrackToJSON;
    }
    for (const shader of Array.from(state.shaderWatchers.keys())) removeShaderWatcher(shader);
    if (state.shaderPrototype?.load === state.patchedShaderLoad) {
      state.shaderPrototype.load = state.originalShaderLoad;
    }
    if (state.shaderPrototype?.update === state.patchedShaderUpdate) {
      state.shaderPrototype.update = state.originalShaderUpdate;
    }
    if (state.shaderPrototype?.updateFragmentShader === state.patchedShaderUpdateFragmentShader) {
      state.shaderPrototype.updateFragmentShader = state.originalShaderUpdateFragmentShader;
    }
    if (state.shaderPrototype?.unload === state.patchedShaderUnload) {
      state.shaderPrototype.unload = state.originalShaderUnload;
    }
    if (state.propertyTypeEntryAdded && state.propertyTypeList && state.propertyTypeEntry) {
      const index = state.propertyTypeList.indexOf(state.propertyTypeEntry);
      if (index >= 0) state.propertyTypeList.splice(index, 1);
    }
    state.compositorPrototype = null;
    state.originalRenderSequence = null;
    state.patchedRenderSequence = null;
    state.originalRenderEffects = null;
    state.patchedRenderEffects = null;
    state.originalUnload = null;
    state.patchedUnload = null;
    state.viewportPrototype = null;
    state.originalViewportRender = null;
    state.patchedViewportRender = null;
    state.originalListInput = null;
    state.patchedListInput = null;
    state.trackPrototype = null;
    state.originalTrackLoad = null;
    state.patchedTrackLoad = null;
    state.originalTrackToJSON = null;
    state.patchedTrackToJSON = null;
    state.shaderPrototype = null;
    state.originalShaderLoad = null;
    state.patchedShaderLoad = null;
    state.originalShaderUpdate = null;
    state.patchedShaderUpdate = null;
    state.originalShaderUpdateFragmentShader = null;
    state.patchedShaderUpdateFragmentShader = null;
    state.originalShaderUnload = null;
    state.patchedShaderUnload = null;
    state.propertyTypeList = null;
    state.propertyTypeEntry = null;
    state.propertyTypeEntryAdded = false;
  }

  function disposeAllRuntimes() {
    for (const root of Array.from(state.runtimes)) disposeRuntime(root);
  }

  return {
    clearShaderInputDefines,
    createLayerSourceMaterialFactory,
    disposeAllRuntimes,
    disposeCompositorExtras,
    disposeRuntime,
    getShaderEmptyTexture,
    getShaderPropertyName,
    getShaderSourceProperties,
    installCompositorPatch,
    installLayerSourceMaterial,
    installShaderPatches,
    installShaderPropertyType,
    installViewportPatch,
    patchShaderInputUniforms,
    registerShaderInstance,
    removeShaderWatcher,
    restorePatches,
    syncShaderConsumer,
    updateShaderInputUniforms,
  };
};
