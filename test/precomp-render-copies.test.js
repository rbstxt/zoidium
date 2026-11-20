"use strict";

// Precomp+ composition clips hold disposable render copies of the nested
// layers in CompLayer.objects. CM3's Objects panel maps a selected clip to
// clip.object.objects directly, so those copies would become editable there.
// Their parent tracks are not children of the composition layer, so an edit
// on one cannot resolve its address. The copies must stay out of the tree.

const assert = require("node:assert/strict");
const test = require("node:test");
const { createEnvironment, addClip, addCompMedia } = require("./precomp-fixtures.js");

function clipJSON(start, length, name) {
  return {
    start,
    length,
    properties: { name },
    link: null,
    hasMedia: false,
    object: { type: 0, properties: {}, effects: [] },
  };
}

function renderAt(env, t) {
  const track = env.project.sequence.videoTracks[0];
  track.update(t);
  const layer = track.layer;
  if (layer) layer.update(t - layer.parent.start);
  return layer;
}

test("composition render copies stay out of the editable object tree", () => {
  const env = createEnvironment();
  addCompMedia(env, "X", "X", [{ type: 0, clips: [clipJSON(0, 30, "Layer")] }]);
  addClip(env, 0, { start: 0, length: 30, compId: "X" });

  const layer = renderAt(env, 10);
  assert.ok(layer.objects.length > 0, "the compositor still sees the active render copies");
  assert.equal(layer.objects.visible, false, "the render-copy list is hidden in the edit tree");

  const panel = new env.PZ.ui.edit();
  const row = { style: {} };
  assert.equal(panel.generateObjectList(row, layer.objects), undefined);
  assert.equal(row.style.display, "none", "the Objects panel hides the list");

  const authored = [{ type: 0, clips: [clipJSON(0, 1, "a")] }];
  assert.equal(panel.generateObjectList({ style: {} }, authored), "listed",
    "authored object lists still list");
  env.uninstall();
});
