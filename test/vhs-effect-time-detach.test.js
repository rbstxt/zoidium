"use strict";

// Detach guard: the VHS effectTime helper must not throw when the effect's
// clip was deleted (parentProject getter throws). A detached effect falls
// back to the default project rate. Attached calls keep their clock.

const assert = require("node:assert/strict");
const test = require("node:test");

globalThis.PZ = globalThis.PZ || {};
globalThis.PZ.property = globalThis.PZ.property || { type: { NUMBER: 0, OPTION: 1, TEXT: 2 } };
globalThis.PZ.keyframe = globalThis.PZ.keyframe || class Keyframe {};

const helpers = require("../plugins/openzoid-legacy/effects/vhs-helpers.js");

function effectWith(project) {
  const effect = {
    properties: {
      time: { get: () => 5 },
      timeMode: { get: () => 1 },
    },
  };
  Object.defineProperty(effect, "parentProject", {
    configurable: true,
    enumerable: true,
    get() {
      if (project === null) {
        throw new TypeError("Cannot read properties of null (reading 'parentObject')");
      }
      return project;
    },
  });
  return effect;
}

test("effectTime uses the project rate for an attached effect", () => {
  const project = { sequence: { properties: { rate: { get: () => 24 } } } };
  assert.equal(helpers.effectTime(effectWith(project), 12), 12 / 24 + 5);
});

test("effectTime does not throw for a detached effect", () => {
  assert.equal(helpers.effectTime(effectWith(null), 12), 12 / 30 + 5);
});

test("effectTime keeps the explicit clock for a detached effect", () => {
  const effect = effectWith(null);
  effect.properties.timeMode = { get: () => 0 };
  assert.equal(helpers.effectTime(effect, 12), 5);
});
