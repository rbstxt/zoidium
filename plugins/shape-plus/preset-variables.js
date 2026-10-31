"use strict";

// Built-in preset fonts served at /assets/fonts/2d/<name>.ttf are host-safe
// static instances, because the native 2D text parser fills overlapping
// variable outlines wrongly. Shape+ text keeps the variable axes by loading
// the variable file from /assets/fonts/2d-variable/ instead, whenever the
// font reference is one of these presets. Keep this map in sync with the
// "variable" fields in fonts/presets.json: test/font-presets.test.js fails
// when they differ.
const VARIABLE_BY_PRESET = {
  "/assets/fonts/2d/geist.ttf": "/assets/fonts/2d-variable/geist.ttf",
  "/assets/fonts/2d/geist mono.ttf": "/assets/fonts/2d-variable/geist mono.ttf",
  "/assets/fonts/2d/geist serif.ttf": "/assets/fonts/2d-variable/geist serif.ttf",
  "/assets/fonts/2d/inter.ttf": "/assets/fonts/2d-variable/inter.ttf",
};

function resolveVariableRef(ref) {
  return typeof ref === "string" && VARIABLE_BY_PRESET[ref] ? VARIABLE_BY_PRESET[ref] : ref;
}

module.exports = { VARIABLE_BY_PRESET, resolveVariableRef };
