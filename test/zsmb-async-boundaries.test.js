"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { create } = require("../plugins/smart-motion-blur-lite/async-analysis.js");

test("async analysis follows the tracking direction at the clip start", async () => {
  const previous = global.ZoidiumPluginApis;
  global.ZoidiumPluginApis = { gl: {
    createCopyPass: () => ({ material: {} }),
    disposePass() {},
  } };
  let lookups = 0;
  const compositor = {};
  const host = { prepared: { get() { lookups++; return null; } } };
  const analysis = create({}, { NoBlending: 0 }, {
    zoidium: { temporal: { frameSamplerRuntimes: new Map([[compositor, host]]) } },
  }, "/");
  try {
    for (const trackFrame of [0, 1]) {
      for (const frame of [-1, -0.5, 0, 0.5, 1]) {
        const before = lookups;
        await analysis.prepare(frame, { compositor }, {
          plan: { exact: false }, enabled: true, sensitivity: 1, strength: 1, trackFrame,
        });
        assert.equal(lookups - before, trackFrame === 1 || frame >= 0 ? 1 : 0,
          `trackFrame=${trackFrame}, frame=${frame}`);
      }
    }
  } finally {
    analysis.dispose();
    global.ZoidiumPluginApis = previous;
  }
});
