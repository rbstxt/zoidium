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
// Member-visit counter for grouping-span work. Tests reset visits to prove
// linear scaling; production code never reads it.
const spanStats = { visits: 0 };
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
// Animator collection shared by every consumer of evaluated lists: the live
// compiler, expandText, and (by ordering) conversion's live-tree walk.
// Below-text siblings apply top to bottom, then animators inherited from
// ancestor lists. Animators inside a nested group apply only within that
// group. Disabled animator items are skipped.
function belowAnimators(list, index) {
  return (list || []).slice(index + 1).filter(item => item?.kind === "textAnimator" && item.properties?.enabled !== 0);
}
function matchAnimators(list, outer = [], out = new Map()) {
  const items = list || [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item?.kind === "text") {
      if (!out.has(item.id)) out.set(item.id, [...belowAnimators(items, i), ...outer]);
    } else if (item?.contents) {
      matchAnimators(item.contents, [...belowAnimators(items, i), ...outer], out);
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
// Whole source text shaped into one glyph. A ligature spans several clusters
// (its glyph carries the first cluster index), so the span runs to the next
// glyph's cluster on the same line, else to the row text end. Falls back to
// the glyph's own character when the row clusters do not cover it.
function clusterText(layout, glyphs, index) {
  const glyph = glyphs[index];
  const row = layout.rows?.[glyph.line];
  const clusters = row?.characters || [];
  let next = Infinity;
  for (let j = 0; j < glyphs.length; j++) {
    const other = glyphs[j];
    if (other.line === glyph.line && other.cl > glyph.cl && other.cl < next) next = other.cl;
  }
  let text = "";
  for (const cluster of clusters) {
    if (cluster.index >= glyph.cl && cluster.index < next) text += cluster.text;
  }
  return text || glyph.character;
}
function shiftCluster(text, shift) {
  if (!shift) return text;
  return Array.from(text, character => shiftCodepoint(character, shift)).join("");
}
// Reshape a whole cluster at new coordinates. The shaped result usually
// keeps the ligature as one glyph; when it does not (shifted cluster text),
// every result glyph's outline is drawn at its shaped offset and the advance
// is their total. The cluster stays anchored by the base shaping: the
// original baked-in dx/dy is replaced, never doubled. Kerning (later
// advances) is recomputed downstream from the new advance.
function reshape(glyph, text, coordinates) {
  const shaped = glyph.font.shape(text, coordinates);
  if (!shaped.length) return null;
  const contours = [], paths = [];
  let pen = 0;
  for (const s of shaped) {
    const outline = glyph.font.outline(s.g, coordinates);
    const parsed = outline.length ? parsePath(outline.map(c => c.type + c.values.join(",")).join("")) : [];
    contours.push(...parsed);
    const baseX = glyph.x + (pen + (s.dx || 0) - (glyph.dx || 0)) * glyph.scaleX;
    const baseY = glyph.y + ((s.dy || 0) - (glyph.dy || 0)) * glyph.scaleY;
    paths.push(...parsed.map(path => ({ closed: path.closed, vertices: path.vertices.map(v => ({
      point: [v.point[0] * glyph.scaleX + baseX, v.point[1] * glyph.scaleY + baseY],
      in: [v.in[0] * glyph.scaleX, v.in[1] * glyph.scaleY], out: [v.out[0] * glyph.scaleX, v.out[1] * glyph.scaleY],
    })) })));
    pen += s.ax;
  }
  return { ...glyph, character: text, g: shaped[0].g, contours, paths, advance: pen * glyph.scaleX, coordinates: { ...coordinates } };
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
    selectorEndIsDefault: p.selectorEndIsDefault,
  }, rangeUnits.count);
  let wiggly = null;
  if (p.wigglyOn === 1 || p.wigglyOn === true) {
    const base = {
      wigglyMax: p.wigglyMax, wigglyMin: p.wigglyMin, wigglesPerSecond: p.wigglesPerSecond,
      correlation: p.correlation, temporalPhase: p.temporalPhase, spatialPhase: p.spatialPhase, wigglySeed: p.wigglySeed,
    };
    const locked = p.lockDimensions === 1 || p.lockDimensions === true;
    const units = wigglyUnits.map;
    const at = (component, unit) => unit < 0 ? 0 : wigglyValue({ ...base, component }, unit, time);
    wiggly = { locked: units.map(unit => at(0, unit)) };
    if (!locked) { wiggly.x = units.map(unit => at(1, unit)); wiggly.y = units.map(unit => at(2, unit)); }
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
  const n = glyphs.length;
  // One units computation per animator: the wiggly count reuses the range
  // count unless its Based On differs.
  const states = actives.map(animator => {
    const p = animator.properties;
    const rangeBasedOn = p.selectorBasedOn || "characters";
    const wigglyBasedOn = p.wigglyBasedOn || "characters";
    const wigglyOn = p.wigglyOn === 1 || p.wigglyOn === true;
    const rangeUnits = computeUnits(layout, rangeBasedOn);
    const wigglyUnits = !wigglyOn || wigglyBasedOn === rangeBasedOn ? rangeUnits : computeUnits(layout, wigglyBasedOn);
    return { animator, p, rangeUnits, wigglyUnits, state: selectorState(animator, layout, time, rangeUnits, wigglyUnits) };
  });
  // Flat per-animator selector values: scalar plus unlocked vector pair.
  // vx/vy alias s when locked or wiggly-free, so no per-glyph objects.
  const values = states.map(({ state, rangeUnits, wigglyUnits }) => {
    const s = new Float64Array(n);
    let vx = s, vy = s;
    if (state.wiggly && !state.locked) { vx = new Float64Array(n); vy = new Float64Array(n); }
    const wMode = state.wigglyMode;
    for (let i = 0; i < n; i++) {
      const unit = rangeUnits.map[i] ?? -1;
      const r = unit < 0 ? 0 : combine(state.mode, 0, (state.range[unit] ?? 0));
      if (!state.wiggly) { s[i] = r; continue; }
      const unitW = wigglyUnits.map[i] ?? -1;
      const at = values => unitW < 0 ? 0 : (values[unitW] ?? 0);
      s[i] = combine(wMode, r, at(state.wiggly.locked));
      if (vx !== s) { vx[i] = combine(wMode, r, at(state.wiggly.x)); vy[i] = combine(wMode, r, at(state.wiggly.y)); }
    }
    return { s, vx, vy };
  });
  let alive = false;
  for (const v of values) {
    for (let i = 0; i < n && !alive; i++) if (v.s[i] !== 0 || v.vx[i] !== 0 || v.vy[i] !== 0) alive = true;
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
    for (let a = 0; a < states.length; a++) {
      const p = states[a].p, scalar = values[a].s[i];
      if (p[enabledKey("charOffset")]) shift += Math.round(numberValue(p.charOffset, 0) * scalar);
      for (const tag of axisTags(p)) {
        const delta = numberValue(p["axis_" + tag], 0) * scalar;
        if (delta !== 0) { coords[tag] = (coords[tag] ?? 0) + delta; touchesCoords = true; }
      }
    }
    if (shift === 0 && !touchesCoords) return glyph;
    // A ligature reshapes as its whole cluster, never as its first character
    // alone, and moves with its first character's selector value (already in
    // scalar). AE breaks ligatures under per-character animation instead.
    const original = clusterText(layout, glyphs, i);
    const shifted = shiftCluster(original, shift);
    const clamped = glyph.font?.coordinates ? glyph.font.coordinates(coords) : coords;
    const changedChar = shift !== 0 && shifted !== original;
    if (!changedChar && sameCoords(clamped, base)) return glyph;
    if (!glyph.font?.shape || !glyph.font?.outline) return glyph;
    try {
      return reshape(glyph, changedChar ? shifted : original, clamped) || glyph;
    } catch (_error) { return glyph; }
  });
  // Glyph objects are reused when nothing reshaped them; the shift pass
  // below copies a glyph on write only when its carry is nonzero.
  const finalGlyphs = reshaped.slice();
  const byLine = new Map();
  finalGlyphs.forEach((glyph, i) => {
    if (!byLine.has(glyph.line)) byLine.set(glyph.line, []);
    byLine.get(glyph.line).push(i);
  });
  for (const indices of byLine.values()) {
    let carry = 0;
    for (const i of indices) {
      let step = (finalGlyphs[i].advance - glyphs[i].advance);
      for (let a = 0; a < states.length; a++) {
        const p = states[a].p;
        if (p[enabledKey("tracking")]) step += numberValue(p.tracking, 0) * values[a].s[i] * size / 1000;
      }
      if (carry !== 0) finalGlyphs[i] = { ...finalGlyphs[i], x: finalGlyphs[i].x + carry };
      carry += step;
    }
  }
  // Grouping spans on final positions. Each span is computed once per unit
  // and shared by every animator, so Line and All groupings cost linear
  // work. Character groups use the glyph's own advance span directly.
  // spanStats counts member visits for the linearity test.
  const pen = glyph => glyph.x - (glyph.dx || 0) * glyph.scaleX;
  const baseline = glyph => glyph.y - (glyph.dy || 0) * glyph.scaleY;
  const kindsUsed = new Set(states.map(({ p }) => p.anchorGrouping || "character"));
  const wordUnits = kindsUsed.has("word") ? computeUnits({ glyphs: finalGlyphs, rows: layout.rows }, "words") : null;
  function spanOf(members) {
    let left = Infinity, right = -Infinity, firstLine = Infinity, firstBase = 0;
    for (const i of members) {
      spanStats.visits++;
      const glyph = finalGlyphs[i];
      left = Math.min(left, pen(glyph)); right = Math.max(right, pen(glyph) + glyph.advance);
      if (glyph.line < firstLine) { firstLine = glyph.line; firstBase = baseline(glyph); }
    }
    return { left, right, base: firstBase, width: Math.max(0, right - left) };
  }
  const wordMembers = new Map(), lineMembers = new Map();
  for (let i = 0; i < n; i++) {
    const glyph = finalGlyphs[i];
    if (wordUnits) {
      const word = wordUnits.map[i];
      if (word >= 0) { if (!wordMembers.has(word)) wordMembers.set(word, []); wordMembers.get(word).push(i); }
    }
    if (kindsUsed.has("line")) {
      if (!lineMembers.has(glyph.line)) lineMembers.set(glyph.line, []);
      lineMembers.get(glyph.line).push(i);
    }
  }
  const wordSpans = new Map(), lineSpans = new Map();
  for (const [word, members] of wordMembers) wordSpans.set(word, spanOf(members));
  for (const [line, members] of lineMembers) lineSpans.set(line, spanOf(members));
  const allSpan = kindsUsed.has("all") ? spanOf(finalGlyphs.map((_, i) => i)) : null;
  const sy = numberValue(item.properties?.verticalScale, 100) / 100;
  function metricsOf(glyph) {
    try { if (glyph.font?.metrics) return glyph.font.metrics(); } catch (_error) { /* Fall through. */ }
    return { ascent: glyph.font?.upem || 0, descent: 0 };
  }
  // Per-glyph vertical box factor, hoisted out of the animator loop.
  const boxOf = finalGlyphs.map(glyph => {
    const metrics = metricsOf(glyph);
    return (metrics.ascent + metrics.descent) * (size / (glyph.font?.upem || 1) * sy);
  });
  function groupFrame(glyph, i, grouping) {
    if (grouping === "all") return allSpan;
    if (grouping === "line") return lineSpans.get(glyph.line) || { left: pen(glyph), right: pen(glyph) + glyph.advance, base: baseline(glyph), width: Math.max(0, glyph.advance) };
    if (grouping === "word" && wordUnits) {
      const word = wordUnits.map[i];
      if (word >= 0 && wordSpans.has(word)) return wordSpans.get(word);
    }
    return { left: pen(glyph), right: pen(glyph) + glyph.advance, base: baseline(glyph), width: Math.max(0, glyph.advance) };
  }
  const levels = new Map();
  finalGlyphs.forEach((glyph, i) => {
    const key = glyph.line + ":" + glyph.cl;
    const glyphLevels = [];
    for (let a = 0; a < states.length; a++) {
      const p = states[a].p, v = values[a];
      const sx = v.vx[i], syy = v.vy[i], scalar = v.s[i];
      const grouping = p.anchorGrouping || "character";
      const frame = groupFrame(glyph, i, grouping);
      const boxH = boxOf[i];
      const ref = [(frame.left + frame.right) / 2, frame.base];
      const anchor = [numberValue(p.anchor?.[0], 0) * sx, numberValue(p.anchor?.[1], 0) * syy];
      const align = p[enabledKey("groupingAlignment")] ? [numberValue(p.groupingAlignment?.[0], 0) / 100 * frame.width * sx, numberValue(p.groupingAlignment?.[1], 0) / 100 * boxH * syy] : [0, 0];
      const pivot = [ref[0] + anchor[0] + align[0], ref[1] + anchor[1] + align[1]];
      const offset = [numberValue(p.position?.[0], 0) * sx, numberValue(p.position?.[1], 0) * syy];
      const scale = [1 + (numberValue(p.scale?.[0], 100) / 100 - 1) * sx, 1 + (numberValue(p.scale?.[1], 100) / 100 - 1) * syy];
      const rotation = numberValue(p.rotation, 0) * scalar;
      const skew = numberValue(p.skew, 0) * scalar;
      const level = {
        name: states[a].animator.properties?.name,
        anchor: pivot,
        // Group positions are anchor-relative: the pivot stays fixed while
        // the offset translates the rotated, scaled result, as in AE.
        position: [pivot[0] + offset[0], pivot[1] + offset[1]],
        scale,
        rotation,
        skew,
        skewAxis: numberValue(p.skewAxis, 0) * scalar,
      };
      const identity = offset[0] === 0 && offset[1] === 0 && scale[0] === 1 && scale[1] === 1 && rotation === 0 && skew === 0;
      if (!identity) glyphLevels.push(level);
    }
    if (glyphLevels.length && !levels.has(key)) levels.set(key, glyphLevels);
  });
  const changed = finalGlyphs.some((glyph, i) => glyph.x !== glyphs[i].x || glyph.advance !== glyphs[i].advance || glyph.character !== glyphs[i].character || glyph.paths !== glyphs[i].paths);
  if (!levels.size && !changed) return null;
  return { glyphs: finalGlyphs, levels };
}
module.exports = { levelMatrix, spanStats, belowAnimators, matchAnimators, computeUnits, shiftCodepoint, clusterText, shiftCluster, reshape, enabledProps, axisTags, selectorState, applyAnimators };
