"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { host } = require("./helpers/editor-identity-host.cjs");

const root = path.resolve(__dirname, "..");
const parts = ["temporal-math", "temporal-layers", "temporal-capture", "temporal-sampler",
  "temporal-preview", "temporal-export", "temporal-render"];

// Only a request that keeps its own current-frame decoder owns exact preview
// decoding. Other temporal effects still read native media, so the paused-video
// seek gate must keep waiting for them exactly as before.
function fixture(request) {
  const c = host(), { PZ } = c;
  const project = new PZ.project();
  project.sequence.properties.load();
  const track = new PZ.track.video();
  project.sequence.videoTracks.push(track);
  const clip = new PZ.clip.video(6);
  clip.start = 0;
  clip.length = 100;
  track.clips.push(clip);
  const layer = clip.object;
  layer.properties.load();
  const effect = new PZ.effect();
  effect.type = "probe";
  layer.effects.push(effect);
  effect._zoidiumFrameSampler = { getRequest: () => request };
  for (const part of parts) {
    vm.runInContext(fs.readFileSync(path.join(root, "plugins/core", part + ".js"), "utf8"), c,
      { filename: part + ".js" });
  }
  const viewport = {
    compositor: { _sequence: project.sequence, readBuffer: { width: 80, height: 40 } },
    editor: { playback: { currentFrame: 0 } },
  };
  return { c, PZ, state: c.ZOIDIUM_TEMPORAL, project, layer, effect, viewport };
}

test("an Echo-like request does not own exact preview decoding", () => {
  const h = fixture({ enabled: true, preserveInputRGB: true, frames: [-1, 0] });
  assert.equal(h.state.ownsExactPreview(h.viewport, 10), false);
});

test("a request with its own current-frame decoder owns exact preview", () => {
  const h = fixture({
    enabled: true, lockCurrentFrame: true, reuseCurrentInput: true, frames: [-1, 0],
    decodeMedia: () => null,
  });
  assert.equal(h.state.ownsExactPreview(h.viewport, 10), true);
});

test("the decoder request keeps ownership while the effect is off", () => {
  const h = fixture({ enabled: false, lockCurrentFrame: true, reuseCurrentInput: true, frames: [-1, 0] });
  assert.equal(h.state.ownsExactPreview(h.viewport, 10), true);
});

test("a disabled tap list still owns preview when a decoder is retained", () => {
  const h = fixture({ enabled: false, lockCurrentFrame: true, frames: [] });
  assert.equal(h.state.ownsExactPreview(h.viewport, 10), true);
});

test("a project without sampler requests owns no exact preview", () => {
  const h = fixture(null);
  h.effect._zoidiumFrameSampler = { getRequest: () => null };
  assert.equal(h.state.ownsExactPreview(h.viewport, 10), false);
});

test("a layer-specific preview keeps its normal path", () => {
  const h = fixture({ enabled: true, lockCurrentFrame: true, frames: [-1, 0] });
  h.viewport.renderMode = "layer";
  h.viewport.layer = h.layer;
  assert.equal(h.state.ownsExactPreview(h.viewport, 10), false);
});
