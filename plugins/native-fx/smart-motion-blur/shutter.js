"use strict";
const utilities = require("./gl.js");

function create(THREE, api, getAsset) {
  const gl = utilities.create(THREE, api, getAsset);
  const mean = gl.pass("shutter", {
    uFirst: null, uSecond: null, uThird: null, uFourth: null,
    uFifth: null, uSixth: null, uSeventh: null, uEighth: null,
    uScale: [1, 1],
  });
  const copy = gl.pass("copy", { uImage: null, uScale: [1, 1] });
  let signature, levels;
  const diagnostics = { reconstruction: "shutter", samples: 0, readbacks: 0 };
  function reduceBatch(renderer, output, samples) {
    return gl.preserve(renderer, () => {
      const taps = Array.from({ length: 8 }, (_, tap) => samples[tap % samples.length].texture);
      gl.draw(renderer, mean, output, {
        uFirst: taps[0], uSecond: taps[1], uThird: taps[2], uFourth: taps[3],
        uFifth: taps[4], uSixth: taps[5], uSeventh: taps[6], uEighth: taps[7],
        uScale: [1, 1],
      });
    });
  }
  function render(renderer, output, input, samples, scale) {
    return gl.preserve(renderer, () => {
      diagnostics.samples = samples[0]?.reducedCount || samples.length;
      if (!samples.length) return gl.draw(renderer, copy, output, {
        uImage: input.texture, uScale: scale,
      });
      if (samples.length === 1) return gl.draw(renderer, copy, output, {
        uImage: samples[0].texture, uScale: samples[0].reducedCount ? [1, 1] : scale,
      });
      // The host retains repeated boundary taps with their individual weights.
      // Requests have 32 or 64 entries. Repeat the four final means twice in
      // Balanced, which keeps every original tap equally weighted.
      const key = [input.width, input.height, samples.length].join(":");
      if (signature !== key) {
        gl.clearTargets();
        levels = [];
        for (let count = samples.length; count > 1; count = Math.ceil(count / 8)) {
          const size = Math.ceil(count / 8);
          // The single-group final level draws straight into the output.
          levels.push(size === 1 ? [null] : Array.from({ length: size }, () =>
            gl.target(input.width, input.height),
          ));
        }
        signature = key;
      }
      let sources = samples.map(sample => sample.texture);
      let uvScale = scale;
      for (let level = 0; level < levels.length; level++) {
        const targets = levels[level];
        for (let index = 0; index < targets.length; index++) {
          const group = sources.slice(index * 8, index * 8 + 8);
          const taps = Array.from({ length: 8 }, (_, tap) => group[tap % group.length]);
          const target = level === levels.length - 1 ? output : targets[index];
          gl.draw(renderer, mean, target, {
            uFirst: taps[0], uSecond: taps[1] || taps[0],
            uThird: taps[2] || taps[0], uFourth: taps[3] || taps[0],
            uFifth: taps[4], uSixth: taps[5], uSeventh: taps[6], uEighth: taps[7],
            uScale: uvScale,
          });
        }
        if (level < levels.length - 1) sources = targets.map(target => target.texture);
        uvScale = [1, 1];
      }
    });
  }
  return { render, reduceBatch, diagnostics, dispose() { gl.dispose(); signature = null; } };
}
module.exports = { create };
