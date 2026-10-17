"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createRenderer } = require("../plugins/shape-plus/render");
const { createLayerClass } = require("../plugins/shape-plus/layer");

class Matrix4 {
  constructor() { this.elements = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; }
  // Row-major arguments, column-major storage, as in three r91.
  set(...rows) { for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) this.elements[c * 4 + r] = rows[r * 4 + c]; return this; }
}
function host() {
  const resources = [], draws = [];
  class Resource { constructor() { this.disposals = 0; resources.push(this); } dispose() { this.disposals++; } }
  class Geometry extends Resource { addAttribute() {} scale() {} }
  class Material extends Resource { constructor(spec) { super(); Object.assign(this, spec); } }
  class Scene { constructor() { this.children = []; } add(mesh) { this.children.push(mesh); } }
  class Object3D { constructor() { this.matrix = new Matrix4(); this.matrixAutoUpdate = true; this.matrixWorldNeedsUpdate = false; this.position = { x: 0, y: 0, z: 0 }; } }
  class Mesh extends Object3D { constructor(geometry, material) { super(); this.geometry = geometry; this.material = material; } }
  class Target extends Resource { constructor(w, h) { super(); this.texture = {}; this.setSize(w, h); } setSize(w, h) { this.width = w; this.height = h; } }
  class Camera extends Object3D { updateProjectionMatrix() {} }
  class Vector { set(x, y) { this.x = x; this.y = y; } }
  const THREE = { Scene, Mesh, OrthographicCamera: Camera, ShaderMaterial: Material, BufferGeometry: Geometry, PlaneBufferGeometry: Geometry,
    BufferAttribute: class {}, Color: class {}, Vector2: Vector, Matrix3: class { set() {} }, Matrix4, WebGLRenderTarget: Target };
  const renderer = { capabilities: { maxTextureSize: 16384 }, autoClear: false, getClearColor: () => ({ clone: () => ({}) }), getClearAlpha: () => 1, setClearColor() {},
    render(scene, camera, target) { draws.push({ scene, camera, target, cameraMatrix: camera.matrix.elements.slice(), auto: camera.matrixAutoUpdate }); } };
  return { THREE, renderer, resources, draws };
}
// Apply a column-major 2D-affine matrix (with z translation) and its inverse.
const apply = (e, [x, y]) => [e[0] * x + e[4] * y + e[12], e[1] * x + e[5] * y + e[13]];
function view(e) {
  const det = e[0] * e[5] - e[1] * e[4];
  const a = e[5] / det, b = -e[1] / det, c = -e[4] / det, d = e[0] / det;
  return point => { const x = point[0] - e[12], y = point[1] - e[13]; return [a * x + c * y, b * x + d * y]; };
}
const close = (actual, expected) => actual.forEach((value, i) => assert.ok(Math.abs(value - expected[i]) < 1e-9, `${actual} != ${expected}`));
const paint = { kind: "paint", id: "fill", positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], color: [1, 0, 0], opacity: 1 };
const destination = { viewport: { z: 640, w: 360 } };
const L = (() => { const t = .5, sx = 4, sy = 2; return [Math.cos(t) * sx, Math.sin(t) * sx, -Math.sin(t) * sy, Math.cos(t) * sy, 30, -20]; })();
const mapL = p => [L[0] * p[0] + L[2] * p[1] + L[4], L[1] * p[0] + L[3] * p[1] + L[5]];

test("baked transform puts content at L and keeps isolation planes screen-aligned", () => {
  const h = host(), engine = createRenderer(h.THREE);
  engine.setCommands([{ kind: "isolation", id: "iso", opacity: 1, commands: [paint] }, paint], [640, 360]);
  engine.render(h.renderer, destination);
  assert.equal(engine.camera.matrixAutoUpdate, true, "untransformed renders keep the auto camera at z=10");
  assert.equal(engine.camera.position.z, 10);
  engine.render(h.renderer, destination, L);
  const cameraMatrix = engine.camera.matrix.elements;
  assert.equal(engine.camera.matrixAutoUpdate, false);
  assert.equal(engine.camera.matrixWorldNeedsUpdate, true);
  assert.equal(cameraMatrix[14], 10);
  const toView = view(cameraMatrix);
  for (const p of [[0, 0], [10, 5], [-120, 33]]) close(toView(p), mapL(p));
  const plane = h.draws.at(-2).scene.children[0];
  assert.equal(plane.matrixAutoUpdate, false);
  for (const p of [[320, 180], [-320, -180], [7, 9]]) close(toView(apply(plane.matrix.elements, p)), p);
  assert.ok(h.draws.slice(-3, -1).every(draw => draw.cameraMatrix.every((v, i) => v === cameraMatrix[i])), "child and parent use the same camera");
  engine.render(h.renderer, destination, null);
  assert.equal(engine.camera.matrixAutoUpdate, true);
  assert.equal(plane.matrixAutoUpdate, true);
  assert.throws(() => engine.render(h.renderer, destination, [0, 0, 0, 0, 1, 1]), /Invalid Shape\+ layer transform/);
  engine.dispose();
});

test("unchanged content, size and transform skip the supersampled tree but always resolve", () => {
  const h = host(), engine = createRenderer(h.THREE);
  engine.setCommands([{ kind: "isolation", id: "iso", opacity: 1, commands: [paint] }], [640, 360]);
  const resolves = () => h.draws.filter(draw => !("disposals" in draw.target)).length;
  engine.render(h.renderer, destination);
  assert.equal(h.draws.length, 3);
  engine.render(h.renderer, destination);
  engine.render(h.renderer, destination);
  assert.equal(h.draws.length, 5, "only the resolve repeats");
  assert.equal(resolves(), 3);
  assert.deepEqual([engine.stats.renders, engine.stats.treeRenders, engine.stats.skips], [3, 1, 2]);
  engine.setCommands([{ kind: "isolation", id: "iso", opacity: .5, commands: [paint] }], [640, 360]);
  engine.render(h.renderer, destination);
  assert.equal(engine.stats.treeRenders, 2, "uniform-only edits re-render");
  engine.render(h.renderer, { viewport: { z: 320, w: 180 } });
  assert.equal(engine.stats.treeRenders, 3, "target resize re-renders");
  engine.render(h.renderer, { viewport: { z: 320, w: 180 } }, L);
  engine.render(h.renderer, { viewport: { z: 320, w: 180 } }, L);
  assert.equal(engine.stats.treeRenders, 4, "transform change re-renders once");
  engine.render(h.renderer, { viewport: { z: 320, w: 180 } }, L.map((v, i) => i === 4 ? v + 1 : v));
  assert.equal(engine.stats.treeRenders, 5);
  engine.setCommands([paint, paint], [640, 360]);
  engine.render(h.renderer, destination);
  assert.equal(engine.stats.treeRenders, 6, "structure rebuild re-renders");
  const other = { ...h.renderer, render: h.renderer.render };
  engine.render(other, destination);
  assert.equal(engine.stats.treeRenders, 7, "a different renderer re-renders");
  assert.equal(engine.stats.skips, 3);
  assert.equal(resolves(), 10);
  engine.dispose();
  engine.render(h.renderer, destination);
  assert.equal(engine.stats.renders, 10, "disposed engine draws nothing");
  engine.setCommands([paint], [640, 360]);
  engine.render(h.renderer, destination);
  assert.equal(engine.stats.treeRenders, 8);
  engine.dispose();
});

function layerHost() {
  const h = host();
  const vector = () => ({ x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; } });
  class Layer {
    constructor() {
      this.children = []; this.effects = [];
      this.values = { position: [0, 0], rotation: 0, scale: [1, 1] };
      this.properties = {
        resolution: { value: [640, 360], get() { return this.value; }, set(value) { this.value = value; } },
        scale: { get: () => this.values.scale },
      };
      this.composite = { group: { position: vector(), rotation: vector(), scale: { ...vector(), x: 1, y: 1, z: 1 } }, quad: { scale: { set() {} }, geometry: { dispose() {} }, material: { dispose() {} } } };
    }
    update() {
      const { group } = this.composite, v = this.values;
      group.position.set(v.position[0], v.position[1], 0); group.rotation.z = v.rotation; group.scale.set(v.scale[0], v.scale[1], 1);
    }
    unload() {}
  }
  class ObjectList extends Array { constructor() { super(); } }
  const ShapeLayer = createLayerClass({ layer: Layer, objectList: ObjectList }, h.THREE, class {});
  const layer = new ShapeLayer();
  layer.parentProject = { sequence: { properties: { rate: { get: () => 30 }, resolution: { get: () => [640, 360] } } } };
  const tolerances = [], build = layer.build;
  layer.build = function (tolerance) { tolerances.push(tolerance); return build.call(this, tolerance); };
  return { h, layer, tolerances };
}

test("layer bakes the composite group transform and resets the group for that composite", () => {
  const { h, layer, tolerances } = layerHost(), group = layer.composite.group;
  layer.values = { position: [30, -20], rotation: .5, scale: [4, 2] };
  layer.update(0);
  layer.pass.render(h.renderer, destination, null, true);
  close(layer.engine.stats.transform, L);
  assert.deepEqual([group.position.x, group.position.y, group.rotation.z, group.scale.x, group.scale.y], [0, 0, 0, 1, 1]);
  assert.equal(tolerances.at(-1), .125 / 4, "flattening tolerance uses the baked scale");
  assert.equal(layer.engine.camera.matrixAutoUpdate, false);
  layer.pass.render(h.renderer, destination, null, true);
  close(layer.engine.stats.transform, L);
  assert.equal(layer.engine.stats.skips, 1, "a repeated composite without update reuses the baked transform and raster");
  layer.values = { position: [0, 0], rotation: 0, scale: [1, 1] };
  layer.update(1);
  layer.pass.render(h.renderer, destination, null, true);
  assert.equal(layer.engine.stats.transform, null, "identity groups use the untransformed path");
  assert.equal(layer.engine.camera.matrixAutoUpdate, true);
  layer.values = { position: [5, 5], rotation: 0, scale: [0, 3] };
  layer.update(2);
  layer.pass.render(h.renderer, destination, null, true);
  assert.equal(layer.engine.stats.transform, null, "singular scale is left to the compositor");
  assert.equal(group.scale.x, 0);
  layer.unload();
});

test("layers with effects or 3D group rotation keep pre-transform rendering and an untouched group", () => {
  const { h, layer, tolerances } = layerHost(), group = layer.composite.group;
  layer.values = { position: [30, -20], rotation: .5, scale: [4, 2] };
  layer.effects.push({});
  layer.update(0);
  layer.pass.render(h.renderer, destination, null, true);
  assert.equal(layer.engine.stats.transform, null);
  assert.deepEqual([group.position.x, group.position.y, group.rotation.z, group.scale.x, group.scale.y], [30, -20, .5, 4, 2]);
  assert.equal(tolerances.at(-1), .125 / 4, "tolerance still follows the layer Scale property");
  assert.equal(layer.engine.camera.matrixAutoUpdate, true);
  layer.effects.length = 0;
  layer.update(1);
  group.rotation.x = .3;
  layer.pass.render(h.renderer, destination, null, true);
  assert.equal(layer.engine.stats.transform, null);
  assert.equal(group.scale.x, 4);
  layer.unload();
});
