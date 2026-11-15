"use strict";

// ExpressText+ Delay chase simulation over the effector stack.

const { cachedDelayParams, cachedDelayTarget, delayCacheFor } = require("./expresstext-delay-cache.js");
const { PZ_EULER_ORDERS } = require("./expresstext-constants.js");
const { isLetterSelected, numberValue, resolveSelection, strengthWeight } = require("./expresstext-select.js");
const { applyFieldWeight, blankControls, readProp } = require("./expresstext-eval.js");
const { evaluateFormula, evaluateOrbit, evaluatePlain, evaluateRandom, evaluateShake, evaluateSpline, evaluateTwist, evaluateWrap } = require("./expresstext-effectors.js");

// Delay chase calibration (see the Delay section below). Each letter
// chases its own target, so forward and reversed sweeps time identically:
// the cascade comes from the field sweep itself, the Delay only trails.
// Even closes in at uniform speed covering the letter's whole travel in
// DELAY_EVEN_SPAN frames at full strength (Strength adjusts the speed,
// per the manual). Blend catches up DELAY_BLEND_CATCH of the gap per
// frame; Spring rides DELAY_SPRING_STIFF stiffness retaining
// DELAY_SPRING_DAMP of its velocity (higher Strength softens toward these
// through a square-root ramp, so mid strengths already wobble). Long
// timelines warm-start the last DELAY_SIM_WINDOW frames; older history
// cannot move a trail.
const DELAY_EVEN_SPAN = 2.5;
const DELAY_BLEND_CATCH = 0.25;
const DELAY_SPRING_STIFF = 0.08;
const DELAY_SPRING_DAMP = 0.9;
const DELAY_SPRING_DAMP_MIN = 0.5;
const DELAY_SIM_WINDOW = 7200;

// Per-letter Delay parameters for one simulation step. null means the
// letter bypasses the chase and follows its own target (disabled layer,
// unselected letter, or zero field weight — like unselected clones in C4D).
function delayLinkParams(props, frame, index, list, base, plainLists) {
  if (!numberValue(readProp(props, "delayEnable", frame, 1), 1)) return null;
  const selected = resolveSelection(
    readProp(props, "delayLetters", frame, ""),
    list.total,
    plainLists || []
  );
  if (!isLetterSelected(selected, index)) return null;
  const gated = applyFieldWeight(
    strengthWeight(readProp(props, "delayStrength", frame, 100)),
    props,
    "delay",
    frame,
    base
  );
  if (!(gated > 0)) return null;
  return {
    strength: Math.min(1, Math.max(0, gated)),
    mode: Math.round(numberValue(readProp(props, "delayMode", frame, 0), 0)),
    position: !!numberValue(readProp(props, "delayPosition", frame, 1), 1),
    scale: !!numberValue(readProp(props, "delayScale", frame, 1), 1),
    rotation: !!numberValue(readProp(props, "delayRotation", frame, 1), 1),
  };
}

// One chase step for a single letter: move state toward pred (the
// letter's own target). snap is the same target: bypassed letters (null
// chase, strength 0, toggled-off channel) snap to it, so unaffected
// clones follow the raw effector result exactly and stale spring velocity
// is always cleared on bypass. mode 0 closes at uniform speed paced by
// travel (the letter's whole motion over the window), mode 1 closes
// fast-then-slow, mode 2 rides a damper.
function chaseToward(state, velocity, pred, snap, chase, travel, dt) {
  const step = Math.max(0, numberValue(dt, 1));
  const groups = [
    ["position", "positionVelocity", chase ? chase.position : false],
    ["rotation", "rotationVelocity", chase ? chase.rotation : false],
    ["scale", "scaleVelocity", chase ? chase.scale : false],
  ];
  for (const [key, velKey, enabled] of groups) {
    const cur = state[key];
    const vel = velocity[velKey];
    if (!chase || !enabled || !(chase.strength > 0)) {
      for (let axis = 0; axis < 3; axis += 1) {
        cur[axis] = snap[key][axis];
        vel[axis] = 0;
      }
      continue;
    }
    const s = chase.strength;
    const want = pred[key];
    for (let axis = 0; axis < 3; axis += 1) {
      const from = numberValue(cur[axis], 0);
      const to = numberValue(want[axis], 0);
      if (chase.mode === 2) {
        // Softens with strength (the manual: higher values, softer
        // springs, more residual oscillation); the output blend carries
        // the off-ramp to exact at 0%.
        const soft = Math.sqrt(Math.min(1, Math.max(0, s)));
        const stiff = 1 + (DELAY_SPRING_STIFF - 1) * soft;
        const damp = DELAY_SPRING_DAMP_MIN + (DELAY_SPRING_DAMP - DELAY_SPRING_DAMP_MIN) * s;
        vel[axis] += (to - from) * stiff * step;
        vel[axis] *= Math.pow(damp, step);
        cur[axis] = from + vel[axis] * step;
      } else if (chase.mode === 1) {
        // Fast-then-slow close-in; the catch-up reaches instant at 0%.
        const k = 1 + (DELAY_BLEND_CATCH - 1) * s;
        cur[axis] = from + (to - from) * Math.min(1, k * step);
      } else {
        // Uniform close-in: cover the whole travel in SPAN frames at full
        // strength, so steps cascade a few frames late while gentle motion
        // tracks nearly exactly. Static letters hold (travel 0 → frozen).
        const pace = numberValue(travel && travel[key] ? travel[key][axis] : 0, 0);
        const rate = pace > 0 ? (pace / Math.max(s * DELAY_EVEN_SPAN, 1e-9)) * step : 0;
        const diff = to - from;
        cur[axis] = from + Math.max(-rate, Math.min(rate, diff));
      }
    }
  }
}

function blankDelayVelocity() {
  return {
    positionVelocity: [0, 0, 0],
    rotationVelocity: [0, 0, 0],
    scaleVelocity: [0, 0, 0],
  };
}

// Every non-delay effector at one frame, merged into fresh controls.
function evaluateEffectors(layers, frame, index, list, base, plainLists, aux) {
  const out = blankControls();
  for (const layer of layers) {
    if (!layer || layer.kind === "delay") continue;
    if (layer.kind === "shake") evaluateShake(layer.props, frame, index, list, base, out, plainLists, aux);
    else if (layer.kind === "plain") evaluatePlain(layer.props, frame, index, list, base, out, plainLists);
    else if (layer.kind === "random") evaluateRandom(layer.props, frame, index, list, base, out, plainLists);
    else if (layer.kind === "formula") evaluateFormula(layer.props, frame, index, list, base, out, plainLists, aux);
    else if (layer.kind === "twist") evaluateTwist(layer.props, frame, index, list, base, out, plainLists);
    else if (layer.kind === "wrap") evaluateWrap(layer.props, frame, index, list, base, out, plainLists);
    else if (layer.kind === "orbit") evaluateOrbit(layer.props, frame, index, list, base, out, plainLists, aux);
    else if (layer.kind === "spline") evaluateSpline(layer.props, frame, index, list, base, out, plainLists, aux);
  }
  return out;
}

// Full stack for one letter across ancestor layers (outermost first).
// Delay layers drag a trail behind the motion: each letter chases its own
// target, and static stacks simply hold their pose (like C4D: still in,
// still out). aux carries shared line data both paths can use (notably
// the Spline Relative extent); without it those fall back gracefully.
// Unknown kinds are ignored so future effectors compose without changes.
function evaluateStack(stack, containerProps, frame, index, list, base, aux) {
  const out = blankControls();
  const order = readProp(containerProps, "rotationOrder", frame, "XYZ");
  out.eulerOrder = PZ_EULER_ORDERS.has(order) ? order : "XYZ";
  const layers = stack || [];
  const delays = [];
  for (const layer of layers) {
    if (layer && layer.kind === "delay") delays.push(layer);
  }
  if (!delays.length) {
    const pose = evaluateEffectors(layers, frame, index, list, base, plainListsAt(layers, frame), aux);
    out.position = pose.position;
    out.rotation = pose.rotation;
    out.scale = pose.scale;
    return out;
  }
  const controls = simulateDelayLetter(layers, delays, frame, index, list, base, aux);
  out.position = controls.position;
  out.rotation = controls.rotation;
  out.scale = controls.scale;
  return out;
}

function plainListsAt(layers, frame) {
  const plainLists = [];
  // Section selections by kind for kind-N tokens ("plain-2",
  // "voronoi-1", ...): rides the array so every existing caller and
  // test passing plain lists keeps working unchanged.
  const sections = {};
  for (const layer of layers) {
    if (!layer || !layer.kind) continue;
    const letters = readProp(layer.props, `${layer.kind}Letters`, frame, "");
    if (layer.kind === "plain") plainLists.push(letters);
    (sections[layer.kind] = sections[layer.kind] || []).push(letters);
  }
  plainLists.sections = sections;
  return plainLists;
}

function copyDelayState(state) {
  return {
    position: state.position.slice(),
    rotation: state.rotation.slice(),
    scale: state.scale.slice(),
  };
}

// Standard effector Strength: the trail blends between the undelayed
// target (0%, off) and the fully chased state (100%). Bypassed letters
// read strength 0 and follow their target exactly.
function blendDelayOutput(target, chased, s) {
  if (!(s > 0)) {
    return {
      position: target.position.slice(),
      rotation: target.rotation.slice(),
      scale: target.scale.slice(),
    };
  }
  if (s >= 1) return chased;
  const out = { position: [0, 0, 0], rotation: [0, 0, 0], scale: [0, 0, 0] };
  for (const key of ["position", "rotation", "scale"]) {
    for (let axis = 0; axis < 3; axis += 1) {
      out[key][axis] = target[key][axis] + (chased[key][axis] - target[key][axis]) * s;
    }
  }
  return out;
}

function copyDelayVelocity(velocity) {
  return {
    positionVelocity: velocity.positionVelocity.slice(),
    rotationVelocity: velocity.rotationVelocity.slice(),
    scaleVelocity: velocity.scaleVelocity.slice(),
  };
}

function sampleStageTarget(layers, stepFrame, letterIndex, list, base, aux) {
  const pose = evaluateEffectors(
    layers,
    stepFrame,
    letterIndex,
    list,
    base,
    plainListsAt(layers, stepFrame),
    aux
  );
  return {
    position: pose.position.slice(),
    rotation: pose.rotation.slice(),
    scale: pose.scale.slice(),
  };
}

// One Delay layer for one letter: the letter chases its own stage input,
// so forward and reversed sweeps time identically and static targets hold
// exactly. Even closes in at uniform speed, Blend fast-then-slow, Spring
// on a damper. Stacked Delays chain the same way C4D stacks them. The full
// simulation below replays the whole window; sequential playback instead
// continues the stored checkpoint (see extendDelayStage) and only falls
// back here when the window slides, the timeline scrubs, or the travel
// grows. Both paths share chaseStep/tailForEndFrame so they stay identical.
function chaseForParams(params) {
  if (!params) return { mode: 0, chase: null };
  const mode = params.mode === 1 || params.mode === 2 ? params.mode : 0;
  return {
    mode,
    chase: {
      mode,
      strength: params.strength,
      position: params.position,
      scale: params.scale,
      rotation: params.rotation,
    },
  };
}

// One integer chase step from state toward own. Returns the next state and
// its output (Spring blends the off-ramp; Even and Blend carry it in the
// pacing and catch-up). Values match the historical inline loop exactly.
function chaseStep(state, velocity, own, params, travel, dt) {
  const { mode, chase } = chaseForParams(params);
  const chased = copyDelayState(state);
  chaseToward(chased, velocity, own, own, chase, travel, dt);
  const output = mode === 2 ? blendDelayOutput(own, chased, params ? params.strength : 0) : chased;
  return { state: chased, output };
}

// Fractional tail at the exact end frame from a finished integer state.
function tailForEndFrame(paramsAt, sampleInput, endFrame, state, velocity, travel, frac) {
  const params = paramsAt(endFrame);
  const own = sampleInput(endFrame);
  const { mode, chase } = chaseForParams(params);
  const chased = copyDelayState(state);
  const nextVel = copyDelayVelocity(velocity);
  chaseToward(chased, nextVel, own, own, chase, travel, frac);
  return mode === 2 ? blendDelayOutput(own, chased, params ? params.strength : 0) : chased;
}
function runDelayLetterStage(layers, delayProps, sampleInput, endFrame, lastStep, index, list, base, retainTable = true, sampleParams) {
  const firstStep = Math.max(0, lastStep - DELAY_SIM_WINDOW);
  const listsAt = (f) => plainListsAt(layers, f);
  const paramsAt = sampleParams || ((f) => delayLinkParams(delayProps, f, index, list, base, listsAt(f)));
  // Stage targets over the window; Even paces itself on their travel.
  const targets = [];
  for (let f = firstStep; f <= lastStep; f += 1) targets.push(sampleInput(f));
  const travel = { position: [0, 0, 0], rotation: [0, 0, 0], scale: [0, 0, 0] };
  const lo = { position: [0, 0, 0], rotation: [0, 0, 0], scale: [0, 0, 0] };
  const hi = { position: [0, 0, 0], rotation: [0, 0, 0], scale: [0, 0, 0] };
  for (const key of ["position", "rotation", "scale"]) {
    for (let axis = 0; axis < 3; axis += 1) {
      let loValue = Infinity;
      let hiValue = -Infinity;
      for (let k = 0; k < targets.length; k += 1) {
        const v = targets[k][key][axis];
        if (v < loValue) loValue = v;
        if (v > hiValue) hiValue = v;
      }
      lo[key][axis] = loValue;
      hi[key][axis] = hiValue;
      travel[key][axis] = hiValue > loValue ? hiValue - loValue : 0;
    }
  }
  // Chase the letter's own target; static targets hold exactly.
  let state = copyDelayState(targets[0]);
  const velocity = blankDelayVelocity();
  const table = [];
  for (let k = 0; k < targets.length; k += 1) {
    const f = firstStep + k;
    const stepped = chaseStep(state, velocity, targets[k], paramsAt(f), travel, 1);
    state = stepped.state;
    if (retainTable) table.push(stepped.output);
    else table[0] = stepped.output;
  }
  // Fractional tail at the exact end frame.
  const frac = endFrame - lastStep;
  let tail = null;
  if (frac > 1e-9) {
    tail = tailForEndFrame(paramsAt, sampleInput, endFrame, state, velocity, travel, frac);
  } else {
    tail = table[table.length - 1];
  }
  const lerpState = (a, b, t) => {
    const out = { position: [0, 0, 0], rotation: [0, 0, 0], scale: [0, 0, 0] };
    for (const key of ["position", "rotation", "scale"]) {
      for (let axis = 0; axis < 3; axis += 1) {
        out[key][axis] = a[key][axis] + (b[key][axis] - a[key][axis]) * t;
      }
    }
    return out;
  };
  return {
    // Integer steps read the output table (linearly interpolated for
    // fractional queries), the exact end frame reads the fractional tail.
    sample(stepFrame) {
      if (stepFrame >= endFrame - 1e-9) return tail;
      if (stepFrame <= firstStep) return table[0];
      const k0 = Math.floor(stepFrame) - firstStep;
      const t = stepFrame - Math.floor(stepFrame);
      const a = table[Math.min(table.length - 1, Math.max(0, k0))];
      if (!(t > 1e-9)) return a;
      return lerpState(a, table[Math.min(table.length - 1, k0 + 1)], t);
    },
    // Continuation for sequential playback: firstStep/lastStep pin the
    // window, lo/hi the prefix bounds, state/velocity the chase head.
    // extendedFrom is the oldest step this sampler cannot serve (full
    // samplers serve from firstStep, so theirs is firstStep - 1).
    checkpoint: {
      firstStep,
      lastStep,
      extendedFrom: firstStep - 1,
      lo,
      hi,
      travel,
      state: copyDelayState(state),
      velocity: copyDelayVelocity(velocity),
      lastOutput: table[table.length - 1],
    },
  };
}

// Continue a stored chase over the new steps only. The window must only
// extend (same firstStep, lastStep ahead): old targets, params and travel
// are then exactly what the full simulation would reuse, so chasing on
// from the stored head matches it step for step. Any travel growth changes
// Even pacing for the whole window, so it reruns fully instead. Returns
// the staged sampler plus its replacement checkpoint, or null when the
// full simulation must rerun. The sampler answers the new steps and the
// exact end frame (everything a following incremental stage queries);
// anything else reads null and the caller falls back to the full path.
function extendDelayStage(checkpoint, prevSample, sampleParams, endFrame, lastStep) {
  const firstStep = Math.max(0, lastStep - DELAY_SIM_WINDOW);
  if (!checkpoint || checkpoint.firstStep !== firstStep) return null;
  if (!(lastStep >= checkpoint.lastStep)) return null;
  const fresh = [];
  for (let f = checkpoint.lastStep + 1; f <= lastStep; f += 1) {
    const own = prevSample(f);
    if (!own) return null;
    fresh.push(own);
  }
  // The window only extends, so merge the stored prefix bounds with the
  // new steps (exact min/max: no rounding, NaN never wins a comparison).
  const lo = copyDelayState(checkpoint.lo);
  const hi = copyDelayState(checkpoint.hi);
  const travel = { position: [0, 0, 0], rotation: [0, 0, 0], scale: [0, 0, 0] };
  for (const key of ["position", "rotation", "scale"]) {
    for (let axis = 0; axis < 3; axis += 1) {
      for (let k = 0; k < fresh.length; k += 1) {
        const v = fresh[k][key][axis];
        if (v < lo[key][axis]) lo[key][axis] = v;
        if (v > hi[key][axis]) hi[key][axis] = v;
      }
      travel[key][axis] = hi[key][axis] > lo[key][axis] ? hi[key][axis] - lo[key][axis] : 0;
      if (travel[key][axis] !== checkpoint.travel[key][axis]) return null;
    }
  }
  let state = copyDelayState(checkpoint.state);
  const velocity = copyDelayVelocity(checkpoint.velocity);
  const outputs = [];
  for (let k = 0; k < fresh.length; k += 1) {
    const stepped = chaseStep(state, velocity, fresh[k], sampleParams(checkpoint.lastStep + 1 + k), travel, 1);
    state = stepped.state;
    outputs.push(stepped.output);
  }
  const frac = endFrame - lastStep;
  // An unchanged integer frame reuses the stored head output; anything
  // else chases the new steps (or the fractional tail) from the head.
  const tail = frac > 1e-9
    ? tailForEndFrame(sampleParams, prevSample, endFrame, state, velocity, travel, frac)
    : outputs.length ? outputs[outputs.length - 1] : checkpoint.lastOutput;
  const fromStep = checkpoint.lastStep;
  return {
    checkpoint: {
      firstStep,
      lastStep,
      extendedFrom: fromStep,
      lo,
      hi,
      travel,
      state: copyDelayState(state),
      velocity: copyDelayVelocity(velocity),
      // Head output at the integer lastStep (never the fractional tail:
      // a later integer repeat frame reuses exactly this).
      lastOutput: outputs.length ? outputs[outputs.length - 1] : checkpoint.lastOutput,
    },
    sample(stepFrame) {
      if (stepFrame >= endFrame - 1e-9) return tail;
      if (Number.isSafeInteger(stepFrame) && stepFrame > fromStep && stepFrame <= lastStep) {
        return outputs[stepFrame - fromStep - 1];
      }
      return null;
    },
  };
}

// Whether the previous stage's sampler serves every step an incremental
// extension of stage `stage` queries: its new steps plus the end frame.
// The base target cache answers every frame; a full rerun serves its whole
// window; an incremental one serves its own new steps and end frame.
function prevStageCovers(checks, stage, oldLast, lastStep) {
  if (stage === 0) return true;
  const prev = checks ? checks[stage - 1] : null;
  if (!prev) return false;
  return oldLast >= prev.extendedFrom && lastStep <= prev.lastStep;
}

function simulateDelayLetter(layers, delays, frame, index, list, base, aux) {
  const endFrame = numberValue(frame, 0);
  if (!(endFrame > 0)) {
    // Pre-roll: the letter starts exactly on the target.
    return sampleStageTarget(layers, endFrame, index, list, base, aux);
  }
  const lastStep = Math.floor(endFrame);
  const cache = delayCacheFor(layers, index, list, base, aux);
  const checks = cache ? cache.checks || (cache.checks = []) : null;
  const target = (stepFrame) => sampleStageTarget(layers, stepFrame, index, list, base, aux);
  const firstStep = Math.max(0, lastStep - DELAY_SIM_WINDOW);
  // samplers[stage] feeds stage `stage` (samplers[0] is the stage target).
  const samplers = [(stepFrame) => cachedDelayTarget(cache, stepFrame, target)];
  const extended = [];
  for (let stage = 0; stage < delays.length; stage += 1) {
    const delay = delays[stage];
    const paramsFor = (stepFrame) => cachedDelayParams(cache, stage, stepFrame, (f) =>
      delayLinkParams(delay.props, f, index, list, base, plainListsAt(layers, f)));
    const checkpoint = checks ? checks[stage] : null;
    let staged = null;
    if (checkpoint && checkpoint.firstStep === firstStep && lastStep >= checkpoint.lastStep &&
        prevStageCovers(checks, stage, checkpoint.lastStep, lastStep)) {
      staged = extendDelayStage(checkpoint, samplers[stage], paramsFor, endFrame, lastStep);
    }
    if (staged) {
      samplers[stage + 1] = staged.sample;
      extended[stage] = true;
      if (checks) checks[stage] = staged.checkpoint;
      continue;
    }
    // Full simulation for this stage. Earlier stages that continued
    // incrementally serve only their new steps, so rerun them fully first
    // (the full path rebuilds the whole window exactly like before).
    let from = stage;
    while (from > 0 && extended[from - 1]) from -= 1;
    for (let j = from; j <= stage; j += 1) {
      const resumed = delays[j];
      const resumedParams = (stepFrame) => cachedDelayParams(cache, j, stepFrame, (f) =>
        delayLinkParams(resumed.props, f, index, list, base, plainListsAt(layers, f)));
      const full = runDelayLetterStage(
        layers,
        resumed.props,
        samplers[j],
        endFrame,
        lastStep,
        index,
        list,
        base,
        j < delays.length - 1,
        resumedParams
      );
      samplers[j + 1] = full.sample;
      extended[j] = false;
      if (checks) checks[j] = full.checkpoint;
    }
  }
  return samplers[delays.length](endFrame);
}

module.exports = { DELAY_BLEND_CATCH, DELAY_EVEN_SPAN, DELAY_SIM_WINDOW, DELAY_SPRING_DAMP, DELAY_SPRING_DAMP_MIN, DELAY_SPRING_STIFF, blankDelayVelocity, blendDelayOutput, chaseToward, chaseStep, copyDelayState, copyDelayVelocity, delayLinkParams, evaluateEffectors, evaluateStack, extendDelayStage, plainListsAt, prevStageCovers, runDelayLetterStage, sampleStageTarget, simulateDelayLetter, tailForEndFrame };
