"use strict";
// Latest-wins temporal preview scheduling: at most one preparation in flight,
// ticks queue the newest request, stale completions never draw, and the worker
// chains to the current playhead instead of waiting for the next tick.
const test = require("node:test");
const assert = require("node:assert/strict");

const { shouldDrawPreviewFrame } = require("../plugins/core/temporal-render.js");
const { host } = require("./helpers/temporal-sampler-host.cjs");

async function drainFrames(h, frame) {
  const runtime = () => h.state.frameSamplerRuntimes.get(h.root);
  for (let i = 0; i < 200 && (h.root.frames.at(-1) !== frame || runtime()?.previewPending !== false); i += 1) {
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.equal(h.root.frames.at(-1), frame);
  assert.equal(runtime()?.previewPending, false);
}

test("paused viewports draw the exact requested frame", () => {
  assert.deepEqual(
    shouldDrawPreviewFrame({ playing: false, frame: 30, liveFrame: 30 }),
    { draw: true, rebaselined: false });
});

test("paused viewports skip a completion that is no longer requested", () => {
  assert.deepEqual(
    shouldDrawPreviewFrame({ playing: false, frame: 30, liveFrame: 31 }),
    { draw: false, rebaselined: false });
});

test("playing viewports draw a completion that moves the display forward", () => {
  assert.deepEqual(
    shouldDrawPreviewFrame({ playing: true, frame: 31, liveFrame: 32, drawnFrame: 30, liveSeen: 31 }),
    { draw: true, rebaselined: false });
});

test("playing viewports skip a completion older than the displayed frame", () => {
  assert.deepEqual(
    shouldDrawPreviewFrame({ playing: true, frame: 55, liveFrame: 56, drawnFrame: 58, liveSeen: 55 }),
    { draw: false, rebaselined: false });
});

test("a discontinuous backward playhead re-baselines the display", () => {
  assert.deepEqual(
    shouldDrawPreviewFrame({ playing: true, frame: 0, liveFrame: 3, drawnFrame: 59, liveSeen: 55 }),
    { draw: true, rebaselined: true });
});

test("a first completion always draws", () => {
  assert.deepEqual(
    shouldDrawPreviewFrame({ playing: true, frame: 8, liveFrame: 9, drawnFrame: undefined, liveSeen: undefined }),
    { draw: true, rebaselined: false });
});

test("a non-finite request never draws", () => {
  assert.deepEqual(
    shouldDrawPreviewFrame({ playing: true, frame: NaN, liveFrame: 9 }),
    { draw: false, rebaselined: false });
});

test("ticks while a preparation runs queue the newest request", async () => {
  const h = host(false);
  h.viewport.editor.playback.speed = 1;
  h.viewport._render();
  h.viewport.editor.playback.currentFrame = 31;
  h.viewport._render();
  h.viewport.editor.playback.currentFrame = 32;
  h.viewport._render();
  const runtime = h.state.frameSamplerRuntimes.get(h.root);
  assert.equal(runtime.previewQueued?.frame, 32, "latest tick wins the queue");
  await drainFrames(h, 32);
  assert.equal(h.state.frameSamplerRuntimes.get(h.root).previewQueued, null, "the worker consumes the queue");
  assert.equal(h.root.frames.includes(31), false, "a superseded queued frame never draws");
});

test("the worker stops once the preview catches the playhead", async () => {
  const h = host(false);
  h.viewport._render();
  await drainFrames(h, 30);
  const runtime = h.state.frameSamplerRuntimes.get(h.root);
  assert.equal(runtime.previewPending, false);
  assert.equal(runtime.previewKey !== null, true);
  const frames = h.root.frames.length;
  h.viewport._render();
  await new Promise(setImmediate);
  assert.equal(h.root.frames.length, frames + 1, "a caught-up tick redraws the prepared frame");
});
