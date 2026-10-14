// Algorithm adapted from EffectCraft (MIT OR Apache-2.0).
"use strict";

// Shared deterministic math for the fx-gen native effects (Radio Waves, Beam,
// Numbers, Timecode). Pure functions only: no PZ, THREE, DOM or wall clock, so
// node tests can require this file directly and the effect sources can load it
// through ZoidiumPluginApis.modules.createRequire.

function clamp(value, lo, hi) {
  return value < lo ? lo : value > hi ? hi : value;
}

function toU32(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return ((Math.floor(n) % 4294967296) + 4294967296) % 4294967296;
}

function divEuclid(a, b) {
  return Math.floor(a / b);
}

function remEuclid(a, b) {
  return ((a % b) + b) % b;
}

// Integer hash to [0, 1): EffectCraft util::hash1 / raster::hash_noise.
function hashNoise(x, y, seed) {
  let h = (Math.imul(toU32(x), 0x8da6b343) ^ Math.imul(toU32(y), 0xd8163841) ^ Math.imul(toU32(seed), 0xcb1ab31f)) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0x5bd1e995) >>> 0;
  h ^= h >>> 15;
  return (h & 0x00ffffff) / 16777216;
}

// EffectCraft util::smoothstep (supports edge0 > edge1, unlike raw GLSL).
function smoothstep(e0, e1, x) {
  if (Math.abs(e1 - e0) < 1e-9) return x < e0 ? 0 : 1;
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

function reflect(value, lo, hi) {
  const span = hi - lo;
  if (!(span > 0)) return lo;
  const t = remEuclid(value - lo, 2 * span);
  return lo + (t > span ? 2 * span - t : t);
}

// Radio Waves stroke profile across the stroke, u in [-1, 1].
function rwProfile(kind, u) {
  const c = clamp(u, -1, 1);
  switch (kind) {
    case 1: return (1 - c) * 0.5;
    case 2: return (1 + c) * 0.5;
    case 3: return 1 - Math.abs(c);
    case 4: return Math.cos(c * Math.PI * 0.5);
    case 5: return c < 0 ? 1 + c : 1;
    case 6: return c > 0 ? 1 - c : 1;
    default: return 1;
  }
}

// ---------------------------------------------------------------- Radio Waves

// Live wave table: waves are born at `freq` per second and grow at `expansion`
// px/s for `lifespan` seconds. Closed form in time: no particle history.
// Positions are buffer pixels, y down (EffectCraft buffer convention).
// "Each Frame" semantics: every live wave uses the current parameter values
// (EffectCraft's default Parameters Are Set At value). Only the newest
// `maxWaves` waves are returned (bounded shader loop); oldest first.
function radioWaves(opts) {
  const t = Math.max(0, opts.time);
  const freq = Math.max(0.01, opts.freq);
  const life = Math.max(0.01, opts.lifespan);
  const maxWaves = Math.max(1, Math.floor(opts.maxWaves || 24));
  const w = Math.max(1, opts.bufW);
  const h = Math.max(1, opts.bufH);
  const kHi = Math.floor(t * freq);
  const kLo = Math.max(0, kHi - maxWaves + 1);
  const cx0 = opts.producerX * w;
  const cy0 = opts.producerY * h;
  const dirRad = (opts.directionDeg * Math.PI) / 180;
  const vel = opts.velocity;
  const rot0 = (opts.orientationDeg * Math.PI) / 180;
  const spinRad = (opts.spinDeg * Math.PI) / 180;
  const sinD = Math.sin(dirRad);
  const cosD = Math.cos(dirRad);
  const sw = opts.startWidth;
  const ew = opts.endWidth;
  const expansion = opts.expansion;
  const fadeIn = Math.max(0, opts.fadeIn);
  const fadeOut = Math.max(0, opts.fadeOut);
  const color = opts.color;
  const opacity = opts.opacity;
  const sides = clamp(Math.round(opts.sides), 3, 64);
  const star = Boolean(opts.star);
  const starK = star ? Math.max(0, 1 + clamp(opts.starDepth, -1, 1)) : 0;
  const circle = sides >= 64 && !star;
  const waves = [];
  for (let k = kLo; k <= kHi; k += 1) {
    const born = k / freq;
    const age = t - born;
    if (!(age >= 0 && age < life)) continue;
    let cx = cx0 + sinD * vel * age;
    let cy = cy0 - cosD * vel * age;
    if (opts.reflection) {
      cx = reflect(cx, 0, w);
      cy = reflect(cy, 0, h);
    }
    const fi = fadeIn > 0 ? Math.min(1, age / fadeIn) : 1;
    const fo = fadeOut > 0 ? Math.min(1, (life - age) / fadeOut) : 1;
    waves.push({
      cx,
      cy,
      radius: expansion * age,
      halfWidth: Math.max(((sw + (ew - sw) * (age / life)) * 0.5), 0.25),
      rotation: rot0 + spinRad * age,
      fade: fi * fo,
      opacity,
      r: color[0],
      g: color[1],
      b: color[2],
      a: color.length > 3 ? color[3] : 1,
      sides: circle ? 0 : sides,
      starK,
    });
  }
  return waves;
}

// ---------------------------------------------------------------- Radio outline

function segDistPx(px, py, ax, ay, bx, by) {
  const ex = bx - ax;
  const ey = by - ay;
  const t = clamp(((px - ax) * ex + (py - ay) * ey) / Math.max(ex * ex + ey * ey, 1e-12), 0, 1);
  return Math.hypot(px - (ax + ex * t), py - (ay + ey * t));
}

// Signed distance to a regular polygon (starK == 0) or star outline,
// circumradius R centred at the origin. JS mirror of the polySD function in
// shaders/fx_radiowaves.glsl (dihedral fold into one sector); kept in sync
// with the shader and pinned by tests.
function polySD(dx, dy, R, sides, starK, rot) {
  const r = Math.hypot(dx, dy);
  if (r < 1e-9) return -R;
  const an = Math.PI / sides;
  const theta = Math.atan2(dy, dx) - rot + Math.PI / 2;
  const a = ((theta + an) % (2 * an) + 2 * an) % (2 * an) - an;
  const vx = r * Math.cos(a);
  const vy = Math.abs(r * Math.sin(a));
  const v0x = R;
  const v0y = 0;
  let v1x;
  let v1y;
  if (starK > 0) {
    v1x = starK * R * Math.cos(an);
    v1y = starK * R * Math.sin(an);
  } else {
    v1x = R * Math.cos(2 * an);
    v1y = R * Math.sin(2 * an);
  }
  const d = Math.min(segDistPx(vx, vy, v0x, v0y, v1x, v1y), segDistPx(vx, -vy, v0x, v0y, v1x, v1y));
  const ex = v1x - v0x;
  const ey = v1y - v0y;
  return ex * (vy - v0y) - ey * (vx - v0x) > 0 ? -d : d;
}

// ---------------------------------------------------------------- Beam

// Closed-form beam coverage at buffer pixel (x, y), y down. Ports the
// EffectCraft generate2::beam formula (t0/t1 window, thickness lerp with or
// without 3D perspective, soft edge). Returns { cover, edge01 }.
function beamPixel(x, y, beam) {
  const dx = beam.endX - beam.startX;
  const dy = beam.endY - beam.startY;
  const l2 = Math.max(dx * dx + dy * dy, 1e-9);
  const vx = x + 0.5 - beam.startX;
  const vy = y + 0.5 - beam.startY;
  const tc = clamp((vx * dx + vy * dy) / l2, beam.t0, beam.t1);
  const dist = Math.hypot(x + 0.5 - (beam.startX + dx * tc), y + 0.5 - (beam.startY + dy * tc));
  const tk = beam.persp || beam.t1 - beam.t0 < 1e-9 ? tc : (tc - beam.t0) / (beam.t1 - beam.t0);
  const half = Math.max(((beam.startThick + (beam.endThick - beam.startThick) * tk) * 0.5), 0.25);
  const tt = dist / half;
  let cover = 0;
  if (beam.len > 0) {
    if (beam.soft > 1e-3) cover = 1 - smoothstep(1 - beam.soft, 1, tt);
    else cover = clamp(half - dist + 0.5, 0, 1);
  }
  return { cover, edge01: smoothstep(0, 1, tt) };
}

function beamWindow(lengthPct, timePct) {
  const len = clamp(lengthPct / 100, 0, 1);
  const tm = clamp(timePct / 100, 0, 1);
  const t0 = tm * (1 - len);
  return { len, t0, t1: t0 + len };
}

// ---------------------------------------------------------------- Numbers

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MONTHS_SHORT = MONTHS.map((m) => m.slice(0, 3));
const DAYS = ["Saturday", "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];

// Proleptic Gregorian date from a day count since 2000-01-01 (a Saturday).
function dateFromDays(days) {
  const z = days + 730425;
  const era = divEuclid(z, 146097);
  const doe = remEuclid(z, 146097);
  const yoe = divEuclid(doe - divEuclid(doe, 1460) + divEuclid(doe, 36524) - divEuclid(doe, 146096), 365);
  const y = yoe + era * 400;
  const doy = doe - (365 * yoe + divEuclid(yoe, 4) - divEuclid(yoe, 100));
  const mp = divEuclid(5 * doy + 2, 153);
  const d = doy - divEuclid(153 * mp + 2, 5) + 1;
  const m = mp < 10 ? mp + 3 : mp - 9;
  const year = m <= 2 ? y + 1 : y;
  return { year, month: m, day: d, weekday: remEuclid(days, 7) };
}

function pad2(n) {
  const s = String(Math.abs(n));
  return s.length >= 2 ? s : "0" + s;
}

function timecodeString(frames, fps) {
  const fr = Math.max(1, Math.round(fps));
  const neg = frames < 0;
  const f = Math.abs(Math.round(frames));
  const s = `${pad2(divEuclid(f, fr * 3600))}:${pad2(remEuclid(divEuclid(f, fr * 60), 60))}:${pad2(remEuclid(divEuclid(f, fr), 60))}:${pad2(remEuclid(f, fr))}`;
  return neg ? `-${s}` : s;
}

// SMPTE drop-frame label for nominal 30/60 fps rates.
function dropFrame(frames, nominal) {
  const drop = Math.floor(nominal / 15);
  const perMin = nominal * 60 - drop;
  const per10 = perMin * 10 + drop;
  const f = Math.max(0, Math.round(frames));
  const d = divEuclid(f, per10);
  const m = remEuclid(f, per10);
  const adj = m > drop ? f + drop * 9 * d + drop * divEuclid(m - drop, perMin) : f + drop * 9 * d;
  return `${pad2(divEuclid(adj, nominal * 3600))};${pad2(remEuclid(divEuclid(adj, nominal * 60), 60))};${pad2(remEuclid(divEuclid(adj, nominal), 60))};${pad2(remEuclid(adj, nominal))}`;
}

// Full Numbers string. timeSec is the deterministic layer/project time in
// seconds (replaces AE's wall-clock "Current Time/Date"); fps is the project
// rate; frame is derived as floor(timeSec * fps) for Random Values.
function numbersText(opts) {
  const kind = opts.type;
  const dp = clamp(Math.round(opts.decimalPlaces), 0, 10);
  const fps = opts.fps > 0 ? opts.fps : 30;
  let v = opts.value;
  if (opts.randomValues) {
    const frame = Math.floor(opts.timeSec * fps);
    v = hashNoise(frame, 17, opts.seed || 0) * opts.value;
  }
  const t = opts.currentTime ? opts.timeSec + v : v;
  switch (kind) {
    case 1: {
      const s = Math.abs(v).toFixed(dp);
      const dot = s.indexOf(".");
      const ip = dot < 0 ? s : s.slice(0, dot);
      const fp = dot < 0 ? "" : s.slice(dot);
      return (v < 0 ? "-" : "") + ip.padStart(5, "0") + fp;
    }
    case 2:
    case 3:
    case 4: {
      const rfps = [30, 25, 24][kind - 2];
      return timecodeString(Math.floor(t * rfps + 1e-6), rfps);
    }
    case 5: {
      const s = Math.floor(t);
      const a = Math.abs(s);
      return `${s < 0 ? "-" : ""}${pad2(divEuclid(a, 3600))}:${pad2(remEuclid(divEuclid(a, 60), 60))}:${pad2(remEuclid(a, 60))}`;
    }
    case 6:
    case 7:
    case 8: {
      const dt = dateFromDays(Math.floor(v));
      if (kind === 6) return `${pad2(dt.month)}/${pad2(dt.day)}/${pad2(remEuclid(dt.year, 100))}`;
      if (kind === 7) return `${MONTHS_SHORT[dt.month - 1]} ${dt.day}, ${dt.year}`;
      return `${DAYS[dt.weekday]}, ${MONTHS[dt.month - 1]} ${dt.day}, ${dt.year}`;
    }
    case 9: {
      const i = Math.round(v);
      return i < 0 ? `-${(-i).toString(16).toUpperCase()}` : i.toString(16).toUpperCase();
    }
    default:
      return (opts.currentTime ? t : v).toFixed(dp);
  }
}

// Timecode string. source: 0 layer, 1 composition, 2 custom. timeSec/fps are
// the project clock; custom adds startingFrame at timeUnits fps.
function timecodeText(opts) {
  const src = opts.timeSource;
  let t = opts.timeSec;
  let fps = opts.fps > 0 ? opts.fps : 30;
  if (src === 2) fps = Math.max(1, opts.timeUnits);
  let frame = Math.floor(t * fps + 1e-6);
  if (src === 2) frame += Math.round(opts.startingFrame);
  const fmt = opts.displayFormat;
  if (fmt === 1) return String(frame);
  if (fmt === 2) return `${divEuclid(frame, 16)}+${pad2(remEuclid(frame, 16))}`;
  if (fmt === 3) return `${divEuclid(frame, 40)}+${pad2(remEuclid(frame, 40))}`;
  const nominal = Math.round(fps);
  if (opts.dropFrame && (nominal === 30 || nominal === 60)) return dropFrame(frame, nominal);
  return timecodeString(frame, fps);
}

// ---------------------------------------------------------------- Stroke font

// Original single-stroke glyphs on a 4 x 6 grid (y down, baseline at 6):
// polylines of [x, y] points. Lowercase maps to uppercase.
const GLYPHS = {
  "0": [[[0.5, 1], [1, 0.5], [3, 0.5], [3.5, 1], [3.5, 5], [3, 5.5], [1, 5.5], [0.5, 5], [0.5, 1]]],
  "1": [[[1, 1], [2, 0.2], [2, 5.8]], [[1, 5.8], [3, 5.8]]],
  "2": [[[0.5, 1], [1.5, 0.2], [3, 0.5], [3.5, 1.5], [2.5, 3.5], [0.5, 5.8], [3.5, 5.8]]],
  "3": [[[0.5, 0.5], [3.5, 0.5], [3.5, 5.5], [0.5, 5.5]], [[1, 3], [3.5, 3]]],
  "4": [[[0.5, 0.5], [0.5, 3], [3.5, 3]], [[2.8, 0.2], [2.8, 5.8]]],
  "5": [[[3.5, 0.5], [0.5, 0.5], [0.5, 2.8], [3, 2.8], [3.5, 3.5], [3.5, 5], [3, 5.5], [0.5, 5.5]]],
  "6": [[[3.2, 0.5], [1, 0.8], [0.5, 2], [0.5, 5], [1, 5.5], [3, 5.5], [3.5, 5], [3.5, 3.8], [3, 3], [0.5, 3]]],
  "7": [[[0.5, 0.5], [3.5, 0.5], [2, 5.8]]],
  "8": [[[0.5, 0.5], [3.5, 0.5], [3.5, 5.5], [0.5, 5.5], [0.5, 0.5]], [[0.5, 3], [3.5, 3]]],
  "9": [[[0.5, 5.5], [3, 5.2], [3.5, 4], [3.5, 1], [3, 0.5], [1, 0.5], [0.5, 1], [0.5, 2.5], [1, 3], [3.5, 3]]],
  "A": [[[0.2, 5.8], [2, 0.2], [3.8, 5.8]], [[1, 4], [3, 4]]],
  "B": [[[0.5, 0.5], [0.5, 5.8]], [[0.5, 0.5], [2.8, 0.5], [3.5, 1.2], [3.5, 2.3], [2.8, 3], [0.5, 3]], [[0.5, 3], [2.8, 3], [3.5, 3.7], [3.5, 5], [2.8, 5.8], [0.5, 5.8]]],
  "C": [[[3.5, 1.2], [2.8, 0.5], [1.2, 0.5], [0.5, 1.5], [0.5, 4.8], [1.2, 5.8], [2.8, 5.8], [3.5, 5]]],
  "D": [[[0.5, 0.5], [0.5, 5.8], [2.2, 5.8], [3.5, 4.5], [3.5, 1.8], [2.2, 0.5], [0.5, 0.5]]],
  "E": [[[3.5, 0.5], [0.5, 0.5], [0.5, 5.8], [3.5, 5.8]], [[0.5, 3], [3, 3]]],
  "F": [[[3.5, 0.5], [0.5, 0.5], [0.5, 5.8]], [[0.5, 3], [3, 3]]],
  "G": [[[3.5, 1.2], [2.8, 0.5], [1.2, 0.5], [0.5, 1.5], [0.5, 4.8], [1.2, 5.8], [2.8, 5.8], [3.5, 5], [3.5, 3.8], [2.2, 3.8]]],
  "H": [[[0.5, 0.5], [0.5, 5.8]], [[3.5, 0.5], [3.5, 5.8]], [[0.5, 3], [3.5, 3]]],
  "I": [[[1, 0.5], [3, 0.5]], [[2, 0.5], [2, 5.8]], [[1, 5.8], [3, 5.8]]],
  "J": [[[3.5, 0.5], [3.5, 4.8], [2.8, 5.8], [1.2, 5.8], [0.5, 5]]],
  "K": [[[0.5, 0.5], [0.5, 5.8]], [[3.5, 0.5], [0.5, 3.5]], [[1.5, 2.8], [3.5, 5.8]]],
  "L": [[[0.5, 0.5], [0.5, 5.8], [3.5, 5.8]]],
  "M": [[[0.5, 5.8], [0.5, 0.5], [2, 3], [3.5, 0.5], [3.5, 5.8]]],
  "N": [[[0.5, 5.8], [0.5, 0.5], [3.5, 5.8], [3.5, 0.5]]],
  "O": [[[1.2, 0.5], [2.8, 0.5], [3.5, 1.5], [3.5, 4.8], [2.8, 5.8], [1.2, 5.8], [0.5, 4.8], [0.5, 1.5], [1.2, 0.5]]],
  "P": [[[0.5, 5.8], [0.5, 0.5], [2.8, 0.5], [3.5, 1.2], [3.5, 2.3], [2.8, 3], [0.5, 3]]],
  "Q": [[[1.2, 0.5], [2.8, 0.5], [3.5, 1.5], [3.5, 4.8], [2.8, 5.8], [1.2, 5.8], [0.5, 4.8], [0.5, 1.5], [1.2, 0.5]], [[2.2, 4], [3.8, 6]]],
  "R": [[[0.5, 5.8], [0.5, 0.5], [2.8, 0.5], [3.5, 1.2], [3.5, 2.3], [2.8, 3], [0.5, 3]], [[2, 3], [3.5, 5.8]]],
  "S": [[[3.5, 1.2], [2.8, 0.5], [1.2, 0.5], [0.5, 1.2], [0.5, 2.2], [1.2, 3], [2.8, 3], [3.5, 3.8], [3.5, 5], [2.8, 5.8], [1.2, 5.8], [0.5, 5]]],
  "T": [[[0.5, 0.5], [3.5, 0.5]], [[2, 0.5], [2, 5.8]]],
  "U": [[[0.5, 0.5], [0.5, 4.8], [1.2, 5.8], [2.8, 5.8], [3.5, 4.8], [3.5, 0.5]]],
  "V": [[[0.5, 0.5], [2, 5.8], [3.5, 0.5]]],
  "W": [[[0.5, 0.5], [1.2, 5.8], [2, 2.8], [2.8, 5.8], [3.5, 0.5]]],
  "X": [[[0.5, 0.5], [3.5, 5.8]], [[3.5, 0.5], [0.5, 5.8]]],
  "Y": [[[0.5, 0.5], [2, 3], [3.5, 0.5]], [[2, 3], [2, 5.8]]],
  "Z": [[[0.5, 0.5], [3.5, 0.5], [0.5, 5.8], [3.5, 5.8]]],
  ":": [[[2, 2.2]], [[2, 5]]],
  ";": [[[2, 2.2]], [[2, 4.6], [1.4, 5.8]]],
  ".": [[[2, 5.4]]],
  ",": [[[2, 4.8], [1.4, 6]]],
  "-": [[[1, 3.2], [3, 3.2]]],
  "+": [[[0.7, 3.2], [3.3, 3.2]], [[2, 1.8], [2, 4.6]]],
  "/": [[[3.5, 0.2], [0.5, 6]]],
  "(": [[[2.8, 0], [1.4, 1.5], [1.4, 4.8], [2.8, 6.2]]],
  ")": [[[1.2, 0], [2.6, 1.5], [2.6, 4.8], [1.2, 6.2]]],
  "'": [[[2, 0.2], [2, 1.6]]],
  "\"": [[[1.4, 0.2], [1.4, 1.4]], [[2.6, 0.2], [2.6, 1.4]]],
  "!": [[[2, 0.5], [2, 3.8]], [[2, 5.4]]],
  "?": [[[0.8, 1.2], [1.5, 0.5], [2.8, 0.5], [3.5, 1.2], [3.5, 2], [2, 3.2], [2, 4]], [[2, 5.4]]],
  "%": [[[0.5, 5.5], [3.5, 0.8]], [[0.8, 1]], [[3.2, 5.2]]],
  "=": [[[0.7, 2.4], [3.3, 2.4]], [[0.7, 4.2], [3.3, 4.2]]],
  "_": [[[0.3, 6], [3.7, 6]]],
  "*": [[[2, 1.2], [2, 4]], [[0.9, 1.9], [3.1, 3.3]], [[3.1, 1.9], [0.9, 3.3]]],
  "<": [[[3, 1.2], [1, 3.2], [3, 5.2]]],
  ">": [[[1, 1.2], [3, 3.2], [1, 5.2]]],
  "#": [[[1.4, 0.5], [1.1, 5.8]], [[2.9, 0.5], [2.6, 5.8]], [[0.4, 2.2], [3.6, 2.2]], [[0.4, 4.2], [3.6, 4.2]]],
  "$": [[[3.3, 1.2], [2.6, 0.6], [1.4, 0.6], [0.7, 1.4], [1.4, 2.8], [2.6, 3.2], [3.3, 4], [2.6, 5.6], [1.4, 5.6], [0.7, 5]], [[2, 0], [2, 6.2]]],
};

function glyphStrokes(ch) {
  if (ch === " ") return [];
  const g = GLYPHS[ch.toUpperCase()];
  return g || [];
}

// Advance width in grid units (glyph ink + 1.6 side bearing).
function glyphAdvance(ch, proportional) {
  if (ch === " ") return 3.0;
  if (!proportional) return 5.6;
  const strokes = glyphStrokes(ch);
  let lo = Infinity;
  let hi = -Infinity;
  for (const s of strokes) {
    for (const q of s) {
      if (q[0] < lo) lo = q[0];
      if (q[0] > hi) hi = q[0];
    }
  }
  if (!(lo <= hi)) return 3.0;
  return hi - lo + 1.6;
}

function glyphInkLeft(ch, proportional) {
  if (!proportional) return 0.8;
  let lo = Infinity;
  for (const s of glyphStrokes(ch)) {
    for (const q of s) {
      if (q[0] < lo) lo = q[0];
    }
  }
  return Math.min(lo === Infinity ? 4.0 : lo, 4.0) - 0.8;
}

function textUnit(sizePx) {
  return (sizePx * 0.7) / 6;
}

function textWeight(sizePx) {
  return Math.max(sizePx * 0.045, 0.35);
}

function lineWidth(text, sizePx, trackingPx, proportional) {
  const u = textUnit(sizePx);
  const chars = Array.from(text);
  const n = chars.length;
  if (n === 0) return 0;
  let sum = 0;
  for (const c of chars) sum += glyphAdvance(c, proportional) * u;
  return sum + trackingPx * (n - 1) - 1.6 * u;
}

// Polylines (buffer px) of one line; origin is the baseline start.
function layoutLine(text, originX, originY, sizePx, trackingPx, proportional) {
  const u = textUnit(sizePx);
  const out = [];
  let x = originX;
  for (const c of Array.from(text)) {
    const left = glyphInkLeft(c, proportional);
    for (const s of glyphStrokes(c)) {
      out.push(s.map((q) => [x + (q[0] - left - 0.8) * u, originY + (q[1] - 6) * u]));
    }
    x += glyphAdvance(c, proportional) * u + trackingPx;
  }
  return out;
}

// Coverage of round-capped segments (EffectCraft generate3::raster_segs with
// hardness 1): max-combined, 1 inside, smooth falloff over +-0.5 px.
function rasterSegs(w, h, segs, r) {
  const out = new Float32Array(w * h);
  if (w === 0 || h === 0 || segs.length === 0) return out;
  const buckets = new Array(h);
  for (let y = 0; y < h; y += 1) buckets[y] = [];
  for (let i = 0; i < segs.length; i += 1) {
    const s = segs[i];
    const pad = s.r + 1;
    const y0 = Math.max(0, Math.floor(Math.min(s.a[1], s.b[1]) - pad));
    const y1 = Math.min(h, Math.ceil(Math.max(s.a[1], s.b[1]) + pad));
    for (let y = y0; y < y1; y += 1) buckets[y].push(i);
  }
  const inner = r - 0.5;
  const outer = r + 0.5;
  for (let y = 0; y < h; y += 1) {
    const list = buckets[y];
    if (list.length === 0) continue;
    const py = y + 0.5;
    const row = y * w;
    for (let li = 0; li < list.length; li += 1) {
      const s = segs[list[li]];
      const pad = s.r + 1;
      const x0 = Math.max(0, Math.floor(Math.min(s.a[0], s.b[0]) - pad));
      const x1 = Math.min(w, Math.ceil(Math.max(s.a[0], s.b[0]) + pad));
      const dx = s.b[0] - s.a[0];
      const dy = s.b[1] - s.a[1];
      const l2 = dx * dx + dy * dy;
      for (let x = x0; x < x1; x += 1) {
        const px = x + 0.5;
        let tt = 0;
        if (l2 > 1e-12) tt = clamp(((px - s.a[0]) * dx + (py - s.a[1]) * dy) / l2, 0, 1);
        const ex = px - s.a[0] - dx * tt;
        const ey = py - s.a[1] - dy * tt;
        const d = Math.sqrt(ex * ex + ey * ey);
        if (d >= outer) continue;
        const c = (d <= inner ? 1 : 1 - smoothstep(inner, outer, d)) * s.v;
        const idx = row + x;
        if (c > out[idx]) out[idx] = c;
      }
    }
  }
  return out;
}

function polySegs(pts, r, v, out) {
  if (pts.length === 1) {
    out.push({ a: pts[0], b: pts[0], r, v });
    return;
  }
  for (let i = 0; i + 1 < pts.length; i += 1) {
    out.push({ a: pts[i], b: pts[i + 1], r, v });
  }
}

// Fill + stroke-ring coverage of text polylines. strokeW <= 0 disables the ring.
function textCoverage(w, h, polys, r, strokeW) {
  const fillSegs = [];
  for (const pl of polys) polySegs(pl, Math.max(r, 0.05), 1, fillSegs);
  const fill = rasterSegs(w, h, fillSegs, Math.max(r, 0.05));
  let ring = null;
  if (strokeW > 0) {
    const outerSegs = [];
    for (const pl of polys) polySegs(pl, Math.max(r + strokeW * 0.5, 0.05), 1, outerSegs);
    const outer = rasterSegs(w, h, outerSegs, r + strokeW * 0.5);
    let inner = null;
    if (r - strokeW * 0.5 > 0.05) {
      const innerSegs = [];
      for (const pl of polys) polySegs(pl, r - strokeW * 0.5, 1, innerSegs);
      inner = rasterSegs(w, h, innerSegs, r - strokeW * 0.5);
    }
    ring = new Float32Array(w * h);
    for (let i = 0; i < ring.length; i += 1) {
      ring[i] = Math.max(0, outer[i] - (inner ? inner[i] : 0));
    }
  }
  return { fill, ring };
}

// CPU text layer: an RGBA coverage texture (R = fill, G = stroke ring)
// over the full buffer grid, rebuilt only when the text signature changes.
// Rows are uploaded flipped (image row 0 at the texture top) so the shader
// samples it with plain vUv. Coverage values are analytic (rasterSegs), so
// every machine rasterises identical bytes; `opacity` is baked in.
function createTextLayer(THREE) {
  const layer = {
    texture: null,
    w: 0,
    h: 0,
    key: null,
    ensure(w, h, fill, ring, opacity) {
      if (!(w > 0 && h > 0)) return null;
      if (!layer.texture || layer.w !== w || layer.h !== h) {
        if (layer.texture) layer.texture.dispose();
        const data = new Uint8Array(w * h * 4);
        layer.texture = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.UnsignedByteType);
        layer.texture.minFilter = THREE.LinearFilter;
        layer.texture.magFilter = THREE.LinearFilter;
        layer.texture.wrapS = THREE.ClampToEdgeWrapping;
        layer.texture.wrapT = THREE.ClampToEdgeWrapping;
        layer.texture.generateMipmaps = false;
        layer.texture.needsUpdate = true;
        layer.w = w;
        layer.h = h;
      }
      const data = layer.texture.image.data;
      const op = clamp(opacity, 0, 1);
      for (let y = 0; y < h; y += 1) {
        const srcRow = y * w;
        const dstRow = (h - 1 - y) * w;
        for (let x = 0; x < w; x += 1) {
          const o = (dstRow + x) * 4;
          data[o] = Math.round(clamp(fill[srcRow + x] * op, 0, 1) * 255);
          data[o + 1] = ring ? Math.round(clamp(ring[srcRow + x] * op, 0, 1) * 255) : 0;
          data[o + 2] = 0;
          data[o + 3] = 255;
        }
      }
      layer.texture.needsUpdate = true;
      return layer.texture;
    },
    dispose() {
      if (layer.texture) layer.texture.dispose();
      layer.texture = null;
      layer.w = 0;
      layer.h = 0;
      layer.key = null;
    },
  };
  return layer;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    clamp,
    hashNoise,
    smoothstep,
    reflect,
    rwProfile,
    radioWaves,
    beamPixel,
    beamWindow,
    polySD,
    dateFromDays,
    timecodeString,
    dropFrame,
    numbersText,
    timecodeText,
    glyphStrokes,
    glyphAdvance,
    lineWidth,
    layoutLine,
    rasterSegs,
    textCoverage,
    textUnit,
    textWeight,
    createTextLayer,
    MONTHS,
    DAYS,
  };
}
