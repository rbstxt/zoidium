"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const PlayerPlus = require("../plugins/player-plus/player-plus");
const LayerInput = require("../plugins/layer-input/layer-input");
function context() {
  const calls = { render: 0, resize: 0, sequence: 0 };
  class Viewport {
    _render() { calls.render++; return "rendered"; }
    resize() { calls.resize++; return "resized"; }
  }
  class Compositor {
    renderSequence() { calls.sequence++; return "sequence"; }
    renderEffects() { return "effects"; }
    unload() { return "unloaded"; }
  }
  const callbacks = [];
  return { calls, callbacks, context: {
    editor: { project: {} }, PZ: { property: { type: { LIST: 10 } }, ui: { viewport: Viewport, objectTypes: { get: () => [] } }, compositor: Compositor },
    document: {
      createElement: () => ({ remove() {} }), head: { appendChild() {} },
      getElementById: () => null, querySelectorAll: () => [],
    }, window: { requestAnimationFrame(fn) { callbacks.push(fn); }, cancelAnimationFrame() {}, setTimeout, clearTimeout },
  } };
}
test("cross-plugin retained viewport wrappers stay inactive after re-enable", async () => {
  const h = context();
  const prototype = h.context.PZ.ui.viewport.prototype;
  const original = prototype._render;
  await PlayerPlus.activate(h.context);
  const retainedPlayer = prototype._render;
  LayerInput.activate(h.context);
  const retainedLayer = prototype._render;
  PlayerPlus.deactivate();
  assert.equal(new h.context.PZ.ui.viewport()._render(), "rendered");
  await PlayerPlus.activate(h.context);
  assert.equal(new h.context.PZ.ui.viewport()._render(), "rendered");
  LayerInput.deactivate();
  assert.equal(new h.context.PZ.ui.viewport()._render(), "rendered");
  PlayerPlus.deactivate();
  // Every previously retained installation delegates, even after state cleared.
  assert.equal(retainedPlayer.call({}), "rendered");
  assert.equal(retainedLayer.call({}), "rendered");
  new h.context.PZ.ui.viewport()._render();
  assert.equal(prototype._render, original);
  for (const callback of h.callbacks) callback();
});
test("ten alternating cycles preserve viewport/compositor results and rollback is registered", async () => {
  const h = context();
  const cleanups = [];
  h.context.lifecycle = { onDispose(fn) { cleanups.push(fn); } };
  const compositor = new h.context.PZ.compositor();
  for (let i = 0; i < 10; i++) {
    await PlayerPlus.activate(h.context);
    LayerInput.activate(h.context);
    const renderEffects = compositor.renderEffects;
    const unload = compositor.unload;
    const sequence = compositor.renderSequence;
    if (i % 2) { LayerInput.deactivate(); PlayerPlus.deactivate(); }
    else { PlayerPlus.deactivate(); LayerInput.deactivate(); }
    assert.equal(new h.context.PZ.ui.viewport()._render(), "rendered");
    assert.equal(new h.context.PZ.ui.viewport().resize(), "resized");
    assert.equal(sequence.call(compositor), "sequence");
    assert.equal(renderEffects.call(compositor), "effects");
    assert.equal(unload.call(compositor), "unloaded");
  }
  assert.equal(h.calls.render, 10);
  assert.equal(h.calls.resize, 10);
  assert.equal(h.calls.sequence, 10);
  assert.equal(cleanups.length, 20);
  for (const cleanup of cleanups) cleanup();
});

test("an old lifecycle cleanup cannot deactivate a newer installation", async () => {
  const h = context();
  const cleanups = [];
  h.context.lifecycle = { onDispose(fn) { cleanups.push(fn); } };
  await PlayerPlus.activate(h.context);
  const firstPlayer = cleanups[0];
  PlayerPlus.deactivate();
  await PlayerPlus.activate(h.context);
  const playerRender = h.context.PZ.ui.viewport.prototype._render;
  firstPlayer();
  assert.equal(h.context.PZ.ui.viewport.prototype._render, playerRender);
  LayerInput.activate(h.context);
  const firstLayer = cleanups.at(-1);
  LayerInput.deactivate();
  LayerInput.activate(h.context);
  const layerRender = h.context.PZ.ui.viewport.prototype._render;
  firstLayer();
  assert.equal(h.context.PZ.ui.viewport.prototype._render, layerRender);
  LayerInput.deactivate();
  PlayerPlus.deactivate();
});

test("Player+ restores native drawing quality on disable", async () => {
  const h = context();
  const viewport = new h.context.PZ.ui.viewport();
  viewport.canvas = { width: 80, height: 40, clientWidth: 80, clientHeight: 40, style: {}, parentElement: { pz_panel: viewport } };
  viewport.renderer = { setDrawingBufferSize(width, height) { viewport.canvas.width = width; viewport.canvas.height = height; } };
  viewport.compositor = { setSize() {} };
  h.context.window.localStorage = { getItem: () => "0.5" };
  h.context.document.querySelectorAll = (selector) => selector === "canvas" ? [viewport.canvas] : [];
  await PlayerPlus.activate(h.context);
  h.callbacks[0]();
  assert.equal(viewport.canvas.width, 40);
  PlayerPlus.deactivate();
  assert.equal(viewport.canvas.width, 80);
  assert.equal(viewport.canvas.height, 40);
});
