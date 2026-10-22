"use strict";
// Pure baking of texture/array kinds. No DOM or WebGL here, so every result
// is deterministic and testable in Node.
const { MAX_PALETTE } = require("./kinds.js");
const SIZE = 256, CURVE_SIZE = 1024;

const clamp01 = v => Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));

// CM3 gradient colors are "rgba(r, g, b, a)" with 0-255 channels (the
// picker writes fractional values) and 0-1 alpha.
function parseColor(text) {
  if (Array.isArray(text)) return [0, 1, 2, 3].map(i => clamp01(Number(text[i] ?? (i === 3 ? 1 : 0))));
  const match = /rgba?\(([^)]*)\)/.exec(String(text));
  const parts = match ? match[1].split(",").map(Number) : [];
  return [clamp01(parts[0] / 255), clamp01(parts[1] / 255), clamp01(parts[2] / 255), parts.length > 3 ? clamp01(parts[3]) : 1];
}

const toLinear = c => c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
const toSrgb = c => c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
function linearToOklab([r, g, b]) {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}
function oklabToLinear([L, a, b]) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
}
const SPACES = {
  srgb: { to: c => c.slice(0, 3), from: c => c },
  linear: { to: c => c.slice(0, 3).map(toLinear), from: c => c.map(toSrgb) },
  oklab: { to: c => linearToOklab(c.slice(0, 3).map(toLinear)), from: c => oklabToLinear(c).map(toSrgb) },
};

function normalizeStops(value) {
  const stops = (Array.isArray(value) ? value : [])
    .map((stop, index) => ({ position: clamp01(Number(stop?.position)), color: parseColor(stop?.color), midpoint: stop?.midpoint, index }))
    .sort((a, b) => a.position - b.position || a.index - b.index);
  return stops.length ? stops : [{ position: 0, color: [1, 1, 1, 1], index: 0 }];
}

// Straight (non-premultiplied) RGBA8, SIZE x 1. Texel i holds t = i / 255,
// matching the zLut() macro.
function bakeGradient(value, options = {}) {
  if (typeof value === "string") { options = { ...parseJSON(value), ...options }; value = options.stops; }
  const stops = normalizeStops(value), space = SPACES[options.space] || SPACES.srgb;
  const mode = ["linear", "constant", "ease", "cardinal"].includes(options.interpolation) ? options.interpolation : "linear";
  const cyclic = !!options.cyclic && stops.length > 1;
  const data = new Uint8Array(SIZE * 4);
  const mixed = stops.map(stop => ({ ...stop, mixed: space.to(stop.color) }));
  function blend(a, b, f, before = a, after = b) {
    f = midpoint(f, a.midpoint);
    if (mode === "constant") f = f < 1 ? 0 : 1;
    else if (mode === "ease") f = f * f * (3 - 2 * f);
    const mix = (p, x, y, n) => mode === "cardinal" ? .5 * (2*x + (-p+y)*f + (2*p-5*x+4*y-n)*f*f + (-p+3*x-3*y+n)*f*f*f) : x + (y-x)*f;
    const c = space.from(a.mixed.map((v, i) => mix(before.mixed[i], v, b.mixed[i], after.mixed[i])));
    return [...c.map(clamp01), clamp01(mix(before.color[3], a.color[3], b.color[3], after.color[3]))];
  }
  for (let i = 0; i < SIZE; i++) {
    const t = i / (SIZE - 1);
    let color;
    const first = mixed[0], last = mixed[mixed.length - 1];
    if (t < first.position || t > last.position) {
      if (!cyclic) color = (t < first.position ? first : last).color;
      else {
        const span = first.position + 1 - last.position;
        const f = span > 0 ? ((t < first.position ? t + 1 : t) - last.position) / span : 0;
        color = blend(last, first, f, mixed[Math.max(0, mixed.length - 2)], mixed[Math.min(1, mixed.length - 1)]);
      }
    } else {
      let index = 0;
      while (index < mixed.length - 2 && t > mixed[index + 1].position) index++;
      const a = mixed[index], b = mixed[Math.min(index + 1, mixed.length - 1)];
      const span = b.position - a.position;
      color = span > 0 ? blend(a, b, (t - a.position) / span, mixed[index > 0 ? index - 1 : cyclic ? mixed.length - 1 : 0], mixed[index + 2 < mixed.length ? index + 2 : cyclic ? 0 : mixed.length - 1]) : (t < b.position ? a : b).color;
    }
    if (Array.isArray(options.opacityStops) && options.opacityStops.length) color[3] = opacityAt(options.opacityStops, t, cyclic, mode);
    for (let c = 0; c < 4; c++) data[i * 4 + c] = Math.round(clamp01(color[c]) * 255);
  }
  return data;
}

// Optional midpoint remapping is identity when omitted, preserving legacy bytes.
function midpoint(t, m = .5) {
  m = clamp01(Number(m));
  if (m === .5 || t <= 0 || t >= 1) return t;
  return t <= m ? .5*t/Math.max(m, 1e-12) : .5+.5*(t-m)/Math.max(1-m, 1e-12);
}
function opacityAt(raw, t, cyclic, mode) {
  const stops = raw.map(s => ({ position: clamp01(Number(s.position)), alpha: clamp01(Number(s.alpha)), midpoint: s.midpoint })).sort((a, b) => a.position-b.position);
  let a = stops[0], b = stops[stops.length-1];
  if (t < a.position || t > b.position) {
    if (!cyclic || stops.length < 2) return (t < a.position ? a : b).alpha;
    [a, b] = [{ ...b, position: b.position-1 }, a]; if (t > b.position) t--;
  } else {
    let i = 0; while (i < stops.length-2 && t > stops[i+1].position) i++;
    a = stops[i]; b = stops[Math.min(i+1, stops.length-1)];
  }
  let f = b.position > a.position ? midpoint((t-a.position)/(b.position-a.position), a.midpoint) : 0;
  if (mode === "constant") f = f < 1 ? 0 : 1;
  else if (mode === "ease") f = f*f*(3-2*f);
  return a.alpha+(b.alpha-a.alpha)*f;
}

// Curve state is the shared Color Curves format. RGB hold the per-channel
// curves applied after the composite curve (zCurves); A holds the composite
// curve alone (zCurve).
function parseCurve(value, curves) {
  const raw = parseJSON(value), state = curves.parseState(raw);
  if (!raw.composite && raw.points) state.composite = curves.parseState({ composite: raw.points }).composite;
  state.alpha = curves.parseState({ composite: raw.alpha }).composite;
  state.channels = raw.channels === "rgba" ? "rgba" : "single";
  state.range = Array.isArray(raw.range) && raw.range.length === 2 && raw.range.every(Number.isFinite) ? raw.range : [0, 1];
  return state;
}
function bakeCurve(value, curves, half = false) {
  const state = parseCurve(value, curves);
  const composite = curves.createSampler(state.composite), red = curves.createSampler(state.red);
  const green = curves.createSampler(state.green), blue = curves.createSampler(state.blue), alpha = curves.createSampler(state.alpha);
  const data = half ? new Float32Array(CURVE_SIZE * 4) : new Uint8Array(CURVE_SIZE * 4);
  for (let i = 0; i < CURVE_SIZE; i++) {
    const x = i / (CURVE_SIZE - 1), common = composite(x);
    const samples = state.channels === "rgba" ? [red(common), green(common), blue(common), alpha(x)] : [common, common, common, common];
    for (let c = 0; c < 4; c++) data[i * 4 + c] = half ? samples[c] : Math.round(clamp01(samples[c]) * 255);
  }
  return data;
}

function parseJSON(value) {
  try { const parsed = JSON.parse(value); return parsed && typeof parsed === "object" ? parsed : {}; } catch { return {}; }
}

function parsePalette(value) {
  const colors = (Array.isArray(parseJSON(value).colors) ? parseJSON(value).colors : [])
    .slice(0, MAX_PALETTE)
    .map(c => [0, 1, 2, 3].map(i => clamp01(Array.isArray(c) ? Number(c[i] ?? (i === 3 ? 1 : 0)) : 0)));
  return { colors };
}

const ALIGN = ["left", "center", "right"];
function parseText(value) {
  const data = parseJSON(value), num = (v, d, lo, hi) => Math.min(hi, Math.max(lo, Number.isFinite(Number(v)) ? Number(v) : d));
  return {
    text: typeof data.text === "string" ? data.text.slice(0, 2000) : "",
    font: typeof data.font === "string" && data.font ? data.font : null,
    size: num(data.size, 128, 4, 512),
    align: ALIGN.includes(data.align) ? data.align : "center",
    lineHeight: num(data.lineHeight, 1.2, 0.5, 4),
    letterSpacing: num(data.letterSpacing, 0, -0.5, 2),
    mode: data.mode === "atlas" ? "atlas" : "layout",
    sdf: data.sdf === true,
  };
}

module.exports = { SIZE, CURVE_SIZE, parseCurve, parseColor, normalizeStops, bakeGradient, bakeCurve, parseJSON, parsePalette, parseText };
