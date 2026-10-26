"use strict";

const { createCharacterStack, updateStackVisibility, refreshVisibility, snapshot, loadCharacters } = require("./text-plus-2d-properties.js");
const { drawCharacters } = require("./text-plus-2d-draw.js");

function install(context) {
  const { PZ, editor } = context;
  const Text = PZ.layer?.shape?.text, proto = Text?.prototype;
  if (!proto?.draw || !proto.load) return () => {};
  const states = new WeakMap(), layers = new Set(), boundsCache = new WeakMap(), restore = [];
  let live = true;
  function attach(layer, reload = false) {
    if (states.has(layer) && !reload) return states.get(layer);
    const saved = layer.zoidiumTextPlus2D;
    // Retain future metadata without interpreting or rewriting its schema.
    if (saved && saved.schemaVersion !== 1) return null;
    const stack = createCharacterStack(PZ, layer);
    stack.refreshPanels = refreshPanels;
    if (reload || !states.has(layer)) {
      stack.forEach((list, slot) => loadCharacters(list,
        slot ? saved?.extraCharacterProperties?.[slot - 1] : saved?.characterProperties));
    }
    stack.live = true;
    stack[0].visible = true;
    for (const list of stack) refreshVisibility(list);
    updateStackVisibility(stack);
    Object.defineProperty(layer, "zoidiumTextPlus2D", {
      configurable: true, get: () => snapshot(stack, saved),
    });
    states.set(layer, stack);
    layers.add(new WeakRef(layer));
    return stack;
  }
  function patch(key, implementation) {
    const descriptor = Object.getOwnPropertyDescriptor(proto, key), original = proto[key];
    const replacement = function () {
      return (live ? implementation : original).apply(this, arguments);
    };
    proto[key] = replacement;
    restore.push(() => {
      if (proto[key] !== replacement) return;
      if (descriptor) Object.defineProperty(proto, key, descriptor);
      else delete proto[key];
    });
    return original;
  }
  const load = patch("load", function () {
    const result = load.apply(this, arguments);
    attach(this, true);
    return result;
  });
  const draw = patch("draw", function (ctx) {
    const stack = attach(this);
    return stack ? drawCharacters(this, stack, ctx, draw, arguments, boundsCache) : draw.apply(this, arguments);
  });
  const unload = patch("unload", function () {
    states.delete(this);
    return unload.apply(this, arguments);
  });
  function refreshPanels() {
    for (const el of context.document?.querySelectorAll?.(".editorpanel") || []) {
      const panel = el.pz_panel;
      if (PZ.ui?.edit && panel instanceof PZ.ui.edit) panel.objectsChanged_bound?.();
    }
  }
  // Native load adds its text settings after the base layer's load. The
  // category must exist before native panel and package code traverse it.
  editor?.project?.forEachItemOfType?.(Text, layer => attach(layer));
  refreshPanels();
  return () => {
    live = false;
    // Keep the hidden property lists at their original addresses. Native
    // undo commands still resolve them, and serialization reads live values.
    for (const reference of layers) {
      const layer = reference.deref(), stack = layer && states.get(layer);
      if (!stack) continue;
      stack.live = false;
      for (const list of stack) list.visible = false;
      layer.properties?.onListChanged?.update();
    }
    layers.clear();
    for (const undo of restore.reverse()) undo();
    refreshPanels();
  };
}

module.exports = { install };
