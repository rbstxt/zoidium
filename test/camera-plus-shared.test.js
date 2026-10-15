const test = require('node:test');
const assert = require('node:assert/strict');
const harness = require('./camera-plus-harness');
test('Davidium Camera layers retain type 9 and migrate animated camera, film, DOF and vibrate values', () => {
  const ctx = harness.createContext(); const runtime = harness.loadRuntime();
  runtime.activate(ctx.context);
  try {
    const layer = ctx.PZ.layer.create(9);
    layer.load({ type: 9, properties: { name: 'Camera' }, effects: [], objects: [{ type: 6, objectType: 2, properties: {
      position: { animated: true, keyframes: [{ frame: 0, value: [1, 2, 80], tween: 1 }] },
      focalLength: 50, filmGate: 36, dof: 1, dofFocusDistance: 40,
      vibrate: { seed: 17, enablePosition: 1, positionAmplitude: [1, 0, 0] },
    } }] });
    assert.equal(layer.type, 9);
    const camera = layer.objects[0];
    assert.equal(camera.type, 'zoidium:camera-plus/camera');
    assert.equal(camera.properties.projection.get(), 'orthographic');
    assert.equal(camera.properties.focalLength.get(0), 50);
    assert.equal(camera.properties.depthOfField.focusDistance.get(0), 40);
    assert.equal(camera.properties.vibrate.seed.get(), 17);
    layer.update(0);
    assert.equal(layer.getCamera(0), camera);
    assert.equal(camera.properties.depthOfField.enabled.get(0), 1);
    const first = camera.threeObj.position.x;
    layer.update(23); layer.update(0);
    assert.equal(camera.threeObj.position.x, first);
  } finally { runtime.deactivate(); }
});
test('new Camera layers default to Camera+ and support ordinary CM3 camera objects', () => {
  const ctx = harness.createContext(); const runtime = harness.loadRuntime(); runtime.activate(ctx.context);
  try {
    const layer = ctx.PZ.layer.create(9); layer.load({ effects: [], objects: [] });
    assert.equal(layer.objects[0].type, 'zoidium:camera-plus/camera');
    const vanilla = ctx.PZ.layer.create(9); vanilla.load({ effects: [], objects: [{ type: 6, objectType: 1 }] });
    assert.equal(vanilla.objects[0].type, 6);
  } finally { runtime.deactivate(); }
});

test('sequence shutter directions use fixed frame offsets', () => {
  const parts = {};
  new Function('parts', harness.readPluginSource('shared-camera.js'))(parts);
  const offsets = direction => Array.from({ length: 4 }, (_, sample) => parts.sharedShutterOffset(sample, 4, 2, direction));
  assert.deepEqual(offsets(0), [-1, -.5, 0, .5]);
  assert.deepEqual(offsets(1), [-2, -1.5, -1, -.5]);
  assert.deepEqual(offsets(2), [0, .5, 1, 1.5]);
  assert.equal(parts.sharedShutterOffset(0, 1, 2, 0), 0);
  assert.deepEqual(offsets(0), offsets(0));
});

test('flat-track toggle and Transform bootstrap form one reversible history operation', () => {
  const ctx = harness.createContext();
  ctx.PZ.layer.adjustment = class extends ctx.PZ.layer {};
  ctx.PZ.effect = { create(type) { return { type, load() {}, unload() { assert.equal(layer.effects.includes(this), true, "unload while still parented"); } }; } };
  const layer = new ctx.PZ.layer();
  const track = { track3d: false, clips: [{ object: layer }] };
  const commands = [];
  const tracked = new Set();
  ctx.PZ.zoidium.trackPluginResource = (resource, metadata) => { assert.equal(metadata.feature, 'track3d'); tracked.add(resource); };
  ctx.PZ.zoidium.untrackPluginResource = resource => tracked.delete(resource);
  ctx.editor.project.ui = {};
  ctx.editor.history.pushCommand = (fn, info) => commands.push({ fn, info });
  const runtime = harness.loadRuntime(); runtime.activate(ctx.context);
  try {
    ctx.apis.timeline.buttonSpec.onToggle(track, ctx.editor);
    assert.equal(track.track3d, true); assert.equal(layer.effects.length, 1); assert.equal(tracked.size, 1);
    assert.deepEqual(ctx.editor.log, [["start"], ["finish"]]);
    let command = commands.pop(); command.fn(command.info);
    assert.equal(track.track3d, false); assert.equal(layer.effects.length, 0); assert.equal(tracked.size, 0);
    command = commands.pop(); command.fn(command.info);
    assert.equal(track.track3d, true); assert.equal(layer.effects.length, 1); assert.equal(tracked.size, 1);
  } finally { runtime.deactivate(); }
});
test('a Scene restores the exact CM3 camera it used before borrowing Camera+', () => {
  const ctx = harness.createContext(); const runtime = harness.loadRuntime(); runtime.activate(ctx.context);
  try {
    const scene = new ctx.PZ.layer.scene();
    const first = scene.push(new ctx.PZ.object3d.camera()); first.load({ type: 6 });
    const last = scene.push(new ctx.PZ.object3d.camera()); last.load({ type: 6 });
    const original = scene.pass.camera;
    const camera = scene.push(ctx.registry.instantiate('zoidium:camera-plus/camera')); camera.load({});
    scene.update(0); assert.equal(scene.pass.camera, camera.threeObj);
    camera.properties.active.set(0); scene.update(0);
    assert.equal(scene.pass.camera, original);
    assert.equal(scene.pass.camera, last.threeObj);
  } finally { runtime.deactivate(); }
});
test('project replacement releases discarded Camera+ instances before unregistering', () => {
  const ctx = harness.createContext(); let listener; let released = 0;
  ctx.editor.onProjectChanged = { watch(fn) { listener = fn; }, unwatch(fn) { if (listener === fn) listener = null; } };
  const runtime = harness.loadRuntime(); runtime.activate(ctx.context);
  const camera = ctx.registry.instantiate('zoidium:camera-plus/camera'); camera.load({});
  camera.unload = () => { released++; };
  ctx.project.register([0, 0], camera);
  ctx.editor.project = { forEachItemOfType() {} };
  listener(); assert.equal(released, 1);
  runtime.deactivate(); assert.equal(listener, null);
});

test('depth properties do not serialize an incompletely loaded Text/Shape layer', () => {
  const ctx = harness.createContext(); const runtime = harness.loadRuntime(); runtime.activate(ctx.context);
  try {
    const layer = new ctx.PZ.layer();
    layer.toJSON = () => { throw new Error('geometry not loaded yet'); };
    assert.doesNotThrow(() => layer.load({ effects: [] }));
    assert.doesNotThrow(() => layer.update(0));
    assert.equal(layer.properties.depth.get(0), 0);
  } finally { runtime.deactivate(); }
});
test('loading creates depth property shells and lets CM3 initialize them exactly once', () => {
  const ctx = harness.createContext();
  const create = ctx.PZ.property.create;
  ctx.PZ.property.create = definition => {
    const property = create(definition);
    const load = property.load;
    property.loadCount = 0;
    property.load = function () { this.loadCount++; return load.apply(this, arguments); };
    return property;
  };
  const runtime = harness.loadRuntime(); runtime.activate(ctx.context);
  try {
    const layer = ctx.PZ.layer.create(9); layer.load({ effects: [], objects: [], properties: { depth: 3 } });
    for (const key of ['depth', 'rotationX', 'rotationY', 'motionBlurAmount']) assert.equal(layer.properties[key].loadCount, 1, key);
    layer.update(0);
    for (const key of ['depth', 'rotationX', 'rotationY', 'motionBlurAmount']) assert.equal(layer.properties[key].loadCount, 1, key);
  } finally { runtime.deactivate(); }
});

test('sequence tracking properties are initialized once by native sequence load', () => {
  const ctx = harness.createContext();
  const create = ctx.PZ.property.create;
  ctx.PZ.property.create = definition => {
    const property = create(definition); const load = property.load;
    property.loadCount = 0;
    property.load = function () { this.loadCount++; return load.apply(this, arguments); };
    return property;
  };
  ctx.PZ.sequence.prototype.load = function (data) { this.properties.load(data.properties); };
  const runtime = harness.loadRuntime(); runtime.activate(ctx.context);
  try {
    const sequence = Object.create(ctx.PZ.sequence.prototype); sequence.properties = new ctx.PZ.propertyList({});
    sequence.load({ properties: {} });
    assert.equal(sequence.properties.motionBlurTrackFrame.loadCount, 1);
    assert.equal(sequence.properties.motionBlurSensitivity.loadCount, 1);
  } finally { runtime.deactivate(); }
});

test('DoubleSide belongs only to the shared-camera follow path and restores when the master disappears', () => {
  const ctx = harness.createContext();
  ctx.THREE.DoubleSide = 2;
  ctx.THREE.Quaternion = class {};
  ctx.THREE.Euler.prototype.setFromQuaternion = function () { return this; };
  ctx.PZ.layer.adjustment = class extends ctx.PZ.layer {};
  ctx.PZ.layer.composite = class extends ctx.PZ.layer {};
  const runtime = harness.loadRuntime(); runtime.activate(ctx.context);
  try {
    const scene = new ctx.PZ.layer.scene();
    const camera = scene.push(ctx.registry.instantiate('zoidium:camera-plus/camera')); camera.load({});
    camera.threeObj.getWorldQuaternion = () => {};
    const cameraTrack = new ctx.PZ.track.video();
    cameraTrack.getCurrentClip = () => ({ start: 0, object: scene });
    const layer = new ctx.PZ.layer();
    const track = new ctx.PZ.track.video(); track.track3d = true; layer.parent = track;
    track.getCurrentClip = () => ({ start: 0, object: layer });
    const material = { side: 0 };
    layer.effects.push({ type: 'transform', pass: { camera: new ctx.THREE.PerspectiveCamera(), quad: new ctx.THREE.Object3D() } });
    layer.effects[0].pass.quad.material = material;
    layer.effects[0].pass.quad.scale = new ctx.THREE.Vector3(1, 1, 1);
    layer.composite = { group: new ctx.THREE.Object3D() };
    layer.composite.group.scale = new ctx.THREE.Vector3(1, 1, 1);
    layer.properties.add('resolution', { value: [1920, 1080] });
    layer.properties.add('position', { value: [0, 0] });
    layer.properties.add('scale', { value: [-1, 1] });
    layer.properties.add('rotation', { value: 0 });
    const compositor = Object.create(ctx.PZ.compositor.prototype);
    compositor._sequence = { videoTracks: [cameraTrack, track] };
    compositor.renderLayer(layer);
    assert.equal(material.side, 2, 'mirrored footage draws both sides');
    cameraTrack.enabled = false;
    compositor.renderLayer(layer);
    assert.equal(material.side, 0, 'no shared camera restores original material');
    cameraTrack.enabled = true;
    compositor.renderLayer(layer);
    assert.equal(material.side, 2);
    track.track3d = false;
    compositor.renderLayer(layer);
    assert.equal(material.side, 0, 'ordinary Transform stays unchanged');
  } finally { runtime.deactivate(); }
});
