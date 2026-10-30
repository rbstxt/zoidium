"use strict";
const { textPaths } = require("./text-paths.js");
function createShapes(evaluated, nextId) {
  if (evaluated.kind !== "text") throw Error("Select a Text item to create shapes.");
  if (!evaluated.textLayout) throw Error("The text font is not ready.");
  return textPaths(evaluated, nextId).contents.map(group => ({
    id: group.id, kind: "group", properties: { name: group.properties.name, enabled: evaluated.properties.enabled },
    contents: group.contents.map(path => ({ ...path, properties: { enabled: 1, closed: path.properties.closed,
      path: { animated: false, keyframes: [{ frame: 0, value: path.properties.path, tween: 1 }] } } })),
  }));
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
  const nextId = () => "sp-" + crypto.randomUUID(), shapes = createShapes(item.evaluate(frame), nextId);
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
