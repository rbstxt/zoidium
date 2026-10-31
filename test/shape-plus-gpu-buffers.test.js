"use strict";
// Batch E (fix 7): equal-length GPU position buffer reuse in
// plugins/shape-plus/render.js. Mock-THREE tests, no browser needed.
const test = require("node:test");
const assert = require("node:assert/strict");
const { createRenderer } = require("../plugins/shape-plus/render");

function host() {
  const resources = [], draws = [];
  class Resource {
    constructor() { this.disposals = 0; resources.push(this); }
    dispose() { this.disposals++; }
  }
  class BufferAttribute {
    constructor(array) {
      this.array = array;
      this.version = 0;
      this.flag = false;
    }
    set needsUpdate(value) {
      if (value === true) { this.version++; this.flag = true; }
    }
    get needsUpdate() { return this.flag; }
  }
  class Geometry extends Resource {
    constructor() { super(); this.attributes = {}; }
    addAttribute(name, attribute) { this.attributes[name] = attribute; }
    getAttribute(name) { return this.attributes[name]; }
    scale() {}
  }
  class Material extends Resource {
    constructor(spec) { super(); Object.assign(this, spec); }
  }
  class Scene {
    constructor() { this.children = []; }
    add(mesh) { this.children.push(mesh); }
  }
  class Mesh {
    constructor(geometry, material) { this.geometry = geometry; this.material = material; }
  }
  class Target extends Resource {
    constructor(w, h) { super(); this.texture = {}; this.setSize(w, h); }
    setSize(w, h) { this.width = w; this.height = h; }
  }
  class Camera {
    constructor() { this.position = {}; }
    updateProjectionMatrix() {}
  }
  class Vector {
    set(x, y) { this.x = x; this.y = y; }
  }
  const THREE = {
    Scene, Mesh, OrthographicCamera: Camera, ShaderMaterial: Material,
    BufferGeometry: Geometry, PlaneBufferGeometry: Geometry, BufferAttribute,
    Color: class {}, Vector2: Vector, WebGLRenderTarget: Target,
  };
  const renderer = {
    capabilities: { maxTextureSize: 16384 }, autoClear: false,
    getClearColor: () => ({ clone: () => ({}) }), getClearAlpha: () => 0.7,
    setClearColor() {},
    render(scene, camera, target) { draws.push({ scene, camera, target }); },
  };
  return { THREE, renderer, resources, draws };
}

const paint = positions => ({ kind: "paint", id: "fill", positions, color: [1, 0, 0], opacity: 0.5 });

test("equal-length position changes keep geometry and attribute identity with new values", () => {
  const h = host(), engine = createRenderer(h.THREE);
  engine.setCommands([paint([0, 0, 0, 1, 0, 0, 0, 1, 0])], [640, 360]);
  const mesh = engine.scene.children[0];
  const geometry = mesh.geometry, material = mesh.material;
  const attribute = geometry.getAttribute("position");
  const count = h.resources.length;
  engine.setCommands([paint([0, 0, 0, 2, 0, 0, 0, 2, 0])], [640, 360]);
  assert.equal(engine.scene.children[0].geometry, geometry, "geometry object is stable");
  assert.equal(engine.scene.children[0].material, material, "material is stable");
  assert.equal(engine.scene.children[0].geometry.getAttribute("position"), attribute, "attribute is stable");
  assert.deepEqual(Array.from(attribute.array), [0, 0, 0, 2, 0, 0, 0, 2, 0], "new values are present");
  assert.equal(attribute.needsUpdate, true, "attribute is flagged with the r91 update mechanism");
  assert.equal(attribute.version, 1, "exactly one upload flagged");
  assert.equal(geometry.disposals, 0, "no disposal on equal-length change");
  assert.equal(h.resources.length, count, "no new GPU objects allocated");
  engine.dispose();
});

test("unchanged positions flag no upload", () => {
  const h = host(), engine = createRenderer(h.THREE);
  engine.setCommands([paint([0, 0, 0, 1, 0, 0, 0, 1, 0])], [640, 360]);
  const attribute = engine.scene.children[0].geometry.getAttribute("position");
  engine.setCommands([paint([0, 0, 0, 1, 0, 0, 0, 1, 0])], [640, 360]);
  assert.equal(attribute.version, 0, "identical positions cause no upload");
  engine.dispose();
});

test("a changed length keeps the dispose-and-replace route", () => {
  const h = host(), engine = createRenderer(h.THREE);
  engine.setCommands([paint([0, 0, 0, 1, 0, 0, 0, 1, 0])], [640, 360]);
  const geometry = engine.scene.children[0].geometry;
  engine.setCommands([paint([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 2, 0])], [640, 360]);
  assert.equal(geometry.disposals, 1, "old geometry is disposed");
  assert.notEqual(engine.scene.children[0].geometry, geometry, "geometry is replaced");
  assert.deepEqual(
    Array.from(engine.scene.children[0].geometry.getAttribute("position").array),
    [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 2, 0],
  );
  engine.dispose();
});

test("no stale values after alternating lengths", () => {
  const h = host(), engine = createRenderer(h.THREE);
  const first = [0, 0, 0, 1, 0, 0, 0, 1, 0];
  const second = [5, 5, 5, 6, 5, 5, 6, 6, 5];
  const longer = [...first, 0, 3, 0];
  engine.setCommands([paint(first)], [640, 360]);
  engine.setCommands([paint(second)], [640, 360]);
  const reused = engine.scene.children[0].geometry;
  assert.deepEqual(Array.from(reused.getAttribute("position").array), second);
  engine.setCommands([paint(longer)], [640, 360]);
  assert.equal(reused.disposals, 1, "length change disposes the reused buffer");
  const grown = engine.scene.children[0].geometry;
  assert.deepEqual(Array.from(grown.getAttribute("position").array), longer);
  engine.setCommands([paint(first)], [640, 360]);
  assert.equal(grown.disposals, 1, "shrinking back disposes again");
  assert.deepEqual(Array.from(engine.scene.children[0].geometry.getAttribute("position").array), first);
  // One more equal-length edit after the alternation must copy, not keep the older array.
  engine.setCommands([paint(second)], [640, 360]);
  assert.deepEqual(Array.from(engine.scene.children[0].geometry.getAttribute("position").array), second);
  engine.dispose();
});

test("finite-range validation is preserved on the reuse path", () => {
  const h = host(), engine = createRenderer(h.THREE);
  engine.setCommands([paint([0, 0, 0, 1, 0, 0, 0, 1, 0])], [640, 360]);
  const geometry = engine.scene.children[0].geometry;
  const attribute = geometry.getAttribute("position");
  const before = Array.from(attribute.array);
  assert.throws(
    () => engine.setCommands([paint([0, 0, 0, 1e300, 0, 0, 0, 1, 0])], [640, 360]),
    /Float32 range/,
    "values that overflow Float32 still throw",
  );
  assert.equal(engine.scene.children[0].geometry, geometry, "failed update keeps the old buffer");
  assert.deepEqual(Array.from(attribute.array), before, "failed update writes nothing");
  engine.dispose();
});

test("structure changes and dispose free every reused buffer", () => {
  const h = host(), engine = createRenderer(h.THREE);
  engine.setCommands([paint([0, 0, 0, 1, 0, 0, 0, 1, 0])], [640, 360]);
  engine.setCommands([paint([0, 0, 0, 2, 0, 0, 0, 2, 0])], [640, 360]);
  const geometry = engine.scene.children[0].geometry;
  assert.equal(geometry.disposals, 0, "reuse path allocated nothing to retire yet");
  engine.setCommands([], [640, 360]);
  assert.equal(geometry.disposals, 1, "structure change retires the reused buffer");
  engine.setCommands([paint([0, 0, 0, 3, 0, 0, 0, 3, 0])], [640, 360]);
  engine.dispose();
  assert.ok(h.resources.every(r => r.disposals === 1), "dispose frees everything exactly once");
});
