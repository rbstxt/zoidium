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

test("animation retains paint programs and render targets while retiring changed geometry", () => {
  const h = host(), engine = createRenderer(h.THREE);
  engine.setCommands([paint], [640, 360]);
  const mesh = engine.scene.children[0], material = mesh.material, geometry = mesh.geometry;
  const count = h.resources.length;
  engine.setCommands([{ ...paint, opacity: .2 }], [640, 360]);
  assert.equal(h.resources.length, count, "paint-only edits allocate no GPU objects");
  engine.setCommands([{ ...paint, positions: [0, 0, 0, 2, 0, 0, 0, 2, 0] }], [640, 360]);
  assert.equal(engine.scene.children[0].material, material);
  assert.equal(geometry.disposals, 1);
  assert.equal(material.disposals, 0);
  engine.dispose();
  assert.ok(h.resources.every(r => r.disposals === 1));
});

test("structural animation keeps a warm paint material instead of retiring the last shader program", () => {
  const h = host(), engine = createRenderer(h.THREE);
  engine.setCommands([paint], [640, 360]);
  const material = engine.scene.children[0].material;
  engine.setCommands([{ ...paint, id: "copy0" }, { ...paint, id: "copy1" }], [640, 360]);
  assert.equal(engine.scene.children[0].material, material);
  assert.equal(material.disposals, 0);
  engine.setCommands([], [640, 360]);
  engine.setCommands([paint], [640, 360]);
  assert.equal(engine.scene.children[0].material, material);
  engine.dispose();
  assert.ok(h.resources.every(resource => resource.disposals === 1));
});
test("a failed mask frame restores target, clear state and recovers on the next render",()=>{
  const h=host(),engine=createRenderer(h.THREE),destination={viewport:{z:640,w:360}},oldTarget={};
  let current=oldTarget,resets=0,fail=true;
  h.renderer.getRenderTarget=()=>current;
  h.renderer.setRenderTarget=value=>{current=value;};
  h.renderer.state={reset(){resets++;}};
  const render=h.renderer.render;
  h.renderer.render=function(...args){current=args[2];if(fail)throw Error("frame failure");return render.apply(this,args);};
  engine.setCommands([{...paint,coverage:paint.positions}],[640,360]);
  assert.throws(()=>engine.render(h.renderer,destination),/frame failure/);
  assert.equal(current,oldTarget);assert.equal(h.renderer.autoClear,false);assert.equal(resets,1);
  fail=false;assert.doesNotThrow(()=>engine.render(h.renderer,destination));assert.equal(current,oldTarget);
  engine.dispose();assert.ok(h.resources.every(r=>r.disposals===1));
});
