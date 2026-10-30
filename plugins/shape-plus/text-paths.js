"use strict";
const { values } = require("./editor-geometry.js");
function textPaths(item, nextId = (() => { let id = 0; return () => item.id + "-text-" + id++; })()) {
  const contents = [], groups = new Map();
  function add(key, character) {
    const group = { id: nextId(), kind: "group", properties: { name: character, enabled: 1, anchor: [0,0], position: [0,0], scale: [1,1], rotation: 0, opacity: 1 }, contents: [] };
    groups.set(key, group); contents.push(group);
  }
  for (const [line, row] of (item.textLayout?.rows || []).entries()) if (row.visible)
    for (const cluster of row.characters || []) if (!/\s/u.test(cluster.text)) add(line + ":" + cluster.index, cluster.text);
  for (const glyph of item.textLayout?.glyphs || []) {
    if (!glyph.paths.length || /\s/u.test(glyph.character)) continue;
    const key = glyph.line + ":" + glyph.cl;
    if (!groups.has(key)) add(key, glyph.character);
    groups.get(key).contents.push(...glyph.paths.map(path => ({ id: nextId(), kind: "path", vertexIds: path.vertices.map(nextId), properties: { enabled: 1, closed: path.closed ? 1 : 0, path: values(path.vertices) } })));
  }
  return { id: item.id, kind: "group", properties: { name: item.properties.name, enabled: item.properties.enabled, anchor: [0,0], position: [0,0], scale: [1,1], rotation: 0, opacity: 1 }, contents };
}
function expandText(contents) {
  return contents.map(item => item.kind === "text" ? textPaths(item) : item.contents ? { ...item, contents: expandText(item.contents) } : item);
}
function hasText(contents) { return contents.some(item => item.kind === "text" || item.contents && hasText(item.contents)); }
module.exports = { textPaths, expandText, hasText };
