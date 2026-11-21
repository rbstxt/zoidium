"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const adaptive = require("../plugins/player-plus/adaptive-quality.js");

test("adaptive quality steps down, respects the limit, recovers and resets", () => {
  const controller = adaptive.createController();
  const settings = { enabled: true, playing: true, chosen: 1, limit: "0.25", fps: 30 };
  let now = 0, value = 1;
  function frames(count, delta) { for (let i = 0; i < count; i++) value = controller.tick(now += delta, settings); }
  frames(29, 60); assert.equal(value, 1);
  frames(3, 60); assert.equal(value, 0.5);
  frames(30, 60); assert.equal(value, 0.25);
  frames(60, 60); assert.equal(value, 0.25);
  frames(120, 10); assert.equal(value, 0.5);
  frames(90, 10); assert.equal(value, 1);
  frames(30, 60); settings.playing = false;
  assert.equal(controller.tick(now += 60, settings), 1);
  settings.playing = true; settings.chosen = 0.5; settings.limit = "0.5";
  frames(100, 60); assert.equal(value, 0.5);
});

test("adaptive settings persist independently and tolerate blocked storage", () => {
  const data = new Map();
  const storage = { getItem: key => data.get(key), setItem: (key, value) => data.set(key, value) };
  assert.deepEqual(adaptive.readSettings(storage), { enabled: false, limit: "auto" });
  adaptive.writeSetting(storage, "enabled", true); adaptive.writeSetting(storage, "limit", "0.25");
  assert.deepEqual(adaptive.readSettings(storage), { enabled: true, limit: "0.25" });
  const blocked = { getItem() { throw Error(); }, setItem() { throw Error(); } };
  assert.deepEqual(adaptive.readSettings(blocked), { enabled: false, limit: "auto" });
  assert.doesNotThrow(() => adaptive.writeSetting(blocked, "enabled", true));
});

test("adaptive preview bypasses output caching and restores for pause and Render once", async () => {
  const PlayerPlus = require("../plugins/player-plus/player-plus.js");
  const { makeDocument, FakeElement } = require("./fake-dom.js");
  let now = 0, onSpeed, drawn = [];
  const storage = new Map([["zoidium.player-plus.adaptive", "true"]]);
  const win = { performance: { now: () => now }, devicePixelRatio: 1,
    localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) },
    requestAnimationFrame() { return 1; }, cancelAnimationFrame() {} };
  const playback = { speed: 1, frameRate: 30, onSpeedChanged: { watch(fn) { onSpeed = fn; }, unwatch() {} } };
  class Viewport {
    constructor() {
      this.editor = { playback }; this.enabled = true;
      this.canvas = { width: 100, height: 100, style: { width: "100px", height: "100px" } };
      this.renderer = { setDrawingBufferSize: (w, h) => { this.canvas.width = w; this.canvas.height = h; } };
      this.compositor = { setSize() {} }; this._renderFn = () => this._render();
    }
    _render() { drawn.push([this.canvas.width, this.__zoidiumImmediateOutput]); }
    resize() {}
  }
  const viewport = new Viewport(), document = makeDocument(), toolbar = new FakeElement("div");
  toolbar.querySelector = selector => selector === 'button[title="play (space)"]' ? true : null;
  document.getElementById = () => null;
  document.querySelectorAll = selector => selector === "canvas" ? [{ parentElement: { pz_panel: viewport } }] : [toolbar];
  await PlayerPlus.activate({ editor: { playback }, window: win, document, PZ: { ui: { viewport: Viewport, generateIcon: () => new FakeElement("svg"), switchIcon() {} } } });
  try {
    for (let i = 0; i < 33; i++) { now += 60; viewport._renderFn(); }
    assert.deepEqual(drawn.at(-1), [50, true]);
    assert.equal(viewport.__zoidiumImmediateOutput, undefined);
    assert.match(toolbar.children.find(child => child.classList.contains("zoidium-player-plus-quality")).children[0].textContent, /Adaptive/);
    toolbar.children.find(child => child.classList.contains("zoidium-player-plus-render-once")).dispatch("click");
    assert.deepEqual(drawn.at(-1), [100, undefined]);
    for (let i = 0; i < 33; i++) { now += 60; viewport._renderFn(); }
    playback.speed = 0; onSpeed();
    assert.equal(viewport.canvas.width, 100);
    viewport.renderMode = true; viewport.canvas.width = 400; viewport.canvas.height = 400;
    viewport._renderFn(); assert.deepEqual(drawn.at(-1), [400, undefined]);
  } finally { viewport.renderMode = false; PlayerPlus.deactivate(); }
});
