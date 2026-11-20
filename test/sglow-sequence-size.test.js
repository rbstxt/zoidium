"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { installSequence } = require("../plugins/sglow-hq-v2-preview/support.js");

test("disabled S_Glow restores the requested compositor size", () => {
  class Compositor {
    constructor(sequence) { this._sequence = sequence; this.readBuffer = { width: 320, height: 180 }; this.renderer = { capabilities: { maxTextureSize: 4096 } }; }
    setSize(width, height) { Object.assign(this.readBuffer, { width, height }); }
    renderSequence() {}
    unload() {}
  }
  class Group {}
  const effect = { pass: { enabled: true } };
  const sequence = { properties: { resolution: { get: () => [1920, 1080] } }, videoTracks: [{ layer: { effects: [effect] } }] };
  const state = { effects: new Set([effect]) };
  const release = installSequence(state, { compositor: Compositor, effect: { group: Group } });
  const compositor = new Compositor(sequence);
  compositor.renderSequence();
  assert.deepEqual([compositor.readBuffer.width, compositor.readBuffer.height], [1920, 1080]);
  effect.pass.enabled = false;
  compositor.renderSequence();
  assert.deepEqual([compositor.readBuffer.width, compositor.readBuffer.height], [320, 180]);
  effect.pass.enabled = true;
  compositor.renderSequence();
  compositor.setSize(640, 360);
  effect.pass.enabled = false;
  compositor.renderSequence();
  assert.deepEqual([compositor.readBuffer.width, compositor.readBuffer.height], [640, 360]);
  compositor.setSize(800, 450);
  compositor.renderSequence();
  assert.deepEqual([compositor.readBuffer.width, compositor.readBuffer.height], [800, 450]);
  release();
});
