"use strict";
const { values } = require("./editor-geometry.js");
const { matchAnimators, applyAnimators } = require("./text-animate.js");
// One animated-expansion helper shared by the live compiler, expandText,
// and conversion: null when the animators contribute nothing, so callers
// keep the exact unanimated path.
function expandAnimatedText(item, animators, nextId) {
  const animation = (animators || []).length ? applyAnimators(item, animators) : null;
  if (!animation) return null;
  return textPaths(item, nextId, animation);
}
function textPaths(item, nextId = (() => { let id = 0; return () => item.id + "-text-" + id++; })(), animation = null) {
  const layoutGlyphs = animation?.glyphs || item.textLayout?.glyphs || [];
  const levels = animation?.levels;
  const contents = [], groups = new Map();
  function add(key, character) {
    const group = { id: nextId(), kind: "group", properties: { name: character, enabled: 1, anchor: [0,0], position: [0,0], scale: [1,1], rotation: 0, opacity: 1 }, contents: [] };
    let host = group;
    // Stacked animators nest innermost-first so each level transforms about
    // its own pivot, exactly as AE stacks Animator 1, Animator 2, and so on.
    for (const level of levels?.get(key) || []) {
      host = { id: nextId(), kind: "group", properties: { name: level.name || character, enabled: 1, anchor: level.anchor.slice(), position: level.position.slice(), scale: level.scale.slice(), rotation: level.rotation, skew: level.skew, skewAxis: level.skewAxis, opacity: 1 }, contents: [host] };
    }
    groups.set(key, group); contents.push(host);
  }
  for (const [line, row] of (item.textLayout?.rows || []).entries()) if (row.visible)
    for (const cluster of row.characters || []) if (!/\s/u.test(cluster.text)) add(line + ":" + cluster.index, cluster.text);
  for (const glyph of layoutGlyphs) {
    if (!glyph.paths.length || /\s/u.test(glyph.character)) continue;
    const key = glyph.line + ":" + glyph.cl;
    if (!groups.has(key)) add(key, glyph.character);
    groups.get(key).contents.push(...glyph.paths.map(path => ({ id: nextId(), kind: "path", vertexIds: path.vertices.map(nextId), properties: { enabled: 1, closed: path.closed ? 1 : 0, path: values(path.vertices) } })));
  }
  return { id: item.id, kind: "group", properties: { name: item.properties.name, enabled: item.properties.enabled, anchor: [0,0], position: [0,0], scale: [1,1], rotation: 0, opacity: 1 }, contents };
}
function expandText(contents) {
  const matches = matchAnimators(contents);
  const expand = list => list.map(item => {
    if (item.kind === "text") return expandAnimatedText(item, matches.get(item.id) || []) || textPaths(item);
    return item.contents ? { ...item, contents: expand(item.contents) } : item;
  });
  return expand(contents);
}
function hasText(contents) { return contents.some(item => item.kind === "text" || item.contents && hasText(item.contents)); }
module.exports = { textPaths, expandText, expandAnimatedText, hasText };
