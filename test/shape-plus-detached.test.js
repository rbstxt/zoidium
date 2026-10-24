"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { createLayerClass } = require("../plugins/shape-plus/layer.js");

function host() {
  class Node {
    constructor() { this.parent = null; }
    // CM3 deliberately dereferences null here. Optional chaining the caller
    // does not protect the getter or an ancestor whose clip was removed.
    get parentObject() { return this.parent instanceof Node ? this.parent : this.parent.parentObject; }
    getParentOfType(type) { const p = this.parentObject; return p instanceof type ? p : p.getParentOfType(type); }
    tryGetParentOfType(type) { return this.parent ? this.parentObject instanceof type ? this.parentObject : this.parentObject.tryGetParentOfType(type) : null; }
    get parentProject() { return this.getParentOfType(Project); }
  }
  const prop = value => ({ get: () => value, set: next => { value = next; } });
  const vector = () => ({ set(...v) { this.value = v; }, x: 0, y: 0, z: 0 });
  class Project extends Node {
    constructor() { super(); this.sequence = { properties: { resolution: prop([1920, 1080]), rate: prop(30) } }; this.assets = { unload: asset => unloaded.push(asset) }; }
  }
  const unloaded = [];
  class Base extends Node {
    constructor() {
      super(); this.children = []; this.effects = []; this.updates = 0;
      this.properties = { resolution: prop([640, 360]), load() {} };
      this.composite = { group: { position: vector(), rotation: vector(), scale: vector() }, quad: { scale: vector(), geometry: { dispose() {} }, material: { dispose() {} } } };
    }
    load() { this.parentProject; this.vertShader = "vert"; this.fragShader = "frag"; this.loads = (this.loads || 0) + 1; }
    update() { this.updates++; }
    toJSON() { return { type: this.type, properties: this.properties }; }
    async prepare() { this.prepares = (this.prepares || 0) + 1; }
    unload() { this.parentProject.assets.unload(this.vertShader); this.parentProject.assets.unload(this.fragShader); for (const effect of this.effects) effect.unload(); }
  }
  class List extends Array { constructor(parent) { super(); this.parent = parent; } }
  class Scene { constructor() { this.children = []; } add(m) { this.children.push(m); } }
  class Resource { dispose() {} }
  class Material extends Resource { constructor(data) { super(); Object.assign(this, data); } }
  class Camera { constructor() { this.position = {}; } }
  class Mesh { constructor(g, m) { this.geometry = g; this.material = m; } }
  const THREE = { OrthographicCamera: Camera, Scene, ShaderMaterial: Material, PlaneBufferGeometry: Resource, Vector2: class {}, Mesh };
  const PZ = { layer: Base, project: Project, objectList: List };
  const Shape = createLayerClass(PZ, THREE, class {}), layer = new Shape(), project = new Project(), clip = new Node(), composite = new Node();
  composite.parent = project; clip.parent = composite; layer.parent = clip;
  return { layer, project, clip, composite, unloaded, Node };
}

test("removed Shape+ clips ignore stale update/render callbacks and refresh resolution after Undo", async () => {
  const h = host(), { layer, project, clip, composite } = h;
  layer.load({ contents: [], effects: [] });
  layer.update(12); assert.equal(layer.updates, 1);
  clip.parent = null;
  assert.throws(() => layer.parentProject, /parentObject/);
  assert.doesNotThrow(() => layer.update(13));
  assert.equal(layer.updates, 1, "detached effects must not receive update");
  assert.doesNotThrow(() => layer.pass.render(null, null));
  assert.doesNotThrow(() => layer.build(.1));
  assert.equal(layer.takeCompositeTransform(), null);
  assert.doesNotThrow(() => JSON.stringify(layer));
  await layer.prepare(13, {}); assert.equal(layer.prepares, undefined);
  project.sequence.properties.resolution.set([1280, 720]);
  clip.parent = composite; layer.update(14);
  assert.deepEqual(layer.properties.resolution.get(), [1280, 720]);
  assert.deepEqual(layer.composite.quad.scale.value, [1280, 720, 1]);
  project.sequence.properties.resolution.set([1080, 1920]); layer.update(15);
  assert.deepEqual(layer.properties.resolution.get(), [1080, 1920]);
  composite.parent = null; // Removing a composite detaches every child too.
  assert.doesNotThrow(() => layer.update(16));
  const effect = new h.Node(); effect.parent = layer; effect.unload = () => effect.parentProject.assets.unload("effect"); layer.effects.push(effect);
  assert.doesNotThrow(() => layer.unload());
  assert.deepEqual(h.unloaded, ["vert", "frag", "effect"]);
  assert.doesNotThrow(() => layer.unload());
  assert.deepEqual(h.unloaded, ["vert", "frag", "effect"], "unload is idempotent");
  assert.doesNotThrow(() => layer.pass.render(null, null));
});

test("detached load waits for attachment and uses the current sequence", () => {
  const { layer, clip, composite, project } = host();
  clip.parent = null;
  assert.doesNotThrow(() => layer.load({ contents: [], effects: [], extra: 42 }));
  assert.equal(layer.loads, undefined);
  assert.equal(layer.toJSON().extra, 42);
  project.sequence.properties.resolution.set([800, 600]); clip.parent = composite;
  layer.update(0);
  assert.equal(layer.loads, 1);
  assert.deepEqual(layer.properties.resolution.get(), [800, 600]);
});

test("Shape+ overlay rejects a removed clip before reading native ancestor getters", () => {
  const { editableClip } = require("../plugins/shape-plus/editor.js");
  const { layer, clip, composite } = host();
  const editor = { playback: { currentFrame: 0 } }, viewport = { enabled: true, objects: [clip] };
  clip.object = layer; clip.start = 0; clip.length = 180; clip.parent = null;
  assert.equal(editableClip(editor, viewport, layer.constructor, {}), null);
  clip.parent = composite; layer.parent = null;
  assert.equal(editableClip(editor, viewport, layer.constructor, {}), null);
});
