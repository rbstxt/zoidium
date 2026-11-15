"use strict";

// ExpressText+ Shared constants and mutable plugin state.

const EXPRESS_TEXT_TYPE = "zoidium:expresstext-plus/expresstext";
const SCHEMA_VERSION = 1;
const EXPRESS_TEXT_NAME = "ExpressText+";
const DEGREES_TO_RADIANS = Math.PI / 180;
const MAX_ANCESTOR_DEPTH = 64;
const FIELD_LABELS = ["Infinite", "Linear", "Box", "Sphere"];
const DELAY_MODE_LABELS = ["Even", "Blend", "Spring"];
const RANDOM_MODE_LABELS = ["Random", "Gaussian", "Noise", "Turbulence", "Sorted"];
const RANDOM_SPACE_LABELS = ["Global", "UV"];
const SPLINE_MODE_LABELS = ["Step", "Falloff", "Relative"];
const SPLINE_PATH_LABELS = ["Line", "Circle", "Helix"];
const SPLINE_PLANE_LABELS = ["XY", "XZ", "YZ"];
const SPLINE_TRANSFORM_LABELS = ["Absolute", "Relative"];
const REPEATER_MODE_LABELS = ["Linear", "Random", "Echo"];
const REPEATER_MAX_COPIES = 64;
const TWIST_AXIS_LABELS = ["X", "Y", "Z"];
const WRAP_DIRECTION_LABELS = ["X", "Y", "Z"];
const DELAY_ORDER_LABELS = ["Forward", "Reverse", "Center out", "Random"];
const PIVOT_LABELS = ["Character", "Text"];
const PZ_EULER_ORDERS = new Set(["XYZ", "XZY", "YXZ", "YZX", "ZXY", "ZYX"]);

const state = {
  PZ: null,
  THREE: null,
  editor: null,
  objectClasses: [],
  effectorClasses: {},
  customPropertyClass: null,
  unregisterObjectClasses: [],
  splitStates: new WeakMap(),
  splitTexts: new Set(),
  textPatched: false,
  originalTextUpdate: null,
  originalTextUpdateGeometry: null,
  // Live ExpressText+ containers and effectors (every class carrying
  // zoidiumExpressTextObject or zoidiumExpressEffector). The patched 3D
  // Text update skips its ancestor walk while this is zero; the count
  // only ever errs towards walking (see trackExpressInstance).
  liveExpressCount: 0,
};

/* ------------------------------------------------- live tracking */

// Live registration for the per-frame fast path. Every ExpressText+
// container and effector class calls trackExpressInstance from its
// constructor and load, and untrackExpressInstance from unload; the
// __zoidiumExpressCounted flag keeps construction plus load on the same
// instance at one count. Counting errs towards walking: an instance that
// cannot be flagged or unflagged still counts while alive, so a zero
// count always means no live ExpressText+ object or effector.
function trackExpressInstance(instance) {
  if (!instance) return;
  try {
    if (instance.__zoidiumExpressCounted === true) return;
    instance.__zoidiumExpressCounted = true;
  } catch (_flag) {
    // Flagging failed (frozen object): count it anyway and never trust a
    // zero count while it may be alive.
  }
  state.liveExpressCount += 1;
}

function untrackExpressInstance(instance) {
  try {
    if (!instance || instance.__zoidiumExpressCounted !== true) return;
    instance.__zoidiumExpressCounted = false;
  } catch (_flag) {
    // Unflagging failed: keep the count high and keep walking.
    return;
  }
  state.liveExpressCount = Math.max(0, state.liveExpressCount - 1);
}

/* ------------------------------------------------------------------ numbers */

module.exports = { DEGREES_TO_RADIANS, DELAY_MODE_LABELS, DELAY_ORDER_LABELS, EXPRESS_TEXT_NAME, EXPRESS_TEXT_TYPE, FIELD_LABELS, MAX_ANCESTOR_DEPTH, PIVOT_LABELS, PZ_EULER_ORDERS, RANDOM_MODE_LABELS, RANDOM_SPACE_LABELS, REPEATER_MAX_COPIES, REPEATER_MODE_LABELS, SCHEMA_VERSION, SPLINE_MODE_LABELS, SPLINE_PATH_LABELS, SPLINE_PLANE_LABELS, SPLINE_TRANSFORM_LABELS, TWIST_AXIS_LABELS, WRAP_DIRECTION_LABELS, state, trackExpressInstance, untrackExpressInstance };
