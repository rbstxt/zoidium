"use strict";
const { textPaths } = require("./text-paths.js");
const { applyAnimators, levelMatrix } = require("./text-animate.js");
function multiply(a, b) {
  return [
    a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}
const IDENTITY = [1, 0, 0, 1, 0, 0];
const applyPoint = (p, m) => [m[0] * p[0] + m[2] * p[1] + m[4], m[1] * p[0] + m[3] * p[1] + m[5]];
const applyOffset = (p, m) => [m[0] * p[0] + m[2] * p[1], m[1] * p[0] + m[3] * p[1]];
// Bake nested animator level groups into flat character groups: every level
// matrix composes into the path vertices, so the converted paths freeze the
// displayed frame with ordinary editable properties only.
function bakeGroups(nodes) {
  const groups = [];
  function walk(node, matrix, name) {
    if (node.kind === "path") {
      const flat = node.properties.path, vertices = [];
      for (let i = 0; i < node.vertexIds.length; i++) {
        const point = applyPoint(flat.slice(i * 6, i * 6 + 2), matrix);
        vertices.push(...point, ...applyOffset(flat.slice(i * 6 + 2, i * 6 + 4), matrix), ...applyOffset(flat.slice(i * 6 + 4, i * 6 + 6), matrix));
      }
      return { ...node, properties: { ...node.properties, path: vertices } };
    }
    const children = node.contents || [];
    const nested = multiply(matrix, levelMatrix(node.properties));
    // Character groups hold only paths (possibly none for ligature
    // remainders, which keep their named empty groups). Level groups hold
    // exactly one nested group each and dissolve into the bake.
    if (children.every(child => child.kind === "path")) {
      groups.push({ id: node.id, kind: "group", properties: { name: node.properties?.name || name, enabled: 1 }, contents: children.map(child => walk(child, nested)) });
      return;
    }
    for (const child of children) walk(child, nested, child.properties?.name || name);
  }
  for (const node of nodes) {
    if (node.kind === "path") groups.push(node);
    else walk(node, IDENTITY, node.properties?.name);
  }
  return groups;
}
function toNative(groups) {
  return groups.map(group => ({
    id: group.id, kind: "group", properties: { name: group.properties.name, enabled: group.properties.enabled },
    contents: group.contents.map(path => ({ ...path, properties: { enabled: 1, closed: path.properties.closed,
      path: { animated: false, keyframes: [{ frame: 0, value: path.properties.path, tween: 1 }] } } })),
  }));
}
function createShapes(evaluated, nextId, animators = []) {
  if (evaluated.kind !== "text") throw Error("Select a Text item to create shapes.");
  if (!evaluated.textLayout) throw Error("The text font is not ready.");
  const animation = animators.length ? applyAnimators(evaluated, animators) : null;
  const expanded = textPaths(evaluated, nextId, animation);
  return toNative(bakeGroups(expanded.contents));
}
async function convert(context, layer, item, Content, frame) {
  const editor = context.editor || window.CM, project = editor.project;
  const address = layer.getAddress(), itemId = item.id;
  await item.prepare(frame);
  if (editor.project !== project || item.textState?.state !== "ready") throw Error(item.textState?.message || "The text font is not ready.");
  const { clone, validate } = require("./model.js"), { find } = require("./editor-tree-data.js");
  const { replaceContents } = require("./editor-model.js"), { createGesture } = require("./editor-history.js");
  const resolve = () => { try { return project.addressLookup(address); } catch (_error) { return null; } };
  if (resolve() !== layer || find(layer.contents, itemId)?.item !== item) throw Error("The selected text changed during conversion.");
  const nextId = () => "sp-" + crypto.randomUUID();
  // Animators below the text in its group (and below ancestor groups) bake
  // into the converted paths; the animator items stay in the list.
  const matched = [];
  function collect(list, outer) {
    const below = [];
    for (let i = list.length - 1; i >= 0; i--) {
      const child = list[i];
      if (child.kind === "textAnimator") { if (child.properties.enabled.get() !== 0) below.unshift(child); }
      else if (child.id === itemId) { matched.push(...below, ...outer); return true; }
      else if (child.contents && collect(child.contents, [...below, ...outer])) return true;
    }
    return false;
  }
  collect(layer.contents, []);
  const shapes = createShapes(item.evaluate(frame), nextId, matched.map(node => node.evaluate(frame)));
  const read = () => resolve() ? clone(resolve().contents) : null;
  const write = data => { if (resolve()) replaceContents(resolve(), data, Content); };
  const done = createGesture(editor.history, read, write, () => {}, () => editor.project).run(() => {
    const data = read(), entry = find(data, itemId);
    if (!entry) throw Error("The text item is missing.");
    entry.list.splice(entry.index, 1, ...shapes); validate(data); write(data);
  });
  return done ? shapes.map(shape => shape.id) : [];
}
module.exports = { createShapes, convert };
