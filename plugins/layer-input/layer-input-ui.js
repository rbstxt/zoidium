"use strict";

// Layer Input editor integration: watches, stylesheet, track Loaded through the shared bundle loader; created per activation
// by the plugin entry with (state, deps), where deps carries the sibling
// parts once the entry has wired them.

const shared = require("./layer-input-state.js");
const state = shared.state;

module.exports = function createUi(state, deps) {
  function scheduleValidation(project) {
    if (!project || state.validationTimers.has(project)) return;
    const timer = state.window.setTimeout(() => {
      state.validationTimers.delete(project);
      deps.validateProject(project);
    }, 0);
    state.validationTimers.set(project, timer);
  }

  function trackChanged() {
    scheduleValidation(state.editor?.project);
  }

  function clearWatches(watches) {
    for (const [observable, callback] of watches.splice(0)) {
      try {
        observable.unwatch(callback);
      } catch (_error) {
        // Detached observables are harmless during project replacement.
      }
    }
  }

  function attachSequence(sequence) {
    if (state.sequence === sequence) return;
    clearWatches(state.sequenceWatches);
    state.sequence = sequence || null;
    if (!sequence?.ui) return;
    for (const name of [
      "onClipCreated",
      "onClipDeleted",
      "onClipMoved",
      "onTrackCreated",
      "onTrackDeleted",
      "onTrackMoved",
    ]) {
      const observable = sequence.ui[name];
      if (!observable?.watch) continue;
      observable.watch(trackChanged);
      state.sequenceWatches.push([observable, trackChanged]);
    }
    scheduleValidation(deps.getProject(sequence));
  }

  function installEditorWatches() {
    const editor = state.editor;
    if (!editor) return;
    const projectChanged = () => {
      attachSequence(editor.sequence || editor.project?.sequence);
      scheduleValidation(editor.project);
    };
    const sequenceChanged = () => {
      attachSequence(editor.sequence || editor.project?.sequence);
      scheduleValidation(editor.project);
    };
    for (const [observable, callback] of [
      [editor.onProjectChanged, projectChanged],
      [editor.onSequenceChanged, sequenceChanged],
    ]) {
      if (!observable?.watch) continue;
      observable.watch(callback);
      state.editorWatches.push([observable, callback]);
    }
    attachSequence(editor.sequence || editor.project?.sequence);
  }

  function installStyle() {
    const existing = state.document.getElementById("zoidium-layer-input-style");
    if (existing) {
      state.style = existing;
      return;
    }
    const style = state.document.createElement("style");
    style.id = "zoidium-layer-input-style";
    style.textContent = `
      .zoidium-layer-input-source {
        max-width: 240px;
        width: 200px;
      }
      .zoidium-layer-input-controls .zoidium-layer-input-source {
        max-width: 160px;
        width: 160px;
      }
      .zoidium-layer-input-source[data-error="cycle"],
      .zoidium-layer-input-source[data-error="missing"] {
        border-color: var(--zui-danger);
      }
      .zoidium-layer-input-mode {
        max-width: 150px;
        width: 150px;
      }
      .zoidium-layer-input-controls {
        align-items: center;
        display: flex;
        gap: 5px;
        max-width: 315px;
      }
    `;
    state.document.head.appendChild(style);
    state.style = style;
  }

  function installTrackIdentityPatch() {
    const prototype = state.PZ.track?.video?.prototype;
    if (!prototype || prototype.load === state.patchedTrackLoad) return;
    state.trackPrototype = prototype;
    const originalTrackLoad = state.originalTrackLoad = shared.unwrapInactivePatch(prototype.load);
    const originalTrackToJSON = state.originalTrackToJSON = shared.unwrapInactivePatch(prototype.toJSON);
    state.patchedTrackLoad = function () {
      const data = arguments[0];
      const result = originalTrackLoad.apply(this, arguments);
      deps.ensureTrackId(this, data?._zoidiumLayerInputId);
      scheduleValidation(this.parentProject);
      return result;
    };
    state.patchedTrackToJSON = function () {
      const result = originalTrackToJSON.apply(this, arguments);
      result._zoidiumLayerInputId = deps.ensureTrackId(this);
      return result;
    };
    state.patchedTrackLoad = shared.guardPatch(prototype, "load", state.patchedTrackLoad, originalTrackLoad);
    prototype.load = state.patchedTrackLoad;
    state.patchedTrackToJSON = shared.guardPatch(prototype, "toJSON", state.patchedTrackToJSON, originalTrackToJSON);
    prototype.toJSON = state.patchedTrackToJSON;
  }

  function createSourceInput(property) {
    const container = state.document.createElement("div");
    container.classList.add("editbox");
    const select = state.document.createElement("select");
    select.classList.add("pz-inputbox", "zoidium-layer-input-source");
    const sourceName = property.definition.name || "Source Layer";
    select.setAttribute("aria-label", `${sourceName} source track`);
    const isShaderLayerInput = Boolean(property.definition?._zoidiumShaderLayerSource);
    let modeSelect = null;
    if (isShaderLayerInput) {
      const controls = state.document.createElement("div");
      controls.classList.add("zoidium-layer-input-controls");
      modeSelect = state.document.createElement("select");
      modeSelect.classList.add("pz-inputbox", "zoidium-layer-input-mode");
      modeSelect.setAttribute("aria-label", `${sourceName} input mode`);
      controls.appendChild(select);
      controls.appendChild(modeSelect);
      container.appendChild(controls);
    } else {
      container.appendChild(select);
    }

    let signature = "";
    let modeSignature = "";
    function refresh(frame) {
      const consumer = property.parentObject;
      const options = deps.getSourceOptions(consumer, property);
      const nextSignature = options
        .map((option) => `${option.value}\u0000${option.label}\u0000${option.disabled}`)
        .join("\u0001");
      if (nextSignature !== signature && state.document.activeElement !== select) {
        signature = nextSignature;
        select.replaceChildren();
        for (const option of options) {
          const element = state.document.createElement("option");
          element.value = option.value;
          element.textContent = option.label;
          element.disabled = Boolean(option.disabled);
          select.appendChild(element);
        }
      }
      if (modeSelect) {
        const modeOptions = deps.getSourceModeOptions();
        const nextModeSignature = modeOptions
          .map((option) => `${option.value}\u0000${option.label}`)
          .join("\u0001");
        if (nextModeSignature !== modeSignature && state.document.activeElement !== modeSelect) {
          modeSignature = nextModeSignature;
          modeSelect.replaceChildren();
          for (const option of modeOptions) {
            const element = state.document.createElement("option");
            element.value = option.value;
            element.textContent = option.label;
            modeSelect.appendChild(element);
          }
        }
        const currentMode = deps.getSourceMode(consumer, property);
        if (state.document.activeElement !== modeSelect) modeSelect.value = currentMode;
        modeSelect.title = `Input mode: ${
          modeOptions.find((option) => option.value === currentMode)?.label || "Effects & Masks"
        }`;
      }
      const current = deps.getCurrentSourceToken(consumer, property) || property.get(frame) || "";
      if (state.document.activeElement !== select) select.value = current;
      const error = deps.getSourceError(consumer, property);
      select.dataset.error = error;
      select.title = deps.getSourceStatus(consumer, property) || "Select a source track";
    }

    select.onchange = function () {
      const consumer = property.parentObject;
      PZ.ui.controls.editStart.call(this, property);
      const frame = container.pz_frame;
      const value = select.value;
      property.set(value, frame);
      deps.setConsumerSource(consumer, value, { fromUser: true, sourceProperty: property });
      PZ.ui.controls.editFinish.call(this, property);
      refresh(frame);
    };
    if (modeSelect) {
      modeSelect.onchange = function () {
        const consumer = property.parentObject;
        const frame = container.pz_frame;
        const value = modeSelect.value;
        deps.setSourceMode(consumer, value, { sourceProperty: property });
        refresh(frame);
      };
    }
    container.pz_update = refresh;
    refresh(0);
    return container;
  }

  function installSourceInputPatch() {
    const controls = state.PZ.ui?.controls;
    if (!controls?.generateListInput) return;
    controls.generateListInput = shared.unwrapInactivePatch(controls.generateListInput);
    if (controls.generateListInput.__zoidiumLayerInput) return;
    const originalListInput = state.originalListInput = shared.unwrapInactivePatch(controls.generateListInput);
    state.patchedListInput = function (property) {
      if (property?.definition?._zoidiumLayerSource) return createSourceInput(property);
      return originalListInput.apply(this, arguments);
    };
    state.patchedListInput = shared.guardPatch(controls, "generateListInput", state.patchedListInput, originalListInput);
    state.patchedListInput.__zoidiumLayerInput = true;
    controls.generateListInput = state.patchedListInput;
  }

  return {
    attachSequence,
    clearWatches,
    createSourceInput,
    installEditorWatches,
    installSourceInputPatch,
    installStyle,
    installTrackIdentityPatch,
    scheduleValidation,
    trackChanged,
  };
};
