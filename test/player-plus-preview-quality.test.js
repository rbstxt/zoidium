"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { makeDocument, FakeElement } = require("./fake-dom.js");

const UPSCALE_KEY = "zoidium.player-plus.preview-upscale";
const EXACT_KEY = "zoidium.player-plus.exact-effects";

function harness({ storage: initial, resolution = [1920, 1080], maxTextureSize = 16384,
  devicePixelRatio = 1, imageRendering } = {}) {
  const counts = { bufferSizes: [], compositorSizes: [], renders: 0 };
  const clock = { now: 0 };
  const storage = new Map(initial || []);
  const win = { performance: { now: () => clock.now }, devicePixelRatio,
    localStorage: {
      getItem: key => storage.get(key),
      setItem: (key, value) => storage.set(key, value),
    },
    requestAnimationFrame() { return 1; }, cancelAnimationFrame() {} };
  const playback = { speed: 0, frameRate: 30, onSpeedChanged: { watch() {}, unwatch() {} } };
  const sequence = { properties: { resolution: {
    value: resolution.slice(),
    get() { return this.value; },
    onChanged: { watch() {}, unwatch() {} },
  } } };
  const project = { sequence };
  class Viewport {
    constructor() {
      this.editor = { playback, project };
      this.enabled = true;
      this.canvas = { width: 100, height: 100, isConnected: true,
        style: { width: "100px", height: "100px", imageRendering } };
      this.compositor = { readBuffer: { width: 100, height: 100 }, setSize: (width, height) => {
        counts.compositorSizes.push([width, height]);
        this.compositor.readBuffer = { width, height };
      } };
      this.renderer = {
        context: { MAX_TEXTURE_SIZE: 16384, getParameter: parameter =>
          parameter === 16384 ? maxTextureSize : null },
        setDrawingBufferSize: (width, height) => {
          counts.bufferSizes.push([width, height]);
          this.canvas.width = width;
          this.canvas.height = height;
        },
      };
      this._renderFn = () => this._render();
    }
    _render() { counts.renders += 1; }
    resize() {}
  }
  const viewport = new Viewport();
  const document = makeDocument();
  document.getElementById = () => null;
  const toolbar = new FakeElement("div");
  toolbar.querySelector = selector => selector === 'button[title="play (space)"]' ? true :
    toolbar.children.find(child => selector.startsWith(".") && child.classList.contains(selector.slice(1))) || null;
  const layout = { current: [viewport] };
  document.querySelectorAll = selector => selector === "canvas" ?
    layout.current.map(item => ({ parentElement: { pz_panel: item } })) : [toolbar];
  const PlayerPlus = require("../plugins/player-plus/player-plus.js");
  const push = newViewport => layout.current.push(newViewport);
  const mount = newViewport => { layout.current = [newViewport]; };
  const popup = () => document.body.children[0];
  const pick = selector => popup().querySelector(selector);
  return { PlayerPlus, viewport, Viewport, document, toolbar, win, storage, counts,
    project, sequence, popup, pick, push, mount, clock,
    compositorSize: () => counts.compositorSizes.at(-1),
    async activate() {
      await PlayerPlus.activate({ editor: { playback, project, mainViewport: viewport },
        window: win, document,
        PZ: { ui: { viewport: Viewport, generateIcon: () => new FakeElement("svg"), switchIcon() {} } } });
    },
  };
}

function setQuality(h, index) {
  h.popup().children[index].dispatch("click");
}

function setUpscale(h, value) {
  const select = h.pick(".zoidium-player-plus-upscale");
  select.value = value;
  select.dispatch("change");
}

function setExact(h, value) {
  const box = h.pick(".zoidium-player-plus-exact");
  box.checked = value;
  box.dispatch("change");
}

test("preview quality preferences store separately and tolerate blocked storage", () => {
  const previewQuality = require("../plugins/player-plus/preview-quality.js");
  const data = new Map();
  const storage = { getItem: key => data.get(key), setItem: (key, value) => data.set(key, value) };
  assert.equal(previewQuality.readUpscale(storage), "smooth");
  assert.equal(previewQuality.readExact(storage), false);
  previewQuality.writeUpscale(storage, "sharp");
  previewQuality.writeExact(storage, true);
  assert.equal(data.get(UPSCALE_KEY), "sharp");
  assert.equal(data.get(EXACT_KEY), "true");
  const blocked = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } };
  assert.equal(previewQuality.readUpscale(blocked), "smooth");
  assert.equal(previewQuality.readExact(blocked), false);
  assert.doesNotThrow(() => previewQuality.writeUpscale(blocked, "sharp"));
  assert.doesNotThrow(() => previewQuality.writeExact(blocked, true));
});

test("default preview sizes stay unchanged and Sharp only changes canvas CSS", async () => {
  const h = harness();
  await h.activate();
  try {
    h.viewport._render();
    assert.equal(h.viewport.canvas.width, 100);
    assert.equal(h.viewport.canvas.height, 100);
    assert.equal(h.viewport.canvas.style.imageRendering, undefined);
    const before = h.counts.bufferSizes.length;
    setUpscale(h, "sharp");
    assert.equal(h.viewport.canvas.style.imageRendering, "pixelated");
    assert.equal(h.counts.bufferSizes.length, before, "Sharp does not resize the drawing buffer");
    assert.deepEqual(h.counts.compositorSizes.at(-1), undefined);
    assert.deepEqual([h.viewport.canvas.width, h.viewport.canvas.height], [100, 100]);
    assert.equal(h.storage.get(UPSCALE_KEY), "sharp");
    assert.equal(h.storage.has("zoidium.player-plus.quality"), false);
    setUpscale(h, "smooth");
    assert.equal(h.viewport.canvas.style.imageRendering, "");
  } finally { h.PlayerPlus.deactivate(); }
});

test("Sharp restores the original inline value and a replaced viewport gets it too", async () => {
  const h = harness({ imageRendering: "auto" });
  await h.activate();
  try {
    h.viewport._render();
    assert.equal(h.viewport.canvas.style.imageRendering, "auto");
    setUpscale(h, "sharp");
    assert.equal(h.viewport.canvas.style.imageRendering, "pixelated");
    const replacement = new h.Viewport();
    replacement.canvas.style.imageRendering = "auto";
    h.mount(replacement);
    replacement._render();
    assert.equal(replacement.canvas.style.imageRendering, "pixelated");
    h.PlayerPlus.deactivate();
    assert.equal(h.viewport.canvas.style.imageRendering, "auto");
    assert.equal(replacement.canvas.style.imageRendering, "auto");
  } finally { h.PlayerPlus.deactivate(); }
});

test("stored Sharp applies on activation and deactivation restores the canvas", async () => {
  const h = harness({ storage: [[UPSCALE_KEY, "sharp"]], imageRendering: "auto" });
  await h.activate();
  h.viewport._render();
  assert.equal(h.viewport.canvas.style.imageRendering, "pixelated");
  h.PlayerPlus.deactivate();
  assert.equal(h.viewport.canvas.style.imageRendering, "auto");
});

test("qualities and Exact choose drawing-buffer and compositor sizes independently", async () => {
  const h = harness();
  await h.activate();
  try {
    h.viewport._render();
    assert.equal(h.pick(".zoidium-player-plus-exact").checked, false, "Exact defaults off");
    assert.equal(h.pick(".zoidium-player-plus-upscale").value, "smooth", "Smooth is the default");

    setQuality(h, 1);
    h.viewport._render();
    assert.deepEqual([h.viewport.canvas.width, h.viewport.canvas.height], [50, 50]);
    assert.deepEqual(h.compositorSize(), [50, 50]);

    setExact(h, true);
    assert.deepEqual([h.viewport.canvas.width, h.viewport.canvas.height], [50, 50],
      "Exact keeps the reduced drawing buffer");
    assert.deepEqual(h.compositorSize(), [1920, 1080], "Exact renders at the sequence resolution");
    assert.equal(h.viewport.__zoidiumPlayerPlusExactEffects, true);
    assert.equal(h.viewport.__zoidiumImmediateOutput, true, "Exact bypasses retained preview frames");
    assert.equal(h.storage.get(EXACT_KEY), "true");

    setQuality(h, 0);
    assert.deepEqual([h.viewport.canvas.width, h.viewport.canvas.height], [100, 100]);
    assert.deepEqual(h.compositorSize(), [100, 100], "Full quality has no Exact change");
    assert.equal(h.viewport.__zoidiumPlayerPlusExactEffects, false);
    assert.equal(h.viewport.__zoidiumImmediateOutput, undefined, "the cache bypass is released");

    setQuality(h, 1);
    setQuality(h, 3);
    assert.deepEqual([h.viewport.canvas.width, h.viewport.canvas.height], [13, 13]);
    assert.deepEqual(h.compositorSize(), [1920, 1080]);
    setExact(h, false);
    assert.deepEqual(h.compositorSize(), [13, 13]);
  } finally { h.PlayerPlus.deactivate(); }
});

test("a sequence resolution change and a viewport resize re-apply the sizes", async () => {
  const h = harness({ resolution: [640, 360] });
  await h.activate();
  try {
    setQuality(h, 1);
    setExact(h, true);
    assert.deepEqual(h.compositorSize(), [640, 360]);
    h.sequence.properties.resolution.value = [800, 450];
    h.viewport._render();
    assert.deepEqual(h.compositorSize(), [800, 450], "a resolution change re-applies the compositor size");
    h.viewport.canvas.style.width = "200px";
    h.viewport.canvas.style.height = "100px";
    h.viewport.resize();
    assert.deepEqual([h.viewport.canvas.width, h.viewport.canvas.height], [100, 50]);
    assert.deepEqual(h.compositorSize(), [800, 450], "a resize keeps the sequence-sized compositor");
  } finally { h.PlayerPlus.deactivate(); }
});

test("exports and independent renders keep their own sizes while Exact is on", async () => {
  const h = harness();
  await h.activate();
  try {
    setQuality(h, 1);
    setExact(h, true);
    const calls = h.counts.compositorSizes.length;
    h.viewport.renderMode = true;
    h.viewport.canvas.width = 400;
    h.viewport.canvas.height = 400;
    h.viewport._render();
    assert.equal(h.counts.compositorSizes.length, calls, "an export viewport is left alone");
    assert.deepEqual([h.viewport.canvas.width, h.viewport.canvas.height], [400, 400]);
    h.viewport.renderMode = false;
    h.viewport.canvas.width = 50;
    h.viewport.canvas.height = 50;
    h.viewport.__zoidiumPickingColor = true;
    h.viewport._render();
    assert.deepEqual(h.compositorSize(), [1920, 1080], "the eyedropper still draws the exact composite");
    assert.deepEqual([h.viewport.canvas.width, h.viewport.canvas.height], [50, 50]);
  } finally { h.PlayerPlus.deactivate(); }
});

test("the memory guard disables Exact and keeps the reduced compositor", async () => {
  const h = harness({ resolution: [5000, 2800] });
  await h.activate();
  try {
    setQuality(h, 1);
    h.viewport._render();
    const box = h.pick(".zoidium-player-plus-exact");
    assert.equal(box.disabled, true);
    assert.match(box.title, /4096 px/);
    setExact(h, true);
    assert.deepEqual(h.compositorSize(), [50, 50]);
    assert.equal(h.storage.has(EXACT_KEY), false, "a disabled Exact is not stored");
  } finally { h.PlayerPlus.deactivate(); }
});

test("the GPU texture limit also disables Exact with a reason", async () => {
  const h = harness({ resolution: [3840, 2160], maxTextureSize: 2048 });
  await h.activate();
  try {
    setQuality(h, 1);
    h.viewport._render();
    const box = h.pick(".zoidium-player-plus-exact");
    assert.equal(box.disabled, true);
    assert.match(box.title, /GPU texture limit of 2048 px/);
    assert.deepEqual(h.compositorSize(), [50, 50]);
    h.sequence.properties.resolution.value = [1920, 1080];
    h.viewport._render();
    assert.equal(box.disabled, false, "a supported sequence enables Exact again");
    assert.match(box.title, /sequence resolution/);
  } finally { h.PlayerPlus.deactivate(); }
});

test("adaptive quality reduces only the viewport buffer while Exact is on", async () => {
  const h = harness({ storage: [["zoidium.player-plus.adaptive", "true"]] });
  await h.activate();
  try {
    setQuality(h, 1);
    setExact(h, true);
    assert.deepEqual(h.compositorSize(), [1920, 1080]);
    assert.match(h.pick(".zoidium-player-plus-hint").textContent, /viewport size/);
    h.viewport.editor.playback.speed = 1;
    for (let i = 0; i < 40; i++) { h.clock.now += 60; h.viewport._renderFn(); }
    assert.deepEqual([h.viewport.canvas.width, h.viewport.canvas.height], [25, 25],
      "Adaptive still lowers the viewport buffer");
    assert.deepEqual(h.compositorSize(), [1920, 1080],
      "Adaptive does not lower the exact compositor");
    assert.equal(h.viewport.__zoidiumPlayerPlusExactEffects, true);
    setExact(h, false);
    assert.match(h.pick(".zoidium-player-plus-hint").textContent, /Lowers quality/);
  } finally { h.PlayerPlus.deactivate(); }
});
