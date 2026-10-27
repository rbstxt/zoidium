"use strict";

// ExpressText+ Letter selection, strength weights and field falloff.

function numberValue(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function vector3(value, fallback) {
  const base = Array.isArray(fallback) ? fallback : [0, 0, 0];
  if (!Array.isArray(value)) return base.slice();
  return [0, 1, 2].map((index) => numberValue(value[index], base[index]));
}

/* ---------------------------------------------------------- letter selection */

// "1,4,5", "1+2", "1.4.5.", "2-6", "1, 3-5+8" (also full-width
// separators). "+" adds letters like "," does. Tokens like "plain-2" or
// "voronoi-1" take the letters of the 2nd Plain (1st Voronoi) section in
// stack order (one level only, so chains can never loop). 1-based,
// clamped to the letter count, de-duplicated, sorted. Blank means every
// letter (null).
function splitSelectionTokens(value) {
  const text = String(value == null ? "" : value).trim();
  if (!text) return null;
  return text.split(/[,.\u3002\uFF0C\uFF0E\s;|+]+/);
}

function addTokenSelection(picked, token, total) {
  if (!token) return;
  const range = token.split(/[-~\uFF5E]+/);
  if (range.length === 2 && /^\d+$/.test(range[0]) && /^\d+$/.test(range[1])) {
    let from = Math.floor(Number(range[0]));
    let to = Math.floor(Number(range[1]));
    if (from > to) {
      const swap = from;
      from = to;
      to = swap;
    }
    for (let n = from; n <= to; n += 1) {
      if (n >= 1 && n <= total) picked.add(n - 1);
    }
    return;
  }
  if (/^\d+$/.test(token)) {
    const n = Math.floor(Number(token));
    if (n >= 1 && n <= total) picked.add(n - 1);
  }
}

function resolveSelection(value, count, plainLists) {
  const total = Math.max(0, Math.floor(numberValue(count, 0)));
  if (total <= 0) return new Set();
  const tokens = splitSelectionTokens(value);
  if (tokens === null) return null;
  const sections = plainLists && plainLists.sections;
  const picked = new Set();
  for (const token of tokens) {
    const ref = /^([a-z]+)-(\d+)$/i.exec(token);
    if (ref) {
      const kind = ref[1].toLowerCase();
      const n = Math.floor(Number(ref[2])) - 1;
      let src;
      if (sections && Array.isArray(sections[kind])) {
        src = sections[kind][n];
      } else if (kind === "plain") {
        const sources = Array.isArray(plainLists) ? plainLists : [];
        src = sources[n];
      }
      if (typeof src !== "string") continue; // missing section selects nothing
      const sub = resolveSelection(src, total, []);
      if (sub === null) {
        for (let i = 0; i < total; i += 1) picked.add(i);
      } else {
        for (const index of sub) picked.add(index);
      }
      continue;
    }
    addTokenSelection(picked, token, total);
  }
  return picked;
}

function parseLetterSelection(value, count) {
  return resolveSelection(value, count, []);
}

function isLetterSelected(selection, index) {
  return selection === null || selection.has(index);
}

function selectedList(selection, count) {
  const out = [];
  for (let index = 0; index < count; index += 1) {
    if (isLetterSelected(selection, index)) out.push(index);
  }
  return out;
}

// Strength counts 0 to 100 and scales the whole effector.
function strengthWeight(value) {
  return Math.min(100, Math.max(0, numberValue(value, 0))) / 100;
}

/* ------------------------------------------------------------------ fields */

// Smooth falloff edge shared by the finite fields (box/sphere), like a
// field volume in C4D: full strength through most of the volume, then a
// smooth ramp to zero at the boundary so sweeping letters glide in
// instead of popping. d is 0 at the center, 1 at the boundary.
function fieldEdge(d) {
  if (d <= 0.75) return 1;
  if (d >= 1) return 0;
  const u = (d - 0.75) / 0.25;
  return 1 - u * u * (3 - 2 * u);
}

// Field falloff sampled at a letter base position, mirroring the
// deform-framework semantics: 0 infinite (everywhere), 1 linear ramp across
// the field X extent, 2 box (inside only, feathered edge), 3 sphere
// (inside the X radius, feathered edge).
function fieldWeight(kind, point, position, scale) {
  const type = Math.round(numberValue(kind, 0));
  if (type <= 0) return 1;
  const p = vector3(point, [0, 0, 0]);
  const c = vector3(position, [0, 0, 0]);
  const s = vector3(scale, [100, 100, 100]).map((v) =>
    Math.max(0.01, Math.abs(v))
  );
  if (type === 2) {
    return fieldEdge(
      Math.max(
        Math.abs(p[0] - c[0]) / (s[0] / 2),
        Math.abs(p[1] - c[1]) / (s[1] / 2),
        Math.abs(p[2] - c[2]) / (s[2] / 2)
      )
    );
  }
  if (type === 3) {
    const dx = (p[0] - c[0]) / (s[0] / 2);
    const dy = (p[1] - c[1]) / (s[1] / 2);
    const dz = (p[2] - c[2]) / (s[2] / 2);
    return fieldEdge(Math.sqrt(dx * dx + dy * dy + dz * dz));
  }
  const lo = c[0] - s[0] / 2;
  const t = (p[0] - lo) / s[0];
  return Math.min(1, Math.max(0, t));
}

module.exports = { addTokenSelection, fieldEdge, fieldWeight, isLetterSelected, numberValue, parseLetterSelection, resolveSelection, selectedList, splitSelectionTokens, strengthWeight, vector3 };
