'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const harness = require('./camera-plus-harness');

function host() {
  const ctx = harness.createContext();
  const { PZ, THREE } = ctx;
  PZ.layer.composite = class extends PZ.layer { constructor() { super(); this.objects = []; } };
  PZ.object3d.group = class extends PZ.object3d {
    constructor() { super(); this.type = 5; this.objects = []; this.threeObj = new THREE.Object3D(); this.calls = []; }
    update(t) { this.calls.push(t); this.threeObj.position.x = t; for (const child of this.objects) child.update(t); }
  };
  const parts = { camera: { OBJECT_TYPE: 'zoidium:camera-plus/camera' }, sharedDepth: () => ({ begin() {}, finish() {}, end() {} }) };
  for (const file of ['camera-search.js', 'shared-camera.js']) {
    new Function('parts', harness.readPluginSource(file))(parts);
  }
  const cameraLike = o => o.type === 6 || o.type === parts.camera.OBJECT_TYPE || o instanceof PZ.object3d.camera;
  function walk(objects, t, plus) {
    for (const o of objects || []) {
      if (o.properties?.enabled && o.properties.enabled.get(t) !== 1) continue;
      if (plus ? o.type === parts.camera.OBJECT_TYPE && o.isActive() : cameraLike(o)) return o;
      const child = walk(o.objects, t, plus); if (child) return child;
    }
  }
  const shared = parts.shared({ PZ, THREE, apis: ctx.apis, teardown: [], migrateCameraData: x => x,
    patchMethod(holder, key, value) { holder[key] = value; }, syncScene() {}, getProject: () => null,
    findActiveCamera: (s, t) => walk(s.objects, t, true), nativeCameraObjectOf: s => walk(s.objects, 0, false) });
  function object(type = 0) { const o = new PZ.object3d(); o.type = type; o.calls = []; o.update = t => o.calls.push(t); return o; }
  function camera(type = 6) { const o = object(type); o.threeObj = new THREE.PerspectiveCamera(); o.isActive = () => true; return o; }
  function scene(objects, name = 'Scene', dedicated = false) {
    const s = dedicated ? new shared.CameraLayer() : new PZ.layer.scene();
    s.objects.push(...objects); s.properties.name.set(name); return s;
  }
  function track(layer, name = '', start = 0) { const clip = { start, object: layer, properties: { name: { get: () => name } } }; return { getCurrentClip: () => clip }; }
  return { ...ctx, parts, shared, object, camera, scene, track };
}

test('camera-free scenes never update objects during shared-camera lookup', () => {
  const h = host(); const geometry = Array.from({ length: 100 }, () => h.object());
  const camera = h.camera(); const sequence = { videoTracks: [h.track(h.scene(geometry)), h.track(h.scene([camera]))] };
  for (let i = 0; i < 14; i++) assert.equal(h.shared.masterAt(sequence, 185).camera, camera);
  assert.equal(geometry.reduce((n, o) => n + o.calls.length, 0), 0);
  assert.equal(camera.calls.length, 14);
});

test('master scoring preserves Camera layers, names, depth, track order, and transform-card exclusion', () => {
  const h = host(); const first = h.scene([h.camera()]); const named = h.scene([h.camera()]);
  const nested = new h.PZ.layer.composite(); nested.objects.push(h.scene([h.camera()], 'camera'));
  const dedicated = h.scene([h.camera()], 'Camera', true);
  const card = new h.PZ.layer.composite(); card.effects.push({ type: 'transform' }); card.objects.push(h.scene([h.camera()], 'Camera', true));
  const sequence = { videoTracks: [h.track(first), h.track(nested), h.track(named, 'Camera shot'), h.track(card), h.track(dedicated)] };
  assert.equal(h.shared.masterAt(sequence, 0).layer, dedicated);
  sequence.videoTracks[4].enabled = false;
  assert.equal(h.shared.masterAt(sequence, 0).layer, named);
  sequence.videoTracks[2].enabled = false;
  assert.equal(h.shared.masterAt(sequence, 0).layer, nested.objects[0]);
  nested.objects[0].properties.name.set('Scene');
  assert.equal(h.shared.masterAt(sequence, 0).layer, first);
  assert.equal(card.objects[0].objects[0].calls.length, 0);
});

test('Camera layer enabled keyframes and local clip time are evaluated on every lookup, including same-frame edits', () => {
  const h = host(); const camera = h.camera(h.parts.camera.OBJECT_TYPE); const fallback = h.camera();
  camera.properties.add('enabled', { value: 1 }); camera.properties.enabled.get = t => t < 10 ? 0 : 1;
  const layer = h.scene([camera, fallback], 'Camera', true); const sequence = { videoTracks: [h.track(layer, '', 20)] };
  assert.equal(h.shared.masterAt(sequence, 29).camera, fallback);
  assert.equal(h.shared.masterAt(sequence, 30).camera, camera);
  camera.isActive = () => false;
  assert.equal(h.shared.masterAt(sequence, 30).camera, fallback);
  assert.deepEqual(camera.calls, [9, 10, 10]);
});

test('parented cameras update their ancestor transforms without updating unrelated siblings', () => {
  const h = host(); const camera = h.camera(); const sibling = h.object(); const group = new h.PZ.object3d.group();
  group.objects.push(sibling, camera); group.threeObj.add(camera.threeObj);
  const sequence = { videoTracks: [h.track(h.scene([group]))] };
  assert.equal(h.shared.masterAt(sequence, 7).camera, camera);
  assert.equal(group.threeObj.position.x, 7); assert.deepEqual(group.calls, [7]);
  assert.deepEqual(camera.calls, [7]); assert.equal(sibling.calls.length, 0);
  assert.deepEqual(group.objects, [sibling, camera], 'authored object list is unchanged');
});

for (const dependency of ['expression', 'track-to', 'unknown']) test(`${dependency} dependencies retain full updates in that camera scene only`, () => {
  const h = host(); const camera = h.camera(); const target = h.object(); const unrelated = h.object();
  if (dependency === 'expression') camera.properties.add('linked', { value: 0 }).expression = 'target.position';
  if (dependency === 'track-to') camera.properties.add('zoidiumTrackTo', { value: 'target-id' });
  if (dependency === 'unknown') target.type = 'zoidium:other/object';
  const sequence = { videoTracks: [h.track(h.scene([target, camera])), h.track(h.scene([unrelated]))] };
  assert.equal(h.shared.masterAt(sequence, 9).camera, camera);
  assert.deepEqual(target.calls, [9]); assert.equal(unrelated.calls.length, 0);
});

test('one sequence sample updates a layer once; shutter samples restore its authored frame', () => {
  const h = host(); const layer = new h.PZ.layer(); const times = [];
  layer.parent = { start: 10 }; layer.update = t => times.push(t);
  layer.properties.add('motionBlurAmount', { value: 1 });
  const properties = new h.PZ.propertyList({
    motionBlur: { value: 0 }, motionBlurSamples: { value: 3 }, motionBlurShutter: { value: 2 }, resolution: { value: [1920, 1080] },
  });
  const compositor = Object.create(h.PZ.compositor.prototype);
  compositor._sequence = { properties, videoTracks: [{ layer, track3d: true }] };
  compositor.readBuffer = { width: 240 }; compositor.accumBuffers = [{}, {}]; compositor.screenBuffers = [{}];
  compositor.renderer = { clearTarget() {}, setClearColor() {} }; compositor.clear = () => {};
  compositor.mixPass = { render() {} }; compositor.swapAccumBuffers = () => {};
  compositor.copyPass = { uniforms: { tDiffuse: {}, opacity: {} }, render() {} };
  compositor.renderLayer = () => {};
  compositor.renderSequence(20);
  assert.deepEqual(times, [10]);
  times.length = 0; properties.motionBlur.set(1);
  compositor.renderSequence(20);
  assert.deepEqual(times, [9, 9 + 2 / 3, 9 + 4 / 3, 10]);
});

test('vector-component and custom-property expressions trigger the scene fallback', () => {
  const h = host(); const camera = h.camera(); const other = h.object();
  camera.properties.add('position', { objects: [{ value: 0 }] }).objects[0].expression = 'worldPosition()';
  const sequence = { videoTracks: [h.track(h.scene([other, camera]))] };
  h.shared.masterAt(sequence, 2); assert.deepEqual(other.calls, [2]);
  camera.properties.position.objects[0].expression = null;
  camera.customProperties = [{ expression: 'arbitraryNativeCode()' }];
  h.shared.masterAt(sequence, 3); assert.deepEqual(other.calls, [2, 3]);
});
