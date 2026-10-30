"use strict";
const { values } = require("./editor-geometry.js");
function textPaths(item, nextId = (() => { let id = 0; return () => item.id + "-text-" + id++; })()) {
  const contents = [];
  for (const glyph of item.textLayout?.glyphs || []) {
    if (!glyph.paths.length || /\s/u.test(glyph.character)) continue;
    contents.push({ id: nextId(), kind: "group", properties: { name: glyph.character, enabled: 1, anchor: [0,0], position: [0,0], scale: [1,1], rotation: 0, opacity: 1 },
      contents: glyph.paths.map(path => ({ id: nextId(), kind: "path", vertexIds: path.vertices.map(nextId), properties: { enabled: 1, closed: path.closed ? 1 : 0, path: values(path.vertices) } })) });
  }
  return { id: item.id, kind: "group", properties: { name: item.properties.name, enabled: item.properties.enabled, anchor: [0,0], position: [0,0], scale: [1,1], rotation: 0, opacity: 1 }, contents };
}
function expandText(contents) {
  return contents.map(item => item.kind === "text" ? textPaths(item) : item.contents ? { ...item, contents: expandText(item.contents) } : item);
}
function hasText(contents) { return contents.some(item => item.kind === "text" || item.contents && hasText(item.contents)); }
module.exports = { textPaths, expandText, hasText };
