"use strict";

// Easing+ curve editor: a floating Bezier editor for keyframe easing plus
// shape-preserving keyframe moves and "Ez+" button labels.
//
// The implementation lives in sibling bundle files loaded through the shared
// module loader; this entry only owns the plugin state, the stylesheet and
// the two top-level host patches. Every host mutation registers its undo
// with context.lifecycle.onDispose before it happens, so a failed activation
// rolls back fully (see docs/plugin-api.md).

const STYLE_ID = "zoidium-easing-plus-style";
const STYLE_URL = "./plugins/easing-plus/easing-plus.css?v=21";
const PART_ROOT = "./plugins/easing-plus/";
const PART_FILES = {
  curves: "./easing-curves.js",
  host: "./easing-host.js",
  dialog: "./easing-dialog.js",
};

const EasingPlus = (() => {
  const state = {
    active: false,
    dialog: null,
    editor: null,
    originalEaseDropDown: null,
    patchedEaseDropDown: null,
    originalCorrectCurve: null,
    patchedCorrectCurve: null,
    ui: null,
    easeButtons: new Set(),
    displayRows: new Set(),
    originalCreateKeyframeControls: null,
    patchedCreateKeyframeControls: null,
    originalMoveKeyframe: null,
    patchedMoveKeyframe: null,
    originalSetValue: null,
    patchedSetValue: null,
    originalStartMove: null,
    patchedStartMove: null,
    originalFinishMove: null,
    patchedFinishMove: null,
    originalScaleKeyframes: null,
    patchedScaleKeyframes: null,
    pendingDragShapes: new Map(),
    getAsset: null,
    parts: null,
  };

  function loadParts(context) {
    const getAsset =
      context && typeof context.getAsset === "function" ? context.getAsset : null;
    const modules =
      (context && context.apis && context.apis.modules) ||
      (typeof ZoidiumPluginApis !== "undefined" ? ZoidiumPluginApis.modules : null);
    if (getAsset && modules && typeof modules.createRequire === "function") {
      const require = modules.createRequire(getAsset, { root: PART_ROOT });
      return {
        curves: require(PART_FILES.curves),
        hostFactory: require(PART_FILES.host),
        dialogFactory: require(PART_FILES.dialog),
      };
    }
    if (typeof require === "function") {
      return {
        curves: require(PART_FILES.curves),
        hostFactory: require(PART_FILES.host),
        dialogFactory: require(PART_FILES.dialog),
      };
    }
    throw new Error("Easing+ needs the plugin bundle asset resolver.");
  }

  function installStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const bundledStyle = state.getAsset?.("text", STYLE_URL);
    if (typeof bundledStyle === "string") {
      const style = document.createElement("style");
      style.id = STYLE_ID;
      style.textContent = bundledStyle;
      document.head.appendChild(style);
      return;
    }
    const link = document.createElement("link");
    link.id = STYLE_ID;
    link.rel = "stylesheet";
    link.href = STYLE_URL;
    document.head.appendChild(link);
  }

  function uninstallStyle() {
    document.getElementById(STYLE_ID)?.remove();
  }

  function activate(context) {
    if (state.active) return;
    const parts = loadParts(context);
    const curves = parts.curves;
    state.active = true;
    state.getAsset = context.getAsset;
    state.ui = context.ui || null;
    state.editor = context.editor || window.CM;
    const host = parts.hostFactory(state, { curves });
    const dialog = parts.dialogFactory(state, {
      curves,
      applyCurveToTarget: host.applyCurveToTarget,
    });
    state.parts = { curves, host, dialog };
    installStyle();
    state.originalCorrectCurve = window.PZ.tween.correctCurve;
    state.patchedCorrectCurve = function (start, end) {
      if (curves.shouldPreserveCrossingX(start, end)) return 1;
      return state.originalCorrectCurve(start, end);
    };
    window.PZ.tween.correctCurve = state.patchedCorrectCurve;
    state.originalEaseDropDown = window.PZ.editor.showEaseDropDown;
    state.patchedEaseDropDown = function (button) {
      const targets = host.resolveTargets(button);
      if (!targets) return state.originalEaseDropDown.apply(this, arguments);
      dialog.createDialog(targets);
    };
    window.PZ.editor.showEaseDropDown = state.patchedEaseDropDown;
    host.installEaseButtonLabels();
    host.installShapePreservation();
  }

  function deactivate() {
    if (!state.active) return;
    state.parts?.dialog?.closeDialog();
    state.parts?.host?.uninstallEaseButtonLabels();
    state.parts?.host?.uninstallShapePreservation();
    if (window.PZ?.editor?.showEaseDropDown === state.patchedEaseDropDown) {
      window.PZ.editor.showEaseDropDown = state.originalEaseDropDown;
    }
    if (window.PZ?.tween?.correctCurve === state.patchedCorrectCurve) {
      window.PZ.tween.correctCurve = state.originalCorrectCurve;
    }
    uninstallStyle();
    state.active = false;
    state.editor = null;
    state.getAsset = null;
    state.originalEaseDropDown = null;
    state.patchedEaseDropDown = null;
    state.originalCorrectCurve = null;
    state.patchedCorrectCurve = null;
    state.ui = null;
    state.parts = null;
  }

  // Unit-test surface. In the runtime bundle the parts load per activation;
  // under Node they are preloaded here so tests can pin the pure helpers
  // without activating. The factories only read the probe state when their
  // installers run, which tests never trigger.
  function testSurface() {
    if (typeof require !== "function") return {};
    const curves = require(PART_FILES.curves);
    const probe = {
      easeButtons: new Set(),
      displayRows: new Set(),
      pendingDragShapes: new Map(),
    };
    const host = require(PART_FILES.host)(probe, { curves });
    const dialog = require(PART_FILES.dialog)(probe, {
      curves,
      applyCurveToTarget: host.applyCurveToTarget,
    });
    return {
      ...curves,
      pickTargetForSet: host.pickTargetForSet,
      keyframesAround: host.keyframesAround,
      resolveTweenWrites: host.resolveTweenWrites,
      executeTweenWrite: host.executeTweenWrite,
      resolveDisplayTweens: host.resolveDisplayTweens,
      isPropertyInterpolated: host.isPropertyInterpolated,
      applyIncomingDisplay: host.applyIncomingDisplay,
      graphBounds: dialog.graphBounds,
      miniGeometry: dialog.miniGeometry,
      overshootForPoints: dialog.overshootForPoints,
    };
  }

  return {
    activate,
    deactivate,
    __test: testSurface(),
  };
})();

module.exports = EasingPlus;
