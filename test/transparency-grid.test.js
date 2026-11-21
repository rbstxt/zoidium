"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { drawTransparentSequence } = require("../plugins/core/alpha-export-render");
const { createTransparencyGrid } = require("../plugins/player-plus/transparency-grid");

test("a new browser defaults to the legacy preview and retains the toggle on reload", () => {
  const values = new Map();
  const window = { localStorage: {
    getItem: key => values.get(key),
    setItem: (key, value) => values.set(key, value),
  } };
  const grid = createTransparencyGrid(window);
  assert.equal(grid.enabled, false);
  grid.toggle();
  const reloaded = createTransparencyGrid(window);
  assert.equal(reloaded.enabled, true);
  reloaded.toggle();
  assert.equal(createTransparencyGrid(window).enabled, false);
  const blocked = createTransparencyGrid({ get localStorage() { throw new Error("Blocked"); } });
  blocked.toggle();
  assert.equal(blocked.enabled, true);
});

function fixture() {
  const black = { clone() { return this; } };
  const fade = [];
  const draws = [];
  const canvas = { clientWidth: 320, clientHeight: 180 };
  const copyMaterial = { blending: 1 };
  const renderer = {
    alpha: 1,
    getClearColor: () => black,
    getClearAlpha() { return this.alpha; },
    setClearColor(_color, alpha) { this.alpha = alpha; },
    render(scene, _camera, target) { draws.push([scene, target, copyMaterial.blending]); },
  };
  const compositor = Object.assign(Object.create({
    clear(index) { fade.push([index, renderer.alpha]); },
  }), { renderer, copyPass: { material: copyMaterial } });
  const viewport = { compositor, renderer, canvas };
  return { compositor, renderer, viewport, copyMaterial, fade, draws };
}

test("only the root sequence clear and final display use transparency", () => {
  const { compositor, renderer, copyMaterial, fade, draws } = fixture();
  const render = renderer.render;
  const target = {};
  const display = (originalRender, scene, camera, clear) => {
    originalRender.call(renderer, scene, camera, target, clear);
    originalRender.call(renderer, "checker", camera, null, clear);
  };

  const result = drawTransparentSequence(compositor, 0, display, () => {
    assert.equal(renderer.alpha, 0);
    renderer.setClearColor(0, 1);
    compositor.clear(0);
    assert.equal(renderer.alpha, 1);
    compositor.clear(1);
    renderer.setClearColor(0, 0);
    renderer.render("layer", null, target, true);
    renderer.render("final", null, null, true);
    return 42;
  });

  assert.equal(result, 42);
  assert.deepEqual(fade, [[0, 0], [1, 1]]);
  assert.deepEqual(draws, [["layer", target, 1], ["final", target, 0], ["checker", null, 0]]);
  assert.equal(renderer.render, render);
  assert.equal(Object.hasOwn(compositor, "clear"), false);
  assert.equal(copyMaterial.blending, 1);
  assert.equal(renderer.alpha, 1);
  renderer.render("export", null, null, true);
  assert.deepEqual(draws.at(-1), ["export", null, 1]);
});

test("a failed preview puts the renderer and compositor back before the next draw", () => {
  const { renderer, compositor, copyMaterial } = fixture();
  const render = renderer.render;
  const failure = new Error("Draw failed");
  assert.throws(() => drawTransparentSequence(compositor, 0, () => { throw failure; }, () => {
    renderer.setClearColor(0, 1);
    compositor.clear(0);
    renderer.render("final", null, null, true);
  }), failure);
  assert.equal(copyMaterial.blending, 1);
  assert.equal(renderer.alpha, 1);
  assert.equal(renderer.render, render);
  assert.equal(Object.hasOwn(compositor, "clear"), false);
});
