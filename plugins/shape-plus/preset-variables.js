"use strict";

// Built-in preset fonts served at /assets/fonts/2d/<name>.ttf are host-safe
// static instances, because the native 2D text parser fills overlapping
// variable outlines wrongly. Shape+ text keeps the variable axes by loading
// the variable file from /assets/fonts/2d-variable/ instead, whenever the
// font reference is one of these presets. Keep this map in sync with the
// "variable" fields in fonts/presets.json: test/font-presets.test.js fails
// when they differ.
// Maps built-in preset font asset paths to their variable files and back.
// Shape+ loads the variable file so axis animation keeps working; if the
// variable file fails to load, the static preset is used instead and the
// record notes the fallback. Custom files pass through unchanged.
const VARIABLE_BY_PRESET = {
  "/assets/fonts/2d/geist.ttf": "/assets/fonts/2d-variable/geist.ttf",
  "/assets/fonts/2d/geist mono.ttf": "/assets/fonts/2d-variable/geist mono.ttf",
  "/assets/fonts/2d/geist serif.ttf": "/assets/fonts/2d-variable/geist serif.ttf",
  "/assets/fonts/2d/inter.ttf": "/assets/fonts/2d-variable/inter.ttf",
};
const PRESET_BY_VARIABLE = Object.fromEntries(
  Object.entries(VARIABLE_BY_PRESET).map(([preset, variable]) => [variable, preset]));

function resolveVariableRef(ref) {
  return typeof ref === "string" && VARIABLE_BY_PRESET[ref] ? VARIABLE_BY_PRESET[ref] : ref;
}

function resolveStaticRef(ref) {
  return typeof ref === "string" && PRESET_BY_VARIABLE[ref] ? PRESET_BY_VARIABLE[ref] : ref;
}

module.exports = { VARIABLE_BY_PRESET, PRESET_BY_VARIABLE, resolveVariableRef, resolveStaticRef };
