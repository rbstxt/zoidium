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
// Character categories stack in order: each later category transforms the
// result of the earlier ones. A category appears once the previous one is used.
const MAX_STACK = 3;
const clone = value => JSON.parse(JSON.stringify(value));
const refreshQueued = new WeakSet(), stackRefreshQueued = new WeakSet();

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
  const stack = list._zoidiumStack;
  if (stack && updateStackVisibility(stack)) stackRefreshQueued.add(list);
  // The native option handler still uses its row after property.set(). Rebuild
  // only after that handler returns, so its controls are not detached mid-edit.
  if (!refreshQueued.has(list)) {
    refreshQueued.add(list);
    queueMicrotask(() => {
      refreshQueued.delete(list);
      list.onListChanged.update();
      // A category appeared or disappeared: the native panel must rebuild its
      // category list, which a property-list change alone does not do.
      if (stackRefreshQueued.delete(list)) {
        list.parent?.properties?.onListChanged?.update();
        list._zoidiumStack?.refreshPanels?.();
      }
    });
  }
}

function modeOf(list) {
  return Math.round(Number(list.mode.get(0))) || 0;
}

// Returns true when a later category appeared or disappeared.
function updateStackVisibility(stack) {
  if (!stack.live) return false;
  let changed = false;
  for (let slot = 1; slot < stack.length; slot++) {
    const visible = modeOf(stack[slot - 1]) !== 0 || modeOf(stack[slot]) !== 0;
    if (stack[slot].visible !== visible) { stack[slot].visible = visible; changed = true; }
  }
  return changed;
}

function createCharacters(PZ, layer, slot = 0) {
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
    _zoidiumCategoryName: { value: slot ? "Character " + (slot + 1) : "Character" },
    _zoidiumSlot: { value: slot },
    _zoidiumModeKeys: { value: Object.fromEntries(Object.entries(groups).map(([key, defs]) => [key, Object.keys(defs)])) },
  });
  list.load();
  // Appending preserves every existing native property, object, and effect
  // address, including history recorded before Text+ was enabled.
  layer.children.push(list);
  if (!slot) Object.defineProperty(layer, "textPlusCharacters", { value: list, configurable: true });
  Object.defineProperty(list, "_zoidiumDefaultJSON", { value: JSON.stringify(list) });
  return list;
}

// Later categories are appended after the first one, so every address that
// existed before stacking, including the first category's, stays unchanged.
function createCharacterStack(PZ, layer) {
  if (layer.textPlusCharacterStack) return layer.textPlusCharacterStack;
  const stack = [layer.textPlusCharacters || createCharacters(PZ, layer, 0)];
  for (let slot = 1; slot < MAX_STACK; slot++) stack.push(createCharacters(PZ, layer, slot));
  stack.live = true;
  for (const list of stack) Object.defineProperty(list, "_zoidiumStack", { value: stack });
  Object.defineProperty(layer, "textPlusCharacterStack", { value: stack, configurable: true });
  return stack;
}

function snapshot(stack, saved) {
  const lists = Array.isArray(stack) ? stack : [stack];
  const properties = lists.map(list => clone(list));
  const changed = properties.map((value, index) => JSON.stringify(value) !== lists[index]._zoidiumDefaultJSON);
  if (!saved && !changed.includes(true)) return undefined;
  const result = { ...saved, schemaVersion: 1,
    characterProperties: { ...saved?.characterProperties, ...properties[0] } };
  // Older files have no later categories; omit the field until one is used.
  if (saved?.extraCharacterProperties || changed.slice(1).includes(true)) {
    result.extraCharacterProperties = properties.slice(1).map((value, index) =>
      ({ ...saved?.extraCharacterProperties?.[index], ...value }));
  }
  return result;
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

module.exports = { MODES, MODE_LABELS, GROUPS, MAX_STACK, definitions2D, createCharacters,
  createCharacterStack, updateStackVisibility, refreshVisibility, snapshot, loadCharacters, controlSource };
