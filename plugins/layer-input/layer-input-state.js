"use strict";

// Layer Input shared constants and plugin state. Required by every other
// part of this plugin; the entry passes `state` into each factory while the
// module-level singletons below travel through `shared`.

  const MAX_SOURCE_DEPTH = 32;
  const SOURCE_PREFIX = "track:";
  const SOURCE_ID_PREFIX = "track:id:";
  const DEFAULT_SOURCE_MODE = "effects-masks";
  const SOURCE_MODE_OPTIONS = Object.freeze([
    { value: "source", label: "Source" },
    { value: "masks", label: "Masks" },
    { value: DEFAULT_SOURCE_MODE, label: "Effects & Masks" },
  ]);
  const SOURCE_MODE_VALUES = new Set(SOURCE_MODE_OPTIONS.map((option) => option.value));
  const state = {
    active: false,
    installation: null,
    editor: null,
    PZ: null,
    document: null,
    window: null,
    compositorPrototype: null,
    originalRenderSequence: null,
    patchedRenderSequence: null,
    originalRenderEffects: null,
    patchedRenderEffects: null,
    originalUnload: null,
    patchedUnload: null,
    originalListInput: null,
    patchedListInput: null,
    trackPrototype: null,
    originalTrackLoad: null,
    patchedTrackLoad: null,
    originalTrackToJSON: null,
    patchedTrackToJSON: null,
    viewportPrototype: null,
    originalViewportRender: null,
    patchedViewportRender: null,
    shaderPrototype: null,
    originalShaderLoad: null,
    patchedShaderLoad: null,
    originalShaderUpdate: null,
    patchedShaderUpdate: null,
    originalShaderUpdateFragmentShader: null,
    patchedShaderUpdateFragmentShader: null,
    originalShaderUnload: null,
    patchedShaderUnload: null,
    shaderWatchers: new Map(),
    shaderEmptyTexture: null,
    propertyTypeList: null,
    propertyTypeEntry: null,
    propertyTypeEntryAdded: false,
    style: null,
    contextStack: [],
    consumers: new Set(),
    runtimes: new Set(),
    sequence: null,
    editorWatches: [],
    sequenceWatches: [],
    validationTimers: new Map(),
    trackIds: new WeakMap(),
    nextTrackId: 1,
    materialFactory: null,
    api: null,
  };

  // Other plugins may retain our wrapper after an out-of-order disable.
  // Each installation owns its callback and cannot become active again.
  const PATCH = Symbol.for("zoidium.inactivePatch");

  function unwrapInactivePatch(callback) {
    while (callback?.[PATCH] && !callback[PATCH].installation.active) {
      callback = callback[PATCH].original;
    }
    return callback;
  }

  function guardPatch(target, key, handler, original) {
    const installation = state.installation;
    const wrapper = function () {
      if (!installation.active) {
        const callback = unwrapInactivePatch(original);
        if (target[key] === wrapper) target[key] = callback;
        return callback.apply(this, arguments);
      }
      return handler.apply(this, arguments);
    };
    wrapper[PATCH] = { installation, original };
    return wrapper;
  }

module.exports = {
  state,
  MAX_SOURCE_DEPTH,
  SOURCE_PREFIX,
  SOURCE_ID_PREFIX,
  DEFAULT_SOURCE_MODE,
  SOURCE_MODE_OPTIONS,
  SOURCE_MODE_VALUES,
  PATCH,
  unwrapInactivePatch,
  guardPatch,
};
