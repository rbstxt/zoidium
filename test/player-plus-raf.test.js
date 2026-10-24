"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const PlayerPlus = require("../plugins/player-plus/player-plus.js");
const { makeDocument, FakeElement } = require("./fake-dom.js");

test("Player+ cycles own one native RAF and Render once never resumes drawing", async () => {
  const pending = new Map(); let next = 0, renders = 0;
  const window = {
    requestAnimationFrame(fn) { pending.set(++next, fn); return next; },
    cancelAnimationFrame(id) { pending.delete(id); },
  };
  class Viewport {
    constructor() { this.enabled = true; this._renderFn = () => { this.animFrameReq = window.requestAnimationFrame(this._renderFn); this._render(); }; }
    _render() { renders++; }
    resize() {}
  }
  const viewport = new Viewport(), document = makeDocument(), toolbar = new FakeElement("div");
  toolbar.querySelector = () => true;
  document.getElementById = () => null;
  document.querySelectorAll = selector => selector === "canvas" ? [{ parentElement: { pz_panel: viewport } }] : [toolbar];
  const context = { window, document, PZ: { ui: { viewport: Viewport, generateIcon: () => new FakeElement("svg"), switchIcon() {} } } };
  const tick = () => { const work = [...pending]; pending.clear(); for (const [, fn] of work) fn(); };
  const button = cls => toolbar.children.find(child => child.classList.contains(cls));
  viewport._renderFn();
  for (let i = 0; i < 10; i++) {
    await PlayerPlus.activate(context); tick();
    assert.equal(pending.size, 1);
    PlayerPlus.deactivate();
    assert.equal(pending.size, 1, "disabling running drawing adds no RAF");
    tick();
  }
  await PlayerPlus.activate(context); tick();
  button("zoidium-player-plus-pause").dispatch("click");
  assert.equal(pending.size, 0);
  const before = renders;
  button("zoidium-player-plus-render-once").dispatch("click");
  assert.equal(renders, before + 1);
  // Render once does not enter the native RAF callback.
  tick();
  assert.equal(pending.size, 0);
  button("zoidium-player-plus-pause").dispatch("click");
  assert.equal(pending.size, 1);
  button("zoidium-player-plus-pause").dispatch("click");
  viewport.enabled = false;
  PlayerPlus.deactivate();
  assert.equal(pending.size, 0, "disabling a native-disabled viewport leaves it stopped");
});
