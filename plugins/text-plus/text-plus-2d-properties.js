"use strict";

const {
  createTransformPropertyDefinitions,
  createGradientTransformPropertyDefinitions,
  createShakePropertyDefinitions,
  createRandomScatterPropertyDefinitions,
} = require("./text-plus-properties.js");

const MODES = [
  null, "character-transform", "gradient-transform", "character-shake",
  "selected-transform", "selected-shake", "random-scatter",
];
const MODE_LABELS = [
  "None", "Character Transform", "Gradient Transform", "Character Shake",
  "Selected Character Transform", "Selected Character Shake", "Random Scatter",
];
const GROUPS = [null, "transform", "gradient", "shake", "transform", "shake", "scatter"];
const clone = value => JSON.parse(JSON.stringify(value));
const refreshQueued = new WeakSet();

function definitions2D(PZ, definitions) {
  const result = {};
  for (const [key, definition] of Object.entries(definitions)) {
    if (["charEulerOrder", "gradientEulerOrder", "shakeAxis"].includes(key)) continue;
    if (definition.type !== PZ.property.type.VECTOR3) {
      result[key] = definition;
    } else if (/rotation/i.test(key)) {
      const channel = definition.objects[2];
      result[key] = { ...channel, name: definition.name };
    } else {
      result[key] = { ...definition, type: PZ.property.type.VECTOR2,
        value: definition.value.slice(0, 2), objects: definition.objects.slice(0, 2) };
    }
  }
  return result;
}

function refreshVisibility(list) {
  const mode = Math.round(Number(list.mode.get(0)));
  const visible = list._zoidiumModeKeys[GROUPS[mode]] || [];
  for (const key of Object.keys(list)) {
    list[key].visible = key === "mode" || visible.includes(key);
  }
  list.characterNumbers.visible = mode === 4 || mode === 5;
  // The native option handler still uses its row after property.set(). Rebuild
  // only after that handler returns, so its controls are not detached mid-edit.
  if (!refreshQueued.has(list)) {
    refreshQueued.add(list);
    queueMicrotask(() => { refreshQueued.delete(list); list.onListChanged.update(); });
  }
}

function createCharacters(PZ, layer) {
  const groups = {
    transform: definitions2D(PZ, createTransformPropertyDefinitions(PZ, true)),
    gradient: definitions2D(PZ, createGradientTransformPropertyDefinitions(PZ)),
    shake: definitions2D(PZ, createShakePropertyDefinitions(PZ, true)),
    scatter: definitions2D(PZ, createRandomScatterPropertyDefinitions(PZ)),
  };
  const list = new PZ.propertyList({
    mode: { name: "Mode", type: PZ.property.type.OPTION, value: 0,
      items: MODE_LABELS.join(";"), changed() { refreshVisibility(this.parent); } },
    ...groups.transform, ...groups.gradient, ...groups.shake, ...groups.scatter,
  }, layer);
  Object.defineProperties(list, {
    _zoidiumCategoryName: { value: "Character" },
    _zoidiumModeKeys: { value: Object.fromEntries(Object.entries(groups).map(([key, defs]) => [key, Object.keys(defs)])) },
  });
  list.load();
  // Appending preserves every existing native property, object, and effect
  // address, including history recorded before Text+ was enabled.
  layer.children.push(list);
  Object.defineProperty(layer, "textPlusCharacters", { value: list, configurable: true });
  Object.defineProperty(list, "_zoidiumDefaultJSON", { value: JSON.stringify(list) });
  return list;
}

function snapshot(list, saved) {
  const properties = clone(list);
  if (!saved && JSON.stringify(properties) === list._zoidiumDefaultJSON) return undefined;
  return { ...saved, schemaVersion: 1,
    characterProperties: { ...saved?.characterProperties, ...properties } };
}

function loadCharacters(list, data) {
  function reset(property) {
    // Native dynamic.load appends keyframes and leaves old expressions in
    // place. Reuse property identities for history, but replace their state.
    if ("expression" in property) property.expression = null;
    if (property.keyframes) {
      property.keyframes.splice(0, property.keyframes.length);
      property.animated = false;
    }
    if (property.objects) for (const child of property.objects) reset(child);
  }
  for (const property of list) reset(property);
  list.load(data);
}

// Adapt native scalar rotations to the shared 3D control readers. The actual
// properties keep their native 2D types, parents, addresses, and expressions.
function controlSource(list) {
  const mode = Math.round(Number(list.mode.get(0)));
  if (!MODES[mode]) return null;
  const properties = {};
  for (const key of list._zoidiumModeKeys[GROUPS[mode]]) {
    const property = list[key];
    properties[key] = /rotation/i.test(key)
      ? { get: frame => [0, 0, property.get(frame)] }
      : property;
  }
  return { zoidiumTextPlusMode: MODES[mode], characterProperties: properties };
}

module.exports = { MODES, MODE_LABELS, GROUPS, definitions2D, createCharacters,
  refreshVisibility, snapshot, loadCharacters, controlSource };
