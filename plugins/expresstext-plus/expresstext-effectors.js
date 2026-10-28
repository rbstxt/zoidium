"use strict";

// ExpressText+ Effector envelopes (Shake through Wrap), axis rotations and base transforms.

const { isLetterSelected, numberValue, vector3 } = require("./expresstext-select.js");
const { compileFormula } = require("./expresstext-formula.js");
const { fractalNoise3, hashLattice, shakeValue, shuffledStrata } = require("./expresstext-random.js");
const { addScaled, applyFieldWeight, letterContext, mulScale, readProp, readVector } = require("./expresstext-eval.js");

function evaluationRate(aux) {
  const rate = numberValue(aux?.rate, 30);
  return rate > 0 ? rate : 30;
}

function evaluateShake(props, frame, index, list, base, out, plainLists, aux) {
  if (!numberValue(readProp(props, "shakeEnable", frame, 1), 1)) return;
  const ctx = letterContext(props, "shake", frame, index, list, plainLists);
  if (!isLetterSelected(ctx.selected, index)) return;
  let weight = applyFieldWeight(ctx.strength, props, "shake", frame, base);
  if (weight <= 0) return;
  // True time placement: negative local frames are meaningful (sinusoids
  // read naturally; keyframed rows clamp inside the host reader), so no
  // Math.max(0, ...) here — that would freeze every shifted state at 0.
  const localFrame = frame - ctx.delay;
  const value = shakeValue(
    localFrame,
    readProp(props, "shakeFrequency", frame, 1),
    readProp(props, "shakeOffset", frame, 0),
    0,
    evaluationRate(aux)
  );
  const amount = value * weight;
  addScaled(out.position, readVector(props, "shakePosition", frame, [0, 0, 0]), amount);
  addScaled(out.rotation, readVector(props, "shakeRotation", frame, [0, 0, 0]), amount);
  mulScale(out.scale, readVector(props, "shakeScale", frame, [1, 1, 1]), amount);
}

function evaluatePlain(props, frame, index, list, base, out, plainLists) {
  if (!numberValue(readProp(props, "plainEnable", frame, 1), 1)) return;
  const ctx = letterContext(props, "plain", frame, index, list, plainLists);
  if (!isLetterSelected(ctx.selected, index)) return;
  const weight = applyFieldWeight(ctx.strength, props, "plain", frame, base);
  if (weight <= 0) return;
  const localFrame = frame - ctx.delay;
  // Invert odd: odd-numbered letters (1st, 3rd, 5th…) mirror the position
  // and rotation.
  let position = readVector(props, "plainPosition", localFrame, [0, 0, 0]);
  let rotation = readVector(props, "plainRotation", localFrame, [0, 0, 0]);
  const invertOdd =
    Math.round(numberValue(readProp(props, "plainInvertOdd", frame, 0), 0)) === 1;
  if (invertOdd && (index + 1) % 2 === 1) {
    position = [-position[0], -position[1], -position[2]];
    rotation = [-rotation[0], -rotation[1], -rotation[2]];
  }
  addScaled(out.position, position, weight);
  addScaled(out.rotation, rotation, weight);
  mulScale(out.scale, readVector(props, "plainScale", localFrame, [1, 1, 1]), weight);
}

// Normalized random value [0,1] for one letter/channel/axis under the C4D
// Random modes. opts carries { seedInt, sync, indexed, space, anim,
// noise, rank, count }. Random is uniform per axis; Gaussian averages
// three (bell around the middle); Noise/Turbulence sample a value-noise
// field that Global pins to the letter's base position and UV to its
// index, evolving with Animation Speed (Indexed samples each axis
// separately, otherwise all axes share one sample and drift diagonally);
// Sorted deals each selected letter a distinct shuffled stratum so values
// spread evenly. Pure function of its inputs: scrub-safe.
function randomUnit(mode, index, group, axis, base, frame, opts) {
  const m = mode === 1 ? 1 : mode === 2 ? 2 : mode === 3 ? 3 : mode === 4 ? 4 : 0;
  const seedInt = opts.seedInt | 0;
  const groupSalt = opts.sync ? 0 : (group + 1) * 100003;
  if (m === 4) {
    const salt = seedInt + groupSalt + axis * 104729;
    const strata = shuffledStrata(Math.max(1, opts.count), salt);
    const rank = Math.min(opts.count - 1, Math.max(0, opts.rank));
    return (strata[rank] + 0.5) / Math.max(1, opts.count);
  }
  if (m === 2 || m === 3) {
    const scale = Math.max(0, numberValue(opts.noise, 100)) / 100;
    const p = vector3(base, [0, 0, 0]);
    const at =
      opts.space === 1
        ? [index * 3.71, index * 9.13 + 4.7, index * 5.37 + 9.1]
        : [p[0], p[1], p[2]];
    // Animation speed is frame-based: 100 advances one noise unit per 30 frames.
    const t = (numberValue(frame, 0) * Math.max(0, numberValue(opts.anim, 0))) / 100 / 30;
    const freq = scale / 15;
    const gx = opts.sync ? 0 : group * 13.13;
    const ax = opts.indexed ? axis * 19.19 : 0;
    const x = at[0] * freq + 0.63 * t + ax;
    const y = at[1] * freq + 1.17 * t + gx;
    const z = at[2] * freq + 0.81 * t;
    return m === 3
      ? fractalNoise3(x, y, z, seedInt, 4, true)
      : fractalNoise3(x, y, z, seedInt, 2, false);
  }
  if (m === 1) {
    const u =
      hashLattice(index, groupSalt, axis * 3, seedInt) +
      hashLattice(index + 1009, groupSalt, axis * 3 + 1, seedInt) +
      hashLattice(index + 2017, groupSalt, axis * 3 + 2, seedInt);
    return u / 3;
  }
  return hashLattice(index, groupSalt, axis, seedInt);
}

function evaluateRandom(props, frame, index, list, base, out, plainLists) {
  if (!numberValue(readProp(props, "randomEnable", frame, 1), 1)) return;
  const ctx = letterContext(props, "random", frame, index, list, plainLists);
  if (!isLetterSelected(ctx.selected, index)) return;
  // Strength is unbounded (the manual allows below 0% and above 100%):
  // negative strengths mirror the scatter.
  const rawStrength = numberValue(readProp(props, "randomStrength", frame, 100), 100) / 100;
  const field = applyFieldWeight(1, props, "random", frame, base);
  const weight = rawStrength * field;
  if (!(weight > 0 || weight < 0)) return;
  const seed = readProp(props, "randomSeed", frame, 1);
  const mode = Math.round(numberValue(readProp(props, "randomMode", frame, 0), 0));
  // Minimum/Maximum rescale the internal [0,1] range (defaults identity).
  const minimum = numberValue(readProp(props, "randomMinimum", frame, 0), 0) / 100;
  const maximum = numberValue(readProp(props, "randomMaximum", frame, 100), 100) / 100;
  const all = Array.isArray(list.order) && list.order.length
    ? list.order.slice()
    : Array.from({ length: Math.max(0, list.total || 0) }, (_, i) => i);
  const selArray = ctx.selected === null ? all : all.filter((i) => ctx.selected.has(i));
  const opts = {
    seedInt: Math.round(numberValue(seed, 1) * 1000),
    sync: !!numberValue(readProp(props, "randomSynchronized", frame, 0), 0),
    indexed: !!numberValue(readProp(props, "randomIndexed", frame, 1), 1),
    space: Math.round(numberValue(readProp(props, "randomSpace", frame, 0), 0)),
    anim: Math.max(0, numberValue(readProp(props, "randomAnimationSpeed", frame, 0), 0)),
    noise: Math.max(0, numberValue(readProp(props, "randomNoiseScale", frame, 100), 100)),
    rank: selArray.indexOf(index),
    count: selArray.length,
  };
  const localFrame = frame - ctx.delay;
  const posMin = readVector(props, "randomPositionMin", localFrame, [-10, -10, -10]);
  const posMax = readVector(props, "randomPositionMax", localFrame, [10, 10, 10]);
  const rotMin = readVector(props, "randomRotationMin", localFrame, [0, 0, 0]);
  const rotMax = readVector(props, "randomRotationMax", localFrame, [0, 0, 0]);
  const sclMin = readVector(props, "randomScaleMin", localFrame, [1, 1, 1]);
  const sclMax = readVector(props, "randomScaleMax", localFrame, [1, 1, 1]);
  const remap = (u) => minimum + u * (maximum - minimum);
  for (let axis = 0; axis < 3; axis += 1) {
    const up = remap(randomUnit(mode, index, 0, axis, base, localFrame, opts));
    const ur = remap(randomUnit(mode, index, 1, axis, base, localFrame, opts));
    const us = remap(randomUnit(mode, index, 2, axis, base, localFrame, opts));
    out.position[axis] += (posMin[axis] + (posMax[axis] - posMin[axis]) * up) * weight;
    out.rotation[axis] += (rotMin[axis] + (rotMax[axis] - rotMin[axis]) * ur) * weight;
    const target = sclMin[axis] + (sclMax[axis] - sclMin[axis]) * us;
    out.scale[axis] *= 1 + (target - 1) * weight;
  }
}

function evaluateFormula(props, frame, index, list, base, out, plainLists, aux) {
  if (!numberValue(readProp(props, "formulaEnable", frame, 1), 1)) return;
  const ctx = letterContext(props, "formula", frame, index, list, plainLists);
  if (!isLetterSelected(ctx.selected, index)) return;
  // Strength is unbounded (the manual allows below 0% and above 100%):
  // negative strengths mirror the result.
  const rawStrength = numberValue(readProp(props, "formulaStrength", frame, 100), 100) / 100;
  const field = applyFieldWeight(1, props, "formula", frame, base);
  const weight = rawStrength * field;
  if (!(weight > 0 || weight < 0)) return;
  const localFrame = frame - ctx.delay;
  const compiled = compileFormula(readProp(props, "formulaExpression", frame, "sin(u*360*f+t*90)"));
  const order = Array.isArray(list.order) && list.order.length ? list.order : [index];
  const at = order.indexOf(index);
  const rank = at === -1 ? 0 : at;
  const slots = Math.max(1, order.length);
  const bp = vector3(base, [0, 0, 0]);
  const scope = {
    px: bp[0],
    py: bp[1],
    pz: bp[2],
    rx: (out.rotation[0] * 180) / Math.PI,
    ry: (out.rotation[1] * 180) / Math.PI,
    rz: (out.rotation[2] * 180) / Math.PI,
    sx: out.scale[0],
    sy: out.scale[1],
    sz: out.scale[2],
    u: slots > 1 ? rank / (slots - 1) : 0,
    v: 0,
    w: 0,
    id: index,
    count: Math.max(0, numberValue(list.total, 0)),
    falloff: field,
    t: (numberValue(localFrame, 0) / evaluationRate(aux)) * numberValue(readProp(props, "formulaTime", frame, 1), 1),
    f: numberValue(readProp(props, "formulaFrequency", frame, 1), 1),
  };
  let scalar = 0;
  if (!compiled.error) {
    try {
      scalar = numberValue(compiled.fn(scope), 0);
    } catch (_eval) {
      scalar = 0;
    }
  }
  if (!isFinite(scalar)) scalar = 0;
  // Minimum/Maximum rescale the formula output (defaults identity), so a
  // wild expression (t*px) stays tame with Maximum at 1%.
  const minimum = numberValue(readProp(props, "formulaMinimum", frame, 0), 0) / 100;
  const maximum = numberValue(readProp(props, "formulaMaximum", frame, 100), 100) / 100;
  const remapped = minimum + scalar * (maximum - minimum);
  const posAmp = readVector(props, "formulaPosition", localFrame, [0, 10, 0]);
  const rotAmp = readVector(props, "formulaRotation", localFrame, [0, 0, 0]);
  const sclAmp = readVector(props, "formulaScale", localFrame, [1, 1, 1]);
  addScaled(out.position, posAmp, remapped * weight);
  addScaled(out.rotation, rotAmp, remapped * weight);
  mulScale(
    out.scale,
    sclAmp.map((v) => 1 + (v - 1) * remapped),
    weight
  );
}

/* ------------------------------------------------- spline paths */

// XYZ-euler rotation of a vector (R = Rx·Ry·Rz, matching THREE).
function rotateEulerXYZ(v, e) {
  const cx = Math.cos(e[0]);
  const sx = Math.sin(e[0]);
  const cy = Math.cos(e[1]);
  const sy = Math.sin(e[1]);
  const cz = Math.cos(e[2]);
  const sz = Math.sin(e[2]);
  const x1 = cz * v[0] - sz * v[1];
  const y1 = sz * v[0] + cz * v[1];
  const z1 = v[2];
  const x2 = cy * x1 + sy * z1;
  const y2 = y1;
  const z2 = -sy * x1 + cy * z1;
  return [x2, cx * y2 - sx * z2, sx * y2 + cx * z2];
}

// Euler XYZ angles (three.js convention) for a right-handed basis given
// as column vectors. Reduces to the in-plane tangent angle for untilted
// paths, so existing arrangements never shift.
function eulerFromBasis(xAxis, yAxis, zAxis) {
  const clamped = Math.min(1, Math.max(-1, zAxis[0]));
  if (Math.abs(clamped) < 0.9999999) {
    return [
      Math.atan2(-zAxis[1], zAxis[2]),
      Math.asin(clamped),
      Math.atan2(-yAxis[0], xAxis[0]),
    ];
  }
  return [Math.atan2(yAxis[2], yAxis[1]), Math.asin(clamped), 0];
}

// Built-in spline paths (C4D Circle/Helix primitives, Y-up world).
// sampleSplinePath(path, P, u) with u over the full shape returns
// { position, euler }: the point on the path plus the letter orientation
// built from tangent and plane normal, so tilted paths turn letters
// correctly in 3D. P.tilt (radians XYZ) orients the whole path about its
// center. Circle starts at +X like the primitives; helix rises +Y with
// Turns full convolutions; Reverse mirrors u (point order flip).
function sampleSplinePath(path, P, u) {
  const uu = numberValue(u, 0);
  let point;
  let tangent;
  let normal;
  if (path === 2) {
    const turns = numberValue(P.turns, 1);
    const r0 = Math.max(0, numberValue(P.radius, 50));
    const r1 = Math.max(0, numberValue(P.radiusEnd, r0));
    const height = Math.max(0, numberValue(P.height, 100));
    const theta = 2 * Math.PI * turns * uu;
    const r = r0 + (r1 - r0) * uu;
    const dtheta = 2 * Math.PI * turns;
    const dr = r1 - r0;
    point = [r * Math.cos(theta), uu * height, r * Math.sin(theta)];
    tangent = [
      dr * Math.cos(theta) - r * Math.sin(theta) * dtheta,
      height,
      dr * Math.sin(theta) + r * Math.cos(theta) * dtheta,
    ];
    normal = [0, 0, 1];
  } else if (path === 1) {
    const radius = Math.max(0, numberValue(P.radius, 50));
    const theta = 2 * Math.PI * uu;
    const plane = Math.round(numberValue(P.plane, 0));
    if (plane === 1) {
      point = [radius * Math.cos(theta), 0, radius * Math.sin(theta)];
      tangent = [-Math.sin(theta), 0, Math.cos(theta)];
      normal = [0, 1, 0];
    } else if (plane === 2) {
      point = [0, radius * Math.cos(theta), radius * Math.sin(theta)];
      tangent = [0, -Math.sin(theta), Math.cos(theta)];
      normal = [1, 0, 0];
    } else {
      point = [radius * Math.cos(theta), radius * Math.sin(theta), 0];
      tangent = [-Math.sin(theta), Math.cos(theta), 0];
      normal = [0, 0, 1];
    }
  } else {
    const length = Math.max(0, numberValue(P.length, 100));
    point = [(uu - 0.5) * length, 0, 0];
    tangent = [1, 0, 0];
    normal = [0, 0, 1];
  }
  const tiltRaw = vector3(P.tilt, [0, 0, 0]);
  const tilt = [numberValue(tiltRaw[0], 0), numberValue(tiltRaw[1], 0), numberValue(tiltRaw[2], 0)];
  const height = Math.max(0, numberValue(P.height, 100));
  const pivot = path === 2 ? [0, height / 2, 0] : [0, 0, 0];
  const rel = [point[0] - pivot[0], point[1] - pivot[1], point[2] - pivot[2]];
  const spun = rotateEulerXYZ(rel, tilt);
  const position = [pivot[0] + spun[0], pivot[1] + spun[1], pivot[2] + spun[2]];
  const t = rotateEulerXYZ(tangent, tilt);
  const n = rotateEulerXYZ(normal, tilt);
  const tl = Math.hypot(t[0], t[1], t[2]) || 1;
  const tn = [t[0] / tl, t[1] / tl, t[2] / tl];
  const yv = [
    n[1] * tn[2] - n[2] * tn[1],
    n[2] * tn[0] - n[0] * tn[2],
    n[0] * tn[1] - n[1] * tn[0],
  ];
  const yl = Math.hypot(yv[0], yv[1], yv[2]);
  const euler =
    yl > 1e-9
      ? eulerFromBasis(tn, [yv[0] / yl, yv[1] / yl, yv[2] / yl], n)
      : [0, 0, Math.atan2(tn[1], tn[0])];
  return { position, euler };
}

function evaluateSpline(props, frame, index, list, base, out, plainLists, aux) {
  if (!numberValue(readProp(props, "splineEnable", frame, 1), 1)) return;
  const ctx = letterContext(props, "spline", frame, index, list, plainLists);
  if (!isLetterSelected(ctx.selected, index)) return;
  // Strength is unbounded (the manual allows below 0% and above 100%):
  // it blends the distance to the path, mirroring past it when negative.
  const rawStrength = numberValue(readProp(props, "splineStrength", frame, 100), 100) / 100;
  const field = applyFieldWeight(1, props, "spline", frame, base);
  const weight = rawStrength * field;
  if (!(weight > 0 || weight < 0)) return;
  const mode = Math.round(numberValue(readProp(props, "splineMode", frame, 0), 0));
  const transform = Math.round(numberValue(readProp(props, "splineTransform", frame, 0), 0));
  const localFrame = frame - ctx.delay;
  const P = {
    path: Math.round(numberValue(readProp(props, "splinePath", frame, 0), 0)),
    length: Math.max(0, numberValue(readProp(props, "splineLength", localFrame, 100), 100)),
    radius: Math.max(0, numberValue(readProp(props, "splineRadius", localFrame, 50), 50)),
    radiusEnd: Math.max(0, numberValue(readProp(props, "splineRadiusEnd", localFrame, 50), 50)),
    height: Math.max(0, numberValue(readProp(props, "splineHeight", localFrame, 100), 100)),
    turns: numberValue(readProp(props, "splineTurns", localFrame, 1), 1),
    plane: Math.round(numberValue(readProp(props, "splinePlane", localFrame, 0), 0)),
    reverse: !!numberValue(readProp(props, "splineReverse", localFrame, 0), 0),
    offset: numberValue(readProp(props, "splineOffset", localFrame, 0), 0) / 100,
    start: numberValue(readProp(props, "splineStart", localFrame, 0), 0) / 100,
    end: numberValue(readProp(props, "splineEnd", localFrame, 100), 100) / 100,
    clamp: !!numberValue(readProp(props, "splineClamp", localFrame, 1), 1),
    tilt: readVector(props, "splineTilt", localFrame, [0, 0, 0]),
  };
  const path = P.path === 1 ? 1 : P.path === 2 ? 2 : 0;
  const order = Array.isArray(list.order) && list.order.length ? list.order : [index];
  const slots = Math.max(1, order.length);
  const rank = order.indexOf(index);
  // Base coordinate: Step counts evenly, Falloff flows with the field
  // (great with a Linear Field, per the manual), Relative keeps the
  // letters' proportional X spacing (single-line text, per the manual).
  let baseT;
  if (mode === 1) {
    baseT = field;
  } else if (mode === 2) {
    const extent = aux && aux.extent;
    if (extent && extent.hi > extent.lo) {
      const bx = vector3(base, [0, 0, 0])[0];
      baseT = Math.min(1, Math.max(0, (bx - extent.lo) / (extent.hi - extent.lo)));
    } else {
      baseT = slots > 1 ? (rank === -1 ? 0 : rank) / (slots - 1) : 0;
    }
  } else {
    baseT = slots > 1 ? (rank === -1 ? 0 : rank) / (slots - 1) : 0;
  }
  if (P.reverse) baseT = 1 - baseT;
  const place = (x) => {
    const t = P.start + x * (P.end - P.start) + P.offset;
    if (P.clamp) {
      const lo = Math.min(P.start, P.end);
      const hi = Math.max(P.start, P.end);
      return Math.min(hi, Math.max(lo, t));
    }
    return t - Math.floor(t);
  };
  const posToggle = !!numberValue(readProp(props, "splinePosition", frame, 1), 1);
  const rotToggle = !!numberValue(readProp(props, "splineRotation", frame, 1), 1);
  if (transform === 1) {
    // Relative: the text keeps its layout and slides by the path shift
    // between Start and Start + Offset.
    const pin = (x) => {
      if (P.clamp) {
        const lo = Math.min(P.start, P.end);
        const hi = Math.max(P.start, P.end);
        return Math.min(hi, Math.max(lo, x));
      }
      return x - Math.floor(x);
    };
    const a = sampleSplinePath(path, P, pin(P.start + P.offset));
    const b = sampleSplinePath(path, P, pin(P.start));
    if (posToggle) {
      out.position[0] += (a.position[0] - b.position[0]) * weight;
      out.position[1] += (a.position[1] - b.position[1]) * weight;
      out.position[2] += (a.position[2] - b.position[2]) * weight;
    }
  } else if (posToggle) {
    // Absolute: the anchor lands on the path (controls carry path minus
    // base, since the renderer adds the base back), blended by Strength.
    const smp = sampleSplinePath(path, P, place(baseT));
    const bp = vector3(base, [0, 0, 0]);
    out.position[0] += (smp.position[0] - bp[0] - out.position[0]) * weight;
    out.position[1] += (smp.position[1] - bp[1] - out.position[1]) * weight;
    out.position[2] += (smp.position[2] - bp[2] - out.position[2]) * weight;
  }
  if (rotToggle) {
    const smp = sampleSplinePath(path, P, place(baseT));
    const heading = numberValue(readProp(props, "splineHeading", localFrame, 0), 0);
    const pitch = numberValue(readProp(props, "splinePitch", localFrame, 0), 0);
    const bank = numberValue(readProp(props, "splineBank", localFrame, 0), 0);
    out.rotation[0] += (pitch + smp.euler[0]) * weight;
    out.rotation[1] += (heading + smp.euler[1]) * weight;
    out.rotation[2] += (bank + smp.euler[2]) * weight;
  }
}

// Orbit: the selected letters revolve rigidly about their own center in
// the screen plane (glyphs turn with the orbit), so a pair swaps places
// at 180 degrees. Angle animates full revolutions; Radius scales the
// orbit size (0% collapses to the center, single letters spin in place).
// Still in, still out: Angle 0 is the identity.
function evaluateOrbit(props, frame, index, list, base, out, plainLists, aux) {
  if (!numberValue(readProp(props, "orbitEnable", frame, 1), 1)) return;
  const ctx = letterContext(props, "orbit", frame, index, list, plainLists);
  if (!isLetterSelected(ctx.selected, index)) return;
  const weight = applyFieldWeight(ctx.strength, props, "orbit", frame, base);
  if (!(weight > 0)) return;
  const localFrame = frame - ctx.delay;
  // XYZ orbit angles (radians on the wire): the pair tumbles rigidly in
  // 3D — Z swaps side by side, X flips in place along the line, Y swaps
  // with a yaw. Glyphs turn with the orbit on every axis.
  const angle = readVector(props, "orbitAngle", localFrame, [0, 0, 0]);
  const radius = numberValue(readProp(props, "orbitRadius", localFrame, 100), 100) / 100;
  const order = Array.isArray(list.order) && list.order.length ? list.order : [index];
  const own = vector3(base, [0, 0, 0]);
  // Selection center: shared world bases when the run provides them
  // (converted back into this letter's layout space), otherwise the
  // letter's own base (safe: position holds, glyph still spins). Missing
  // entries (unbuilt texts) never drag the center.
  let center = own;
  const shared = aux && Array.isArray(aux.bases) ? aux.bases : null;
  if (shared) {
    let cx = 0;
    let cy = 0;
    let cz = 0;
    let n = 0;
    for (let p = 0; p < order.length; p += 1) {
      const gi = order[p];
      if (!isLetterSelected(ctx.selected, gi)) continue;
      const raw = shared[gi];
      if (!Array.isArray(raw)) continue;
      cx += raw[0];
      cy += raw[1];
      cz += raw[2];
      n += 1;
    }
    if (n > 0) {
      const worldCenter = [cx / n, cy / n, cz / n];
      center = aux && aux.selfWorld ? localBaseOf(worldCenter, aux.selfWorld) : worldCenter;
    }
  }
  const dx = (own[0] - center[0]) * radius;
  const dy = (own[1] - center[1]) * radius;
  const dz = (own[2] - center[2]) * radius;
  const spun = rotateEulerXYZ([dx, dy, dz], angle);
  const target = [center[0] + spun[0], center[1] + spun[1], center[2] + spun[2]];
  out.position[0] += (target[0] - own[0] - out.position[0]) * weight;
  out.position[1] += (target[1] - own[1] - out.position[1]) * weight;
  out.position[2] += (target[2] - own[2] - out.position[2]) * weight;
  out.rotation[0] += angle[0] * weight;
  out.rotation[1] += angle[1] * weight;
  out.rotation[2] += angle[2] * weight;
}

// Twist: ribbon twirl in the letter run — each letter turns about the
// chosen axis proportionally to its rank, centered so the middle holds
// and the ends counter-rotate. Angle is the total end-to-end twirl;
// a lone letter holds (no line to twist across).
function evaluateTwist(props, frame, index, list, base, out, plainLists) {
  if (!numberValue(readProp(props, "twistEnable", frame, 1), 1)) return;
  const ctx = letterContext(props, "twist", frame, index, list, plainLists);
  if (!isLetterSelected(ctx.selected, index)) return;
  const weight = applyFieldWeight(ctx.strength, props, "twist", frame, base);
  if (!(weight > 0)) return;
  const localFrame = frame - ctx.delay;
  const angle = numberValue(readProp(props, "twistAngle", localFrame, 0), 0);
  const axis = Math.round(numberValue(readProp(props, "twistAxis", localFrame, 2), 2));
  const order = Array.isArray(list.order) && list.order.length ? list.order : [index];
  const slots = Math.max(1, order.length);
  const at = order.indexOf(index);
  const twirl = slots > 1 && at !== -1 ? angle * (at / (slots - 1) - 0.5) : 0;
  const ax = axis === 0 ? 0 : axis === 1 ? 1 : 2;
  out.rotation[ax] += twirl * weight;
}

// Wrap: flag wave in the letter run — sine displacement along Direction
// with Frequency cycles across the run and animatable Phase. Upright
// letters (no tilt math); amplitude 0 is the identity.
function evaluateWrap(props, frame, index, list, base, out, plainLists) {
  if (!numberValue(readProp(props, "wrapEnable", frame, 1), 1)) return;
  const ctx = letterContext(props, "wrap", frame, index, list, plainLists);
  if (!isLetterSelected(ctx.selected, index)) return;
  const weight = applyFieldWeight(ctx.strength, props, "wrap", frame, base);
  if (!(weight > 0)) return;
  const localFrame = frame - ctx.delay;
  const amplitude = numberValue(readProp(props, "wrapAmplitude", localFrame, 0), 0);
  const frequency = Math.max(0, numberValue(readProp(props, "wrapFrequency", localFrame, 1), 1));
  const phase = numberValue(readProp(props, "wrapPhase", localFrame, 0), 0);
  const dir = Math.round(numberValue(readProp(props, "wrapDirection", localFrame, 1), 1));
  const order = Array.isArray(list.order) && list.order.length ? list.order : [index];
  const slots = Math.max(1, order.length);
  const at = order.indexOf(index);
  const u = slots > 1 && at !== -1 ? at / (slots - 1) : 0;
  const wave = amplitude * Math.sin(2 * Math.PI * frequency * u + phase);
  const ax = dir === 0 ? 0 : dir === 2 ? 2 : 1;
  out.position[ax] += wave * weight;
}
function rotateAxisX(v, a) {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [v[0], c * v[1] - s * v[2], s * v[1] + c * v[2]];
}

function rotateAxisY(v, a) {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [c * v[0] + s * v[2], v[1], -s * v[0] + c * v[2]];
}

function rotateAxisZ(v, a) {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [c * v[0] - s * v[1], s * v[0] + c * v[1], v[2]];
}

// Layout-space base into world space through a text transform (matches
// the render root application; XYZ convention like the rest).
function worldBaseOf(localBase, world) {
  const l = vector3(localBase, [0, 0, 0]);
  const scaled = [l[0] * world.scale[0], l[1] * world.scale[1], l[2] * world.scale[2]];
  const spun = rotateEulerXYZ(scaled, world.rotation);
  return [world.position[0] + spun[0], world.position[1] + spun[1], world.position[2] + spun[2]];
}

// World-space point back into a text's layout space (inverse transform);
// degenerate zero scales collapse onto the center plane.
function localBaseOf(worldPoint, world) {
  const p = vector3(worldPoint, [0, 0, 0]);
  const dx = p[0] - world.position[0];
  const dy = p[1] - world.position[1];
  const dz = p[2] - world.position[2];
  const unx = rotateAxisX([dx, dy, dz], -world.rotation[0]);
  const uny = rotateAxisY(unx, -world.rotation[1]);
  const unz = rotateAxisZ(uny, -world.rotation[2]);
  return [
    world.scale[0] === 0 ? 0 : unz[0] / world.scale[0],
    world.scale[1] === 0 ? 0 : unz[1] / world.scale[1],
    world.scale[2] === 0 ? 0 : unz[2] / world.scale[2],
  ];
}

// Letter count of a text from layout alone (exact from frame 0, no built

module.exports = { eulerFromBasis, evaluateFormula, evaluateOrbit, evaluatePlain, evaluateRandom, evaluateShake, evaluateSpline, evaluateTwist, evaluateWrap, localBaseOf, randomUnit, rotateAxisX, rotateAxisY, rotateAxisZ, rotateEulerXYZ, sampleSplinePath, worldBaseOf };
