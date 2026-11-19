"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { host } = require("./helpers/editor-identity-host.cjs");
const plugin = require("../plugins/particles-plus/particles-plus.js");
const plain = value => JSON.parse(JSON.stringify(value));
test("Particles+ sprite metadata and emitter data survive package copying", () => {
  const { PZ, THREE } = host(), project = new PZ.project();
  project.threeObj = new THREE.Object3D(); project.sequence.properties.load();
  const objects = new PZ.objectList(project, PZ.object3d); project.children.push(objects);
  const sprite = "data:image/png;base64,AA==";
  PZ.ui.controls.generateTextureInput = () => [];
  plugin.activate({ PZ, editor: { project }, window: {}, document: {},
    plugin: { id: "particles-plus", version: "1" },
    manifest: { resources: [{ id: "sprite-square", type: "image" }] },
    getAsset: () => sprite, lifecycle: { onDispose() {} } });
  try {
    const create = data => { const particle = new PZ.object3d.particles(); particle.type = 8;
      objects.push(particle); particle.load(data); return particle; };
    const seed = create({ properties: { texture: null } }), authored = plain(seed);
    Object.assign(authored.properties, { number: 40, rate: 12, lifetime: 3, ipos: [3, 4, 5], texture: null });
    authored.properties.time = { animated: true, keyframes: [{ frame: 0, value: 1, tween: 1 }, { frame: 20, value: 2, tween: 1 }] };
    const original = create(authored);
    original.properties.texture.value = sprite;
    const saved = plain(original);
    assert.equal(saved._zoidiumParticlesPlusSprite, "square");
    assert.equal(saved.properties.texture, sprite);
    const packageData = plain(new PZ.package([original])).data[0];
    assert.deepEqual(packageData, saved);
    // Avoid loading image bytes in the Node host; the native asset value and
    // extension marker are restored independently by the project asset system.
    const loadWithoutImage = data => { const copy = plain(data); copy.properties.texture = null;
      const particle = create(copy); particle.properties.texture.value = data.properties.texture; return particle; };
    const duplicate = loadWithoutImage(packageData), second = loadWithoutImage(plain(duplicate));
    assert.deepEqual(plain(duplicate), saved); assert.deepEqual(plain(second), saved);
    for (const frame of [0, 7, 20]) assert.equal(duplicate.properties.time.get(frame), original.properties.time.get(frame));
    duplicate.properties.ipos.value[0] = 99;
    assert.deepEqual(plain(original), saved);
    for (const particle of [seed, original, duplicate, second]) particle.unload();
  } finally { plugin.deactivate(); }
});
