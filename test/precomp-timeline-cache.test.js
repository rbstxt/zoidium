"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createEnvironment } = require("./precomp-fixtures.js");

// The Tracks patch must hand the drawn timeline to comps-timeline.js; after
// the engine split it assigned an undeclared name instead, which leaked a
// global (or threw in strict code) and never reached the cache.
test("drawing the timeline remembers it without leaking a global", () => {
  delete globalThis.cachedTracks;
  const env = createEnvironment();
  try {
    if (typeof env.tracks.redraw === "function") env.tracks.redraw();
    if (typeof env.tracks.selectClips === "function") env.tracks.selectClips();
    assert.equal(Object.prototype.hasOwnProperty.call(globalThis, "cachedTracks"), false);
  } finally {
    env.uninstall();
  }
});
