"use strict";

// Original Delay traversal retained as a numerical oracle. Each query starts
// from its own sliding window and uses that query's complete target range.
const D = require("../plugins/expresstext-plus/expresstext-delay.js");
const { readProp } = require("../plugins/expresstext-plus/expresstext-eval.js");

function referenceStage(layers, props, sample, end, index, list, base) {
  const last = Math.floor(end);
  const first = Math.max(0, last - D.DELAY_SIM_WINDOW);
  const targets = [];
  for (let f = first; f <= last; f++) targets.push(sample(f));
  const travel = { position: [0, 0, 0], rotation: [0, 0, 0], scale: [0, 0, 0] };
  for (const key of ["position", "rotation", "scale"]) for (let axis = 0; axis < 3; axis++) {
    let lo = Infinity, hi = -Infinity;
    for (const pose of targets) {
      const v = pose[key][axis];
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    travel[key][axis] = hi > lo ? hi - lo : 0;
  }
  let state = D.copyDelayState(targets[0]), velocity = D.blankDelayVelocity();
  function step(frame, own, dt) {
    const params = D.delayLinkParams(props, frame, index, list, base, D.plainListsAt(layers, frame));
    const mode = params ? params.mode : 0;
    const chase = params ? { ...params, mode: mode === 1 || mode === 2 ? mode : 0 } : null;
    const chased = D.copyDelayState(state), nextVel = D.copyDelayVelocity(velocity);
    D.chaseToward(chased, nextVel, own, own, chase, travel, dt);
    state = chased; velocity = nextVel;
    return mode === 2 ? D.blendDelayOutput(own, chased, params ? params.strength : 0) : chased;
  }
  const table = targets.map((own, k) => step(first + k, own, 1));
  const frac = end - last;
  const tail = frac > 1e-9 ? step(end, sample(end), frac) : table.at(-1);
  return f => {
    if (f >= end - 1e-9) return tail;
    if (f <= first) return table[0];
    const k = Math.floor(f) - first, t = f - Math.floor(f);
    const a = table[Math.min(table.length - 1, Math.max(0, k))];
    if (!(t > 1e-9)) return a;
    const b = table[Math.min(table.length - 1, k + 1)];
    const out = { position: [], rotation: [], scale: [] };
    for (const key of Object.keys(out)) for (let axis = 0; axis < 3; axis++) {
      out[key][axis] = a[key][axis] + (b[key][axis] - a[key][axis]) * t;
    }
    return out;
  };
}

function referenceStack(layers, container, frame, index, list, base, aux) {
  let sample = f => D.sampleStageTarget(layers, f, index, list, base, aux);
  if (frame > 0) for (const layer of layers) if (layer.kind === "delay") {
    sample = referenceStage(layers, layer.props, sample, frame, index, list, base);
  }
  const order = readProp(container, "rotationOrder", frame, "XYZ");
  return { ...sample(frame), eulerOrder: ["XYZ", "XZY", "YXZ", "YZX", "ZXY", "ZYX"].includes(order) ? order : "XYZ" };
}

module.exports = { referenceStack };
