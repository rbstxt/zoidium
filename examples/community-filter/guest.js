"use strict";
function prepare(input) {
  return { uniforms: { gain: input.properties.gain } };
}
function uiEvent(input) {
  if (input.action === "reset") return { state: { gain: 1 } };
  return { state: {} };
}
