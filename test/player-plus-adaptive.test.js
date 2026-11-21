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

test("adaptive quality recovers when rendering reaches a 60 Hz display limit", () => {
  const controller = adaptive.createController();
  const settings = { enabled: true, playing: true, chosen: 1, limit: "auto", fps: 60 };
  let now = 0, value;
  for (let i = 0; i < 32; i++) value = controller.tick(now += 30, settings);
  assert.equal(value, 0.5);
  for (let i = 0; i < 120; i++) value = controller.tick(now += 1000 / 60, settings);
  assert.equal(value, 1);
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
    assert.equal(viewport.__zoidiumImmediateOutput, true);
    assert.match(toolbar.children.find(child => child.classList.contains("zoidium-player-plus-quality")).textContent, /Auto · 1\/2/);
    toolbar.children.find(child => child.classList.contains("zoidium-player-plus-render-once")).dispatch("click");
    assert.deepEqual(drawn.at(-1), [100, undefined]);
    for (let i = 0; i < 33; i++) { now += 60; viewport._renderFn(); }
    playback.speed = 0; onSpeed();
    assert.equal(viewport.canvas.width, 100);
    viewport.renderMode = true; viewport.canvas.width = 400; viewport.canvas.height = 400;
    viewport._renderFn(); assert.deepEqual(drawn.at(-1), [400, undefined]);
  } finally { viewport.renderMode = false; PlayerPlus.deactivate(); }
});

function adaptiveHarness() {
  const { makeDocument, FakeElement } = require("./fake-dom.js");
  const state = { now: 0, drawn: [] };
  const storage = new Map([["zoidium.player-plus.adaptive", "true"]]);
  const win = { performance: { now: () => state.now }, devicePixelRatio: 1,
    localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) },
    requestAnimationFrame() { return 1; }, cancelAnimationFrame() {} };
  const playback = { speed: 1, frameRate: 30, onSpeedChanged: { watch() {}, unwatch() {} } };
  class Viewport {
    constructor(name) {
      this.name = name; this.editor = { playback }; this.enabled = true;
      this.canvas = { width: 100, height: 100, isConnected: true, style: { width: "100px", height: "100px" } };
      this.renderer = { setDrawingBufferSize: (w, h) => { this.canvas.width = w; this.canvas.height = h; } };
      this.compositor = { setSize() {} }; this._renderFn = () => this._render();
    }
    _render() { state.drawn.push([this.canvas.width, Boolean(this.__zoidiumLivePreviewGrid)]); }
    resize() {}
  }
  const document = makeDocument(), toolbar = new FakeElement("div");
  toolbar.querySelector = selector => selector === 'button[title="play (space)"]' ? true :
    toolbar.children.find(child => selector.startsWith(".") && child.classList.contains(selector.slice(1))) || null;
  document.getElementById = () => null;
  return { ...state, state, win, playback, Viewport, document, toolbar, FakeElement };
}

test("adaptive timing moves to another viewport when the timed one is detached", async () => {
  const PlayerPlus = require("../plugins/player-plus/player-plus.js");
  const h = adaptiveHarness(), first = new h.Viewport("first"), second = new h.Viewport("second");
  h.document.querySelectorAll = selector => selector === "canvas" ?
    [first, second].map(viewport => ({ parentElement: { pz_panel: viewport } })) : [h.toolbar];
  await PlayerPlus.activate({ editor: { playback: h.playback }, window: h.win, document: h.document,
    PZ: { ui: { viewport: h.Viewport, generateIcon: () => new h.FakeElement("svg"), switchIcon() {} } } });
  try {
    h.state.now += 60; first._renderFn();
    first.canvas.isConnected = false;
    for (let i = 0; i < 33; i++) { h.state.now += 60; second._renderFn(); }
    assert.equal(second.canvas.width, 50);
  } finally { PlayerPlus.deactivate(); }
});

test("an existing Player+ toolbar is replaced with the combined controls", async () => {
  const PlayerPlus = require("../plugins/player-plus/player-plus.js");
  const h = adaptiveHarness(), viewport = new h.Viewport("only");
  h.document.querySelectorAll = selector => selector === "canvas" ? [{ parentElement: { pz_panel: viewport } }] : [h.toolbar];
  const ctx = { editor: { playback: h.playback }, window: h.win, document: h.document,
    PZ: { ui: { viewport: h.Viewport, generateIcon: () => new h.FakeElement("svg"), switchIcon() {} } } };
  await PlayerPlus.activate(ctx);
  PlayerPlus.deactivate();
  // Simulate a toolbar left by a version without adaptive controls.
  h.toolbar.children.length = 0;
  for (const name of ["pause", "render-once", "quality", "speed", "overflow"]) {
    const node = new h.FakeElement(name === "quality" || name === "speed" ? "select" : "button");
    node.classList.add("zoidium-player-plus-" + name);
    if (name === "pause") node.appendChild(new h.FakeElement("svg"));
    if (name === "speed") node.value = "1";
    h.toolbar.appendChild(node);
  }
  h.toolbar.dataset.zoidiumPlayerPlus = "true";
  await PlayerPlus.activate(ctx);
  try {
    const css = h.document.head.children.find(node => node.tagName === "STYLE").textContent;
    assert.doesNotMatch(css, /is-player-plus-compressed > button/);
    assert.match(css, /is-player-plus-compressed > span/);
    const names = h.toolbar.children.map(child => child.classList.value.split(" ").find(c => c.startsWith("zoidium-player-plus-")));
    for (const name of ["pause", "render-once", "quality", "speed", "overflow"]) assert.ok(names.includes("zoidium-player-plus-" + name));
    assert.equal(names.includes("zoidium-player-plus-adaptive"), false);
    assert.equal(names.filter(name => name === "zoidium-player-plus-overflow").length, 1);
  } finally { PlayerPlus.deactivate(); }
  assert.equal(h.toolbar.children.some(child => child.classList.contains("zoidium-player-plus-adaptive")), false);
});

test("the transparency grid stays on while adaptive quality is reduced, but not for the eyedropper", async () => {
  const PlayerPlus = require("../plugins/player-plus/player-plus.js");
  const h = adaptiveHarness(), viewport = new h.Viewport("main"), grids = h.state.drawn;
  h.win.localStorage.setItem("zoidium.player-plus.transparency-grid", "true");
  h.document.querySelectorAll = selector => selector === "canvas" ? [{ parentElement: { pz_panel: viewport } }] : [h.toolbar];
  await PlayerPlus.activate({ editor: { playback: h.playback, mainViewport: viewport }, window: h.win, document: h.document,
    PZ: { ui: { viewport: h.Viewport, generateIcon: () => new h.FakeElement("svg"), switchIcon() {} } } });
  try {
    for (let i = 0; i < 33; i++) { h.state.now += 60; viewport._renderFn(); }
    assert.deepEqual(grids.at(-1), [50, true]);
    assert.equal(viewport.__zoidiumImmediateOutput, true);
    viewport.__zoidiumPickingColor = true;
    h.state.now += 60; viewport._renderFn();
    assert.deepEqual(grids.at(-1), [50, false]);
  } finally { delete viewport.__zoidiumPickingColor; PlayerPlus.deactivate(); }
});
