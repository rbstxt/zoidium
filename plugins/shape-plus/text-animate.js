"use strict";
// Per-frame text animator evaluation. Pure over evaluated items: a text item
// with its textLayout plus the evaluated animator items that apply to it.
//
// An animator contributes neutral + (value - neutral) x s per unit, where s
// is the combined selector value (range, then wiggly) for that unit. Several
// animators stack top to bottom: transforms compose as nested per-character
// groups (innermost animator first), while tracking, advance and reshaping
// deltas accumulate additively on glyph positions.
//
// applyAnimators() returns null when nothing contributes, and callers must
// then take exactly the unanimated code path (same output, caches and
// allocations). Reshaped glyphs (Character Offset, variable-axis offsets)
// reuse the engine caches keyed by coordinates or glyph.
const { rangeValues, combine, wigglyValue, numberValue } = require("./text-selectors.js");
const { ANIMATED_KEYS, enabledKey } = require("./text-animator-properties.js");
const { parsePath } = require("./svg-path.js");
const DEG = Math.PI / 180;
const isSpace = text => /\s/u.test(text);
// Skew-aware group matrix shared by live rendering (compiler.js matrix())
// and conversion baking. M = T(position) T(anchor) R(rotation) Sk T(-anchor)
// with Sk = R(axis) Shear(skew) R(-axis) shearing x by tan(skew) in the
// axis frame. Without skew this matches the historical group matrix exactly.
function levelMatrix(p) {
  const a = p.anchor || [0, 0], t = p.position || [0, 0], s = p.scale || [1, 1];
  const c = Math.cos(p.rotation || 0), n = Math.sin(p.rotation || 0);
  const q = Math.tan(p.skew || 0), ca = Math.cos(p.skewAxis || 0), sa = Math.sin(p.skewAxis || 0);
  // R(axis) H R(-axis) with H = [1, q; 0, 1], multiplied out step by step.
  const h00 = ca + q * sa, h01 = -sa + q * ca;
  const sk00 = ca * h00 + sa * sa, sk01 = ca * h01 + sa * ca;
  const sk10 = -sa * h00 + ca * sa, sk11 = -sa * h01 + ca * ca;
  // L = R(rotation) Sk S(scale) with R = [c, -n; n, c].
  const l00 = (c * sk00 - n * sk10) * s[0], l01 = (c * sk01 - n * sk11) * s[1];
  const l10 = (n * sk00 + c * sk10) * s[0], l11 = (n * sk01 + c * sk11) * s[1];
  return [l00, l10, l01, l11, t[0] - (l00 * a[0] + l01 * a[1]), t[1] - (l10 * a[0] + l11 * a[1])];
}
// Collect, for one contents list, the animators applying to each text item:
// animators below the text in the same list (top to bottom), then animators
// inherited from ancestor lists. Animators inside a nested group apply only
// within that group. Disabled animator items are skipped.
function matchAnimators(list, outer = [], out = new Map()) {
  const below = [];
  for (let i = (list || []).length - 1; i >= 0; i--) {
    const item = list[i];
    if (item?.kind === "textAnimator") {
      if (item.properties?.enabled !== 0) below.unshift(item);
    } else if (item?.kind === "text") {
      if (!out.has(item.id)) out.set(item.id, [...below, ...outer]);
    } else if (item?.contents) {
      matchAnimators(item.contents, [...below, ...outer], out);
    }
  }
  return out;
}
// Units for one Based On mode over the whole text item in logical order:
// characters (every grapheme cluster), noSpaces (spaces map to -1 and take
// s = 0), words (spaces map to -1), lines (every glyph counts). Returns the
// unit count and the unit index per layout glyph.
function computeUnits(layout, basedOn) {
  const glyphs = layout?.glyphs || [], rows = layout?.rows || [];
  if (basedOn === "lines") return { count: rows.length, map: glyphs.map(g => g.line) };
  const map = new Array(glyphs.length).fill(-1);
  let count = 0;
  const clusterUnit = new Map();
  for (const [line, row] of rows.entries()) {
    const clusters = row.characters || [];
    if (basedOn === "words") {
      let word = -1, inWord = false;
      for (const cluster of clusters) {
        if (isSpace(cluster.text)) { inWord = false; clusterUnit.set(line + ":" + cluster.index, -1); }
        else {
          if (!inWord) { inWord = true; word = count++; }
          clusterUnit.set(line + ":" + cluster.index, word);
        }
      }
    } else {
      for (const cluster of clusters) {
        if (basedOn === "noSpaces" && isSpace(cluster.text)) clusterUnit.set(line + ":" + cluster.index, -1);
        else clusterUnit.set(line + ":" + cluster.index, count++);
      }
    }
  }
  glyphs.forEach((glyph, i) => {
    const unit = clusterUnit.get(glyph.line + ":" + glyph.cl);
    if (unit !== undefined) map[i] = unit;
  });
  return { count, map };
}
function shiftCodepoint(character, shift) {
  if (!shift || character === undefined) return character;
  const code = character.codePointAt(0);
  const classes = [[97, 26], [65, 26], [48, 10]];
  for (const [base, size] of classes) {
    if (code >= base && code < base + size) return String.fromCodePoint(base + (((code - base + shift) % size) + size) % size);
  }
  return character;
}
function sameCoords(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
// Reshape one glyph at new coordinates and/or a shifted character. Kerning
// (dx/dy) stays from the base shaping; only the advance is replaced.
function reshape(glyph, character, coordinates) {
  const shaped = glyph.font.shape(character, coordinates);
  if (!shaped.length) return null;
  const first = shaped[0];
  const outline = glyph.font.outline(first.g, coordinates);
  const contours = outline.length ? parsePath(outline.map(c => c.type + c.values.join(",")).join("")) : [];
  const paths = contours.map(path => ({ closed: path.closed, vertices: path.vertices.map(v => ({
    point: [v.point[0] * glyph.scaleX + glyph.x, v.point[1] * glyph.scaleY + glyph.y],
    in: [v.in[0] * glyph.scaleX, v.in[1] * glyph.scaleY], out: [v.out[0] * glyph.scaleX, v.out[1] * glyph.scaleY],
  })) }));
  return { ...glyph, character, g: first.g, contours, paths, advance: first.ax * glyph.scaleX, coordinates: { ...coordinates } };
}
function enabledProps(properties) {
  return ANIMATED_KEYS.filter(key => properties[enabledKey(key)] === 1 || properties[enabledKey(key)] === true);
}
function axisTags(properties) {
  return Object.keys(properties || {}).filter(key => key.startsWith("axis_") && (properties[enabledKey(key)] === 1 || properties[enabledKey(key)] === true)).map(key => key.slice(5));
}
function animatorTime(animators, opts) {
  if (opts?.time !== undefined) return numberValue(opts.time, 0);
  for (const animator of animators) {
    const time = animator?.properties?.time;
    if (time !== undefined) return numberValue(time, 0);
  }
  return 0;
}
// Per-glyph combined selector values for one animator: a scalar range value
// and a wiggly value that is scalar for scalar properties (or locked vector
// dimensions) and per-component for unlocked vectors.
function selectorState(animator, layout, time, rangeUnits, wigglyUnits) {
  const p = animator.properties;
  const range = rangeValues({
    selectorUnits: p.selectorUnits, selectorStart: p.selectorStart, selectorEnd: p.selectorEnd,
    selectorOffset: p.selectorOffset, selectorShape: p.selectorShape, selectorAmount: p.selectorAmount,
    selectorEaseHigh: p.selectorEaseHigh, selectorEaseLow: p.selectorEaseLow,
    selectorRandomize: p.selectorRandomize, selectorRandomSeed: p.selectorRandomSeed,
  }, rangeUnits.count);
  let wiggly = null;
  if (p.wigglyOn === 1 || p.wigglyOn === true) {
    const base = {
      wigglyMax: p.wigglyMax, wigglyMin: p.wigglyMin, wigglesPerSecond: p.wigglesPerSecond,
      correlation: p.correlation, temporalPhase: p.temporalPhase, spatialPhase: p.spatialPhase, wigglySeed: p.wigglySeed,
    };
    const units = wigglyUnits.map;
    const at = (component, unit) => unit < 0 ? 0 : wigglyValue({ ...base, component }, unit, time);
    wiggly = { locked: units.map(unit => at(0, unit)), x: units.map(unit => at(1, unit)), y: units.map(unit => at(2, unit)) };
  }
  return { range, wiggly, mode: p.selectorMode || "add", wigglyMode: p.wigglyMode || "add", locked: p.lockDimensions === 1 || p.lockDimensions === true };
}
function applyAnimators(item, animators, opts = {}) {
  const list = (animators || []).filter(a => a?.kind !== "textAnimator" || a.properties?.enabled !== 0);
  const layout = item?.textLayout;
  const glyphs = layout?.glyphs || [];
  if (!list.length || !glyphs.length) return null;
  const actives = list.filter(a => enabledProps(a.properties).length || axisTags(a.properties).length);
  if (!actives.length) return null;
  const time = animatorTime(actives, opts);
  const states = actives.map(animator => {
    const p = animator.properties;
    const rangeUnits = computeUnits(layout, p.selectorBasedOn || "characters");
    const wigglyUnits = (p.wigglyOn === 1 || p.wigglyOn === true) ? computeUnits(layout, p.wigglyBasedOn || "characters") : null;
    return { animator, p, rangeUnits, wigglyUnits, state: selectorState(animator, layout, time, rangeUnits, wigglyUnits || rangeUnits) };
  });
  // Per-glyph scalar (range) value and vector pair per animator.
  const perGlyph = glyphs.map((glyph, i) => states.map(({ state, rangeUnits, wigglyUnits }) => {
    const unit = rangeUnits.map[i] ?? -1;
    const r = unit < 0 ? 0 : combine(state.mode, 0, (state.range[unit] ?? 0));
    if (!state.wiggly) return { scalar: r, vec: [r, r] };
    const unitW = (wigglyUnits.map[i] ?? -1);
    const at = values => unitW < 0 ? 0 : (values[unitW] ?? 0);
    if (state.locked) {
      const s = combine(state.wigglyMode, r, at(state.wiggly.locked));
      return { scalar: s, vec: [s, s] };
    }
    return {
      scalar: combine(state.wigglyMode, r, at(state.wiggly.locked)),
      vec: [combine(state.wigglyMode, r, at(state.wiggly.x)), combine(state.wigglyMode, r, at(state.wiggly.y))],
    };
  }));
  let alive = false;
  for (const row of perGlyph) for (const entry of row) {
    if (entry.scalar !== 0 || entry.vec[0] !== 0 || entry.vec[1] !== 0) { alive = true; break; }
  }
  if (!alive) return null;
  const size = Math.max(0, numberValue(item.properties?.fontSize, 100));
  // Character Offset and variable-axis reshaping, then cumulative advance
  // and tracking shifts per line. Alignment stays as laid out: animator
  // tracking applies after alignment, as in AE.
  const reshaped = glyphs.map((glyph, i) => {
    let shift = 0;
    const base = glyph.font?.coordinates ? glyph.font.coordinates(glyph.coordinates || {}) : { ...(glyph.coordinates || {}) };
    const coords = { ...base };
    let touchesCoords = false;
    perGlyph[i].forEach((entry, a) => {
      const p = states[a].p;
      if (p[enabledKey("charOffset")]) shift += Math.round(numberValue(p.charOffset, 0) * entry.scalar);
      for (const tag of axisTags(p)) {
        const delta = numberValue(p["axis_" + tag], 0) * entry.scalar;
        if (delta !== 0) { coords[tag] = (coords[tag] ?? 0) + delta; touchesCoords = true; }
      }
    });
    const clamped = glyph.font?.coordinates ? glyph.font.coordinates(coords) : coords;
    const character = shiftCodepoint(glyph.character, shift);
    const changedChar = shift !== 0 && character !== glyph.character;
    if (!changedChar && (!touchesCoords || sameCoords(clamped, base))) return glyph;
    if (!glyph.font?.shape || !glyph.font?.outline) return glyph;
    try {
      return reshape(glyph, character, clamped) || glyph;
    } catch (_error) { return glyph; }
  });
  const finalGlyphs = reshaped.map(glyph => ({ ...glyph }));
  const byLine = new Map();
  finalGlyphs.forEach((glyph, i) => {
    if (!byLine.has(glyph.line)) byLine.set(glyph.line, []);
    byLine.get(glyph.line).push(i);
  });
  for (const indices of byLine.values()) {
    let carry = 0;
    for (const i of indices) {
      finalGlyphs[i] = { ...finalGlyphs[i], x: finalGlyphs[i].x + carry };
      let step = (finalGlyphs[i].advance - glyphs[i].advance);
      perGlyph[i].forEach((entry, a) => {
        const p = states[a].p;
        if (p[enabledKey("tracking")]) step += numberValue(p.tracking, 0) * entry.scalar * size / 1000;
      });
      carry += step;
    }
  }
  // Grouping spans on final positions. Character groups use the glyph's
  // advance span; word, line and all groups use the member span and the
  // first baseline of the group.
  const pen = glyph => glyph.x - (glyph.dx || 0) * glyph.scaleX;
  const baseline = glyph => glyph.y - (glyph.dy || 0) * glyph.scaleY;
  const wordUnits = computeUnits({ glyphs: finalGlyphs, rows: layout.rows }, "words");
  function spanOf(members) {
    let left = Infinity, right = -Infinity, firstLine = Infinity, firstBase = 0;
    for (const i of members) {
      const glyph = finalGlyphs[i];
      left = Math.min(left, pen(glyph)); right = Math.max(right, pen(glyph) + glyph.advance);
      if (glyph.line < firstLine) { firstLine = glyph.line; firstBase = baseline(glyph); }
    }
    return { left, right, base: firstBase, width: Math.max(0, right - left) };
  }
  const wordMembers = new Map(), lineMembers = new Map();
  finalGlyphs.forEach((glyph, i) => {
    const word = wordUnits.map[i];
    if (word >= 0) { if (!wordMembers.has(word)) wordMembers.set(word, []); wordMembers.get(word).push(i); }
    if (!lineMembers.has(glyph.line)) lineMembers.set(glyph.line, []);
    lineMembers.get(glyph.line).push(i);
  });
  const allSpan = spanOf(finalGlyphs.map((_, i) => i));
  const sy = numberValue(item.properties?.verticalScale, 100) / 100;
  function metricsOf(glyph) {
    try { if (glyph.font?.metrics) return glyph.font.metrics(); } catch (_error) { /* Fall through. */ }
    return { ascent: glyph.font?.upem || 0, descent: 0 };
  }
  function groupFrame(glyph, i, grouping) {
    if (grouping === "all") return allSpan;
    if (grouping === "line") return spanOf(lineMembers.get(glyph.line) || [i]);
    if (grouping === "word") {
      const word = wordUnits.map[i];
      if (word >= 0 && wordMembers.has(word)) return spanOf(wordMembers.get(word));
    }
    return { left: pen(glyph), right: pen(glyph) + glyph.advance, base: baseline(glyph), width: Math.max(0, glyph.advance) };
  }
  const levels = new Map();
  finalGlyphs.forEach((glyph, i) => {
    const key = glyph.line + ":" + glyph.cl;
    const glyphLevels = [];
    perGlyph[i].forEach((entry, a) => {
      const p = states[a].p;
      const grouping = p.anchorGrouping || "character";
      const frame = groupFrame(glyph, i, grouping);
      const metrics = metricsOf(glyph);
      const unit = size / (glyph.font?.upem || 1) * sy;
      const boxH = (metrics.ascent + metrics.descent) * unit;
      const ref = [(frame.left + frame.right) / 2, frame.base];
      const anchor = [numberValue(p.anchor?.[0], 0) * entry.vec[0], numberValue(p.anchor?.[1], 0) * entry.vec[1]];
      const align = p[enabledKey("groupingAlignment")] ? [numberValue(p.groupingAlignment?.[0], 0) / 100 * frame.width * entry.vec[0], numberValue(p.groupingAlignment?.[1], 0) / 100 * boxH * entry.vec[1]] : [0, 0];
      const pivot = [ref[0] + anchor[0] + align[0], ref[1] + anchor[1] + align[1]];
      const offset = [numberValue(p.position?.[0], 0) * entry.vec[0], numberValue(p.position?.[1], 0) * entry.vec[1]];
      const scale = [1 + (numberValue(p.scale?.[0], 100) / 100 - 1) * entry.vec[0], 1 + (numberValue(p.scale?.[1], 100) / 100 - 1) * entry.vec[1]];
      const rotation = numberValue(p.rotation, 0) * entry.scalar;
      const skew = numberValue(p.skew, 0) * entry.scalar;
      const level = {
        name: states[a].animator.properties?.name,
        anchor: pivot,
        // Group positions are anchor-relative: the pivot stays fixed while
        // the offset translates the rotated, scaled result, as in AE.
        position: [pivot[0] + offset[0], pivot[1] + offset[1]],
        scale,
        rotation,
        skew,
        skewAxis: numberValue(p.skewAxis, 0) * entry.scalar,
      };
      const identity = offset[0] === 0 && offset[1] === 0 && scale[0] === 1 && scale[1] === 1 && rotation === 0 && skew === 0;
      if (!identity) glyphLevels.push(level);
    });
    if (glyphLevels.length && !levels.has(key)) levels.set(key, glyphLevels);
  });
  const changed = finalGlyphs.some((glyph, i) => glyph.x !== glyphs[i].x || glyph.advance !== glyphs[i].advance || glyph.character !== glyphs[i].character || glyph.paths !== glyphs[i].paths);
  if (!levels.size && !changed) return null;
  return { glyphs: finalGlyphs, levels };
}
module.exports = { levelMatrix, matchAnimators, computeUnits, shiftCodepoint, reshape, enabledProps, axisTags, selectorState, applyAnimators };
