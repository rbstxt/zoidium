"use strict";

// Layer Input: composites a selected video track into the current layer,
// as a native effect, a displacement map, and a 3D material source.
//
// The implementation lives in sibling bundle files loaded through the shared
// module loader; this entry only owns activation. Split along seams:
// layer-input-state.js (constants and plugin state), layer-input-sources.js
// (track identity and the source model), layer-input-render.js (runtimes and
// capture compositors), layer-input-ui.js (editor watches and inputs), and
// layer-input-host.js (shader inputs, material and render patches).

const PART_ROOT = "./plugins/layer-input/";
const PART_FILES = {
  state: "./layer-input-state.js",
  sources: "./layer-input-sources.js",
  render: "./layer-input-render.js",
  ui: "./layer-input-ui.js",
  host: "./layer-input-host.js",
};

const LayerInput = (() => {
  let runtime = null;

  function loadParts(context) {
    const getAsset =
      context && typeof context.getAsset === "function" ? context.getAsset : null;
    const modules =
      (context && context.apis && context.apis.modules) ||
      (typeof ZoidiumPluginApis !== "undefined" ? ZoidiumPluginApis.modules : null);
    if (getAsset && modules && typeof modules.createRequire === "function") {
      const require = modules.createRequire(getAsset, { root: PART_ROOT });
      return {
        shared: require(PART_FILES.state),
        sourcesFactory: require(PART_FILES.sources),
        renderFactory: require(PART_FILES.render),
        uiFactory: require(PART_FILES.ui),
        hostFactory: require(PART_FILES.host),
      };
    }
    if (typeof require === "function") {
      return {
        shared: require(PART_FILES.state),
        sourcesFactory: require(PART_FILES.sources),
        renderFactory: require(PART_FILES.render),
        uiFactory: require(PART_FILES.ui),
        hostFactory: require(PART_FILES.host),
      };
    }
    throw new Error("Layer Input needs the plugin bundle asset resolver.");
  }

  function ensureRuntime(context) {
    if (runtime) return runtime;
    const loaded = loadParts(context);
    const state = loaded.shared.state;
    const deps = {};
    const sources = loaded.sourcesFactory(state, deps);
    const render = loaded.renderFactory(state, deps);
    const ui = loaded.uiFactory(state, deps);
    const host = loaded.hostFactory(state, deps);
    Object.assign(deps, sources, render, ui, host);
    runtime = { shared: loaded.shared, state, deps };
    return runtime;
  }

  function isInUse() {
    if (!runtime) return false;
    const { state, deps } = runtime;
    if (!state.active) return false;
    return Array.from(state.consumers).some(
      (consumer) => deps.getProject(consumer) === state.editor?.project
    );
  }

  function activate(context) {
    const { state, deps } = ensureRuntime(context);
    if (state.active) return state.api;
    state.active = true;
    const installation = state.installation = { active: true };
    context.lifecycle?.onDispose(() => {
      if (state.installation === installation) deactivate();
    });
    state.editor = context.editor;
    state.PZ = context.PZ || context.window?.PZ || window.PZ;
    state.document = context.document || document;
    state.window = context.window || window;
    state.api = {
      registerConsumer: deps.registerConsumer,
      loadSourceImage: deps.loadSourceImage,
      unregisterConsumer: deps.unregisterConsumer,
      setSource: deps.setConsumerSource,
      getSourceOptions: deps.getSourceOptions,
      getSourceStatus: deps.getSourceStatus,
      getSourceToken: deps.getCurrentSourceToken,
      getSourceMode: deps.getSourceMode,
      setSourceMode: deps.setSourceMode,
      getSourceModeOptions: deps.getSourceModeOptions,
      resolveEffect: deps.resolveConsumer,
      resolveMaterial: deps.resolveMaterial,
      serializeConsumer: deps.serializeConsumer,
      validateProject: deps.validateProject,
      isInUse,
    };
    state.PZ.layerInput = state.api;
    deps.installStyle();
    deps.installTrackIdentityPatch();
    deps.installSourceInputPatch();
    deps.installShaderPropertyType();
    deps.installShaderPatches();
    deps.installLayerSourceMaterial();
    deps.installCompositorPatch();
    deps.installViewportPatch();
    deps.installEditorWatches();
    return state.api;
  }

  function deactivate() {
    if (!runtime) return;
    const { state, deps } = runtime;
    if (!state.active) return;
    state.active = false;
    state.installation.active = false;
    deps.clearWatches(state.editorWatches);
    deps.clearWatches(state.sequenceWatches);
    for (const timer of state.validationTimers.values()) state.window.clearTimeout(timer);
    state.validationTimers.clear();
    deps.disposeAllRuntimes();
    deps.restorePatches();
    state.shaderEmptyTexture?.dispose?.();
    state.shaderEmptyTexture = null;
    state.style?.remove();
    for (const consumer of state.consumers) {
      if (consumer?.__zoidiumLayerInputMaterial) {
        state.PZ.zoidium?.untrackPluginMaterial?.(consumer);
      }
    }
    if (state.PZ?.layerInput === state.api) delete state.PZ.layerInput;
    state.consumers.clear();
    state.contextStack.length = 0;
    state.sequence = null;
    state.api = null;
    state.materialFactory = null;
    state.editor = null;
    state.PZ = null;
    state.document = null;
    state.window = null;
    state.style = null;
  }

  return { activate, deactivate, isInUse };
})();

module.exports = LayerInput;
