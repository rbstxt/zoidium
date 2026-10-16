"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { createMapping } = require("../plugins/shape-plus/viewport-mapping");
const { transform, matrix } = require("../plugins/shape-plus/compiler");
const { multiply } = require("../plugins/shape-plus/editor-geometry");
const close = (a, b) => a.forEach((value, i) => assert.ok(Math.abs(value - b[i]) < 1e-9, `${a} != ${b}`));
for (const quality of [1, .5, .25, .125])
  test(`preview mapping ignores ${quality} backing quality and letterboxing`, () => {
    const rect = { left: 237, top: 119, width: 800, height: 450 };
    const mapping = createMapping({ ...rect, backingWidth: 800 * quality }, [1920, 1080], {});
    close(mapping.screen([0, 0]), [400, 225]);
    close(mapping.client([237, 119]), [-960, 540]);
    close(mapping.client([1037, 569]), [960, -540]);
  });
test("preview inverse includes layer rotation, negative nonuniform scale, group anchors and nested transforms", () => {
  const layer = { position: [210, -76], scale: [-1.5, .7], rotation: .9 };
  const groups = [
    { anchor: [13, 29], position: [-36, 70], scale: [.8, -1.3], rotation: -.4 },
    { anchor: [-4, 12], position: [25, 63], scale: [2, .6], rotation: .2 },
  ];
  const rect = { left: 150, top: 90, width: 720, height: 405 };
  const mapping = createMapping(rect, [1920, 1080], layer, groups);
  const world = groups.reduce((m, p) => multiply(m, matrix(p)), matrix(layer));
  for (const point of [[0, 0], [-214, 77], [119, -31]]) {
    const evaluated = transform(point, world);
    close(mapping.screen(point), [360 + evaluated[0] * .375, 202.5 - evaluated[1] * .375]);
    close(mapping.local(mapping.screen(point)), point);
    close(mapping.client(mapping.screen(point).map((v, i) => v + [150, 90][i])), point);
  }
});
test("zero size and singular layer/group transforms refuse editing", () => {
  const rect = { left: 0, top: 0, width: 640, height: 360 };
  assert.equal(createMapping({ ...rect, width: 0 }, [640, 360], {}), null);
  assert.equal(createMapping(rect, [640, 360], { scale: [0, 1] }), null);
  assert.equal(createMapping(rect, [640, 360], {}, [{ scale: [1, 0] }]), null);
});

test("overlay admits one direct planar clip and rejects ambiguous or singular contexts", () => {
  const { editableClip } = require("../plugins/shape-plus/editor");
  class Layer {}
  class Sequence {}
  const PZ = { sequence: Sequence }, sequence = new Sequence();
  const editor = { sequence, playback: { currentFrame: 15 } };
  const property = value => ({ get: () => value });
  const layer = new Layer(); layer.effects = [];
  layer.properties = { position: property([20, 50]), scale: property([-2, .5]), rotation: property(.3) };
  const clip = { start: 10, length: 30, offset: 5, object: layer, tryGetParentOfType: () => sequence };
  layer.parentObject = clip;
  const viewport = { enabled: true, renderMode: false, objects: [clip] };
  const check = () => editableClip(editor, viewport, Layer, PZ);
  assert.equal(check(), clip);
  viewport.renderMode = true; assert.equal(check(), null); viewport.renderMode = false;
  viewport.objects = [clip, clip]; assert.equal(check(), null); viewport.objects = [clip];
  layer.parentObject = {}; assert.equal(check(), null); layer.parentObject = clip;
  clip.tryGetParentOfType = () => new Sequence(); assert.equal(check(), null); clip.tryGetParentOfType = () => sequence;
  layer.effects.push({}); assert.equal(check(), clip); layer.effects.length = 0;
  layer.properties.scale = property([0, 1]); assert.equal(check(), null); layer.properties.scale = property([1, 1]);
  editor.playback.currentFrame = 40; assert.equal(check(), null);
  editor.playback.currentFrame = 9; assert.equal(check(), null);
  editor.playback.currentFrame = 15; viewport.enabled = false; assert.equal(check(), null);
});
