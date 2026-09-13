"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  collectVideoMaterials,
  compositeVideoMaterials,
  install,
} = require("../plugins/core/composite-video-materials");

function createPZ() {
  class Composite {}
  class Scene {}
  return { PZ: { layer: { composite: Composite, scene: Scene } }, Composite, Scene };
}

function videoMaterial(name, startOffset = 0) {
  return { name, properties: { startOffset: { value: startOffset } } };
}

test("composite aggregates video materials from nested scenes and composites", () => {
  const { PZ, Composite, Scene } = createPZ();
  const innerScene = new Scene();
  const innerMaterial = videoMaterial("a");
  innerScene.videoMaterials = [innerMaterial];

  const nestedScene = new Scene();
  const nestedMaterial = videoMaterial("b");
  nestedScene.videoMaterials = [nestedMaterial];

  const nestedComposite = new Composite();
  nestedComposite.objects = [nestedScene];

  const composite = new Composite();
  composite.objects = [innerScene, nestedComposite];

  assert.deepEqual(compositeVideoMaterials(composite, PZ), [innerMaterial, nestedMaterial]);
});

test("install exposes aggregated video materials on the composite prototype", () => {
  const { PZ, Composite, Scene } = createPZ();
  assert.equal(install(PZ), true);
  assert.equal(install(PZ), false, "install is idempotent");

  const scene = new Scene();
  const material = videoMaterial("clip");
  scene.videoMaterials = [material];

  const composite = new Composite();
  composite.objects = [scene];

  assert.deepEqual(composite.videoMaterials, [material]);
  assert.equal(scene.videoMaterials.length, 1, "scene array is untouched");
});

test("the aggregate feeds the existing CM3 schedule walk", () => {
  const { PZ, Composite, Scene } = createPZ();
  install(PZ);

  const scene = new Scene();
  const material = videoMaterial("delayed", 12);
  scene.videoMaterials = [material];

  const composite = new Composite();
  composite.objects = [scene];

  // Mirrors PZ.schedule.scheduleVideoMaterials reading clip.object.videoMaterials.
  const clip = { object: composite, start: 100, length: 50 };
  assert.ok(clip.object.videoMaterials, "composite reports video materials");
  assert.deepEqual(clip.object.videoMaterials, [material]);

  const items = clip.object.videoMaterials.map((entry) => ({
    start: clip.start + entry.properties.startOffset.value,
    media: entry.media || null,
  }));
  assert.equal(items[0].start, 112);
});

test("collectVideoMaterials stops at the depth limit", () => {
  const { PZ, Composite } = createPZ();
  let current = new Composite();
  const guard = { seen: current };
  for (let index = 0; index < 80; index += 1) {
    const next = new Composite();
    current.objects = [next];
    current = next;
  }

  assert.doesNotThrow(() => collectVideoMaterials(guard.seen, PZ, [], 0));
});

test("install declines when the composite class is unavailable", () => {
  assert.equal(install(null), false);
  assert.equal(install({ layer: {} }), false);
});
