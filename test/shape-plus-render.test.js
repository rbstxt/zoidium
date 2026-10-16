"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createRenderer } = require("../plugins/shape-plus/render");
function host() {
  const resources = [], draws = [];
  class Resource { constructor() { this.disposals = 0; resources.push(this); } dispose() { this.disposals++; } }
  class Geometry extends Resource { addAttribute() {} scale() {} }
  class Material extends Resource { constructor(spec) { super(); Object.assign(this, spec); } }
  class Scene { constructor() { this.children = []; } add(mesh) { this.children.push(mesh); } }
  class Mesh { constructor(geometry, material) { this.geometry = geometry; this.material = material; } }
  class Target extends Resource { constructor(w, h) { super(); this.texture = {}; this.setSize(w, h); } setSize(w, h) { this.width = w; this.height = h; } }
  class Camera { constructor() { this.position = {}; } updateProjectionMatrix() {} }
  class Vector { set(x, y) { this.x = x; this.y = y; } }
  const THREE = { Scene, Mesh, OrthographicCamera: Camera, ShaderMaterial: Material, BufferGeometry: Geometry, PlaneBufferGeometry: Geometry, BufferAttribute: class {}, Color: class {}, Vector2: Vector, WebGLRenderTarget: Target };
  const renderer = { capabilities: { maxTextureSize: 16384 }, autoClear: false, getClearColor: () => ({ clone: () => ({}) }), getClearAlpha: () => .7, setClearColor() {}, render(scene, camera, target) { draws.push({ scene, camera, target }); } };
  return { THREE, renderer, resources, draws };
}
const paint = { kind: "paint", id: "fill", positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], color: [1, 0, 0], opacity: .5 };
test("r91 mesh retirement, isolated opacity and resolution-based AA dispose all resources", () => {
  const h = host(), engine = createRenderer(h.THREE), destination = { viewport: { z: 640, w: 360 } };
  engine.setCommands([{ kind: "isolation", opacity: .5, commands: [paint, paint] }], [640, 360]);
  engine.render(h.renderer, destination);
  assert.equal(engine.stats.supersample, 4);
  assert.equal(h.draws.length, 3, "child, parent, resolve");
  const childMeshes = h.draws[0].scene.children;
  assert.deepEqual(childMeshes.map(mesh => mesh.renderOrder), [0, 1]);
  assert.equal(childMeshes[0].material.depthWrite, false);
  assert.equal(h.draws[1].scene.children[0].material.uniforms.opacity.value, .5);
  const geometry = childMeshes[0].geometry;
  engine.setCommands([paint], [640, 360]);
  assert.equal(geometry.disposals, 1);
  engine.render(h.renderer, { viewport: { z: 3840, w: 2160 } });
  assert.equal(engine.stats.supersample, 2);
  assert.equal(engine.stats.width, 7680);
  assert.equal(h.renderer.autoClear, false);
  engine.dispose(); engine.dispose();
  assert.ok(h.resources.every(r => r.disposals === 1));
});
