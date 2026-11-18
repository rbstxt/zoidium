"use strict";

// Reserved extension point for a motion-interpolation (optical-flow) source
// sampler. Time Remap does not implement interpolation. The effect reserves
// option value 2 of its Frame blending row for such a sampler, but the row
// lists only "off" and "frame mix", so value 2 cannot be chosen from the UI.
//
// A registered sampler receives the fractional source clock and returns two
// explicit taps in the owner's clock, plus their weights:
//
//   register(context => ({
//     frames: [offsetA, offsetB],   // local-frame offsets from the clock
//     weights: [weightA, weightB],  // non-negative, at least one non-zero
//   }));
//
// The current pass mixes exactly two captures, which keeps the pass and its
// targets unchanged when an interpolator arrives. A sampler that needs more
// taps must extend the pass in effects/timeremap.js together with this file.
// Registration is process-wide and lives as long as the bundle instances do;
// the returned function removes it.

const samplers = [];

function register(sampler) {
  if (typeof sampler !== "function") throw new Error("Time Remap interpolation expects a function");
  samplers.push(sampler);
  let active = true;
  return function unregister() {
    if (!active) return;
    active = false;
    const index = samplers.indexOf(sampler);
    if (index >= 0) samplers.splice(index, 1);
  };
}

function request(context) {
  for (let index = samplers.length - 1; index >= 0; index -= 1) {
    let plan;
    try {
      plan = samplers[index](context);
    } catch (_error) {
      // A broken interpolator falls back to frame mix instead of a blank frame.
      continue;
    }
    if (!plan) continue;
    const frames = Array.isArray(plan.frames) ? plan.frames : null;
    const weights = Array.isArray(plan.weights) ? plan.weights : null;
    if (!frames || frames.length !== 2 || !weights || weights.length !== 2) continue;
    if (!frames.every(value => Number.isFinite(Number(value))) ||
        !weights.every(value => Number.isFinite(Number(value)) && Number(value) >= 0)) continue;
    if (!(Number(weights[0]) + Number(weights[1]) > 0)) continue;
    return { frames: frames.map(Number), weights: weights.map(Number) };
  }
  return null;
}

module.exports = { register, request };
