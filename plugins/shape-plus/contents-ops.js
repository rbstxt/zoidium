"use strict";
// Plain-data contents planning shared by the native add menu, the Pen and
// the Objects panel hints. Nothing here touches CM3 objects or the DOM.
const { titles } = require("./properties.js");
const { find } = require("./editor-tree-data.js");
const { ANIMATED_KEYS, enabledKey } = require("./text-animator-properties.js");
const GEOMETRY = ["rectangle", "ellipse", "polystar", "path", "text"];
const PAINTS = ["fill", "stroke", "gradientFill", "gradientStroke"];
const nameOf = item => typeof item.properties?.name === "string" ? item.properties.name : titles[item.kind];
function names(contents, result = new Set()) {
  for (const item of contents) { result.add(nameOf(item)); if (item.contents) names(item.contents, result); }
  return result;
}
// "Rectangle 1", "Rectangle 2", ... across the whole layer, like AE.
function uniqueName(contents, base) {
  const used = names(contents);
  for (let n = 1; ; n++) if (!used.has(base + " " + n)) return base + " " + n;
}
// The group a new item belongs to: the selected group itself, otherwise the
// group that contains the first selected item. Root-level selection is null.
// With groupsOnly, only selected groups count; other selected items are skipped.
function contextGroup(contents, ids, groupsOnly = false) {
  for (const id of ids) {
    const entry = find(contents, id);
    if (!entry) continue;
    if (entry.item.kind === "group") return entry.item;
    if (!groupsOnly) return entry.ancestors.at(-1) || null;
  }
  return null;
}
function itemData(kind, nextId, { point = null, vertexCount = 4 } = {}) {
  const item = { id: nextId(), kind, properties: {} };
  if (kind === "group") item.contents = [];
  if (point && ["rectangle", "ellipse", "polystar", "text"].includes(kind))
    item.properties.position = { animated: false, keyframes: [{ frame: 0, value: point.slice(), tween: 1 }] };
  if (kind === "path") {
    item.vertexIds = Array.from({ length: point ? 1 : vertexCount }, () => nextId());
    item.vertexModes = {};
    if (point) Object.assign(item.properties, {
      closed: 0,
      path: { animated: false, keyframes: [{ frame: 0, value: [...point, 0, 0, 0, 0], tween: 1 }] },
    });
  }
  return item;
}
function paintData(kind, nextId, strokeWidth) {
  const item = { id: nextId(), kind, properties: {} };
  if (strokeWidth !== undefined && kind === "stroke")
    item.properties.width = { animated: false, keyframes: [{ frame: 0, value: strokeWidth, tween: 1 }] };
  return item;
}
// Adds one item and returns { item, select }. Geometry outside a group is
// wrapped in a new group with its own paints, so every visible shape owns
// the fill/stroke that draws it. Geometry inside a group goes to the top of
// that group, where the group's paints below it already apply. Paints and
// modifiers go to the bottom of the group, where they see every path above.
function planAdd(contents, kind, options = {}) {
  const { nextId, selected = [], groupId = null, point = null, paints = ["fill"], strokeWidth, groupsOnly = false } = options;
  const target = groupId ? find(contents, groupId)?.item : contextGroup(contents, selected, groupsOnly);
  if (groupId && target?.kind !== "group") throw Error("Add into a group or the contents root");
  const list = target ? target.contents : contents;
  const item = itemData(kind, nextId, { point });
  if (GEOMETRY.includes(kind) && !target) {
    const group = {
      id: nextId(), kind: "group",
      properties: { name: uniqueName(contents, kind === "path" ? "Shape" : titles[kind]) },
      contents: [item, ...paints.map(paint => paintData(paint, nextId, strokeWidth))],
    };
    contents.unshift(group);
    return { item, group, select: group.id };
  }
  if (kind === "group") item.properties.name = uniqueName(contents, "Group");
  if (kind === "textAnimator") item.properties.name = uniqueName(contents, "Animator");
  if (GEOMETRY.includes(kind) || kind === "group") list.unshift(item);
  else list.push(item);
  return { item, group: target, select: item.id };
}
// Mirrors the compiler's scope rule: a paint sees every enabled path above it
// in its group, including paths of nested groups above it. Returns
// one Map: id -> { painted, enabled } for geometry and
// id -> { paths, enabled, targets } for paints.
// Text animators act on every text above them in the same list, including
// text in nested groups above them; they get id -> { texts, enabled }.
function countTexts(list) {
  let count = 0;
  for (const item of list || []) {
    if (item.kind === "text") count++;
    else if (item.contents) count += countTexts(item.contents);
  }
  return count;
}
function paintScope(contents) {
  const result = new Map();
  function walk(list, enabled) {
    const above = [];
    let texts = 0;
    for (const item of list) {
      const on = enabled && item.properties?.enabled !== 0;
      if (item.kind === "group") { texts += countTexts(item.contents); above.push(...walk(item.contents || [], on)); }
      else if (GEOMETRY.includes(item.kind)) {
        if (item.kind === "text") texts++;
        result.set(item.id, { painted: false, enabled: on });
        if (on) above.push(item.id);
      } else if (item.kind === "textAnimator") {
        result.set(item.id, { texts: on ? texts : 0, enabled: on });
      } else if (PAINTS.includes(item.kind)) {
        result.set(item.id, { paths: on ? above.length : 0, enabled: on, targets: on ? above.slice() : [] });
        if (on) for (const id of above) result.get(id).painted = true;
      }
    }
    return above;
  }
  walk(contents, true);
  return result;
}
// Insert a Text Animator directly below a text item in the text's own list,
// with one animated property enabled. Returns the new animator data.
function planAnimator(contents, textId, nextId, propertyKey) {
  const entry = find(contents, textId);
  if (!entry || entry.item.kind !== "text") throw Error("Select a Text item to add an animator.");
  if (!ANIMATED_KEYS.includes(propertyKey) && !propertyKey.startsWith("axis_")) throw Error("Unknown animator property: " + propertyKey);
  const item = itemData("textAnimator", nextId);
  item.properties.name = uniqueName(contents, "Animator");
  item.properties[enabledKey(propertyKey)] = 1;
  entry.list.splice(entry.index + 1, 0, item);
  return item;
}
// Toggle one animator feature in plain contents data: an animated property
// key, or "wiggly" for the Wiggly Selector. Each call is one history step
// through the caller's gesture.
function setAnimatorFlag(contents, animatorId, key, value) {
  const entry = find(contents, animatorId);
  if (!entry || entry.item.kind !== "textAnimator") throw Error("Select a Text Animator item.");
  const flag = key === "wiggly" ? "wigglyOn" : enabledKey(key);
  if (key !== "wiggly" && !ANIMATED_KEYS.includes(key) && !key.startsWith("axis_")) throw Error("Unknown animator property: " + key);
  entry.item.properties = { ...(entry.item.properties || {}), [flag]: value ? 1 : 0 };
  return entry.item;
}
module.exports = { GEOMETRY, PAINTS, uniqueName, contextGroup, planAdd, paintScope, itemData, planAnimator, setAnimatorFlag };
