"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const source = fs.readFileSync(path.join(__dirname, "../plugins/openzoid-legacy/effects/jpegdamage.js"), "utf8");

function harness({ pending = false, float = true, complete = true } = {}) {
  let finish;
  const disposed = [];
  const frames = [];
  const assets = [];
  const vertex = pending ? new Promise((resolve) => { finish = resolve; }) : Promise.resolve("host vertex");
  class Vector2 {
    constructor(x, y) { this.set(x, y); }
    set(x, y) { this.x = x; this.y = y; }
  }
  class ShaderMaterial {
    constructor(options) { Object.assign(this, options); }
    dispose() { disposed.push(this); }
  }
  class DataTexture {
    constructor(bytes) { this.bytes = bytes; }
    dispose() { disposed.push(this); }
  }
  class WebGLRenderTarget {
    constructor(w, h, options) { this.texture = { type: options.type }; this.setSize(w, h); }
    setSize(w, h) { this.width = w; this.height = h; }
    dispose() { disposed.push(this); }
  }
  class ShaderPass {
    constructor(material) {
      this.material = material;
      this.uniforms = material.uniforms;
      this.scene = { pass: this };
      this.camera = {};
      this.quad = { material, geometry: { dispose() { disposed.push(this); } } };
    }
    render(renderer, write, read) {
      this.uniforms.tDiffuse.value = read.texture;
      renderer.render(this.scene, this.camera, write);
    }
  }
  const THREE = { Vector2, ShaderMaterial, DataTexture, WebGLRenderTarget, ShaderPass,
    FloatType: "float", UnsignedByteType: "byte", NoBlending: "none" };
  const PZ = { property: { type: { NUMBER: 1, OPTION: 2 } }, expression: function () {},
    asset: { type: { SHADER: 1 }, shader: function () { this.getShader = () => vertex; } } };
  const effect = { _zoidiumGetAsset: () => "bundled shader", parentLayer: { properties: { resolution: { get: () => [1920, 1080] } } },
    properties: {
      addAll(defs) {
        for (const [key, def] of Object.entries(defs)) {
          this[key] = { value: typeof def.value === "function" ? 0 : def.value, get() { return this.value; } };
        }
      }, load(data) { for (const [key, value] of Object.entries(data || {})) this[key].value = value; },
    },
    parentProject: { assets: { createFromPreset() { return {}; }, load(a) { return a; }, unload(a) { assets.push(a); } } },
  };
  new Function("PZ", "THREE", source).call(effect, PZ, THREE);
  const screen = {};
  let current = screen;
  const renderer = {
    capabilities: { maxTextureSize: 8192 }, extensions: { get: () => float },
    getContext: () => ({ FRAMEBUFFER: 1, FRAMEBUFFER_COMPLETE: 2, checkFramebufferStatus: () => complete ? 2 : 0 }),
    getRenderTarget: () => current, setRenderTarget(target) { current = target; },
    render(scene, camera, target) {
      current = target;
      const pass = scene.pass;
      frames.push({ stage: pass.quad.material.defines.JPEG_STAGE, target, input: pass.uniforms.tStage.value,
        source: pass.uniforms.tDiffuse.value, range: pass.uniforms.outputRange.value });
    },
  };
  return { effect, renderer, finish: () => finish("host vertex"), frames, disposed, assets, screen };
}

test("unload during pending vertex loading cannot recreate a JPEG pass or retain its asset", async () => {
  const h = harness({ pending: true });
  const loading = h.effect.load({ properties: { quality: 0.3 } });
  h.effect.unload();
  h.finish();
  await loading;
  assert.equal(h.effect.pass, null);
  assert.equal(h.effect._vertShader, null);
  assert.equal(h.assets.length, 1);
  assert.equal(h.disposed.length, 0, "no pass was allocated after cancellation");
});

test("a newer load owns its pass when an older pending load resolves", async () => {
  const h = harness({ pending: true });
  const first = h.effect.load({ properties: { quality: 0.3 } });
  const second = h.effect.load({ properties: { quality: 0.8 } });
  h.finish();
  await Promise.all([first, second]);
  assert.equal(h.effect.pass.materials.length, 4);
  assert.equal(h.effect.properties.quality.value, 0.8);
  assert.equal(h.assets.length, 1);
  h.effect.unload();
  assert.equal(h.assets.length, 2);
  assert.equal(h.disposed.length, 8, "two targets, four materials, table and geometry");
});

test("four JPEG stages never sample their output target and restore renderer state", async () => {
  const h = harness();
  await h.effect.load({});
  h.effect.update(0);
  const pass = h.effect.pass;
  const read = { texture: {}, width: 1920, height: 1080 }, write = { texture: {}, width: 1920, height: 1080 };
  pass.render(h.renderer, write, read, true);
  assert.equal(pass.storage, "float");
  assert.deepEqual(h.frames.map((f) => f.stage), [0, 1, 2, 3]);
  assert.ok(h.frames.every((f) => f.input !== f.target.texture));
  assert.equal(h.frames[0].source, read.texture);
  assert.equal(h.frames[3].target, write);
  assert.equal(h.renderer.getRenderTarget(), h.screen);
  const size = [pass.targets[0].width, pass.targets[0].height];
  assert.ok(size[0] <= 8192 && size[1] <= 8192);
  h.effect.properties.resFactor.value = 4;
  h.effect.update(0);
  pass.render(h.renderer, write, read, true);
  assert.ok(pass.targets[0].width * pass.targets[0].height < size[0] * size[1]);
  assert.equal(pass.uniforms.lowResolution.value.x, 480);
  h.effect.unload();
  h.effect.unload();
  assert.equal(h.disposed.length, 9, "includes one disposed float probe");
});

for (const [name, options] of [["missing float extension", { float: false }], ["incomplete float framebuffer", { complete: false }]]) {
  test("packed coefficient fallback handles " + name, async () => {
    const h = harness(options);
    await h.effect.load({ properties: { errRate: 6, errAmp: 8, resRelX: 0.01 } });
    h.effect.update(0);
    h.effect.pass.render(h.renderer, { texture: {}, width: 1920, height: 1080 }, { texture: {}, width: 1920, height: 1080 }, true);
    const pass = h.effect.pass;
    assert.equal(pass.storage, "packed");
    assert.ok(pass.materials.every((m) => m.defines.JPEG_PACKED === 1));
    assert.ok(pass.targets.every((t) => t.texture.type === "byte"));
    assert.equal(pass.uniforms.sparseAxes.value.x, 1);
    assert.equal(pass.uniforms.blockGrid.value.x, 1920);
    assert.ok(pass.targets[0].width <= 8192 && pass.targets[0].height <= 8192);
    assert.ok(h.frames[1].range > h.frames[0].range);
    assert.ok(h.frames[2].range > h.frames[1].range);
    h.effect.unload();
  });
}

test("JPEG pass restores renderer state after an intermediate draw fails", async () => {
  const h = harness({ float: false });
  await h.effect.load({});
  h.effect.update(0);
  const render = h.renderer.render;
  h.renderer.render = (...args) => { render(...args); throw new Error("draw failed"); };
  assert.throws(() => h.effect.pass.render(h.renderer, {}, { texture: {} }), /draw failed/);
  assert.equal(h.renderer.getRenderTarget(), h.screen);
  assert.equal(h.effect.pass.quad.material, h.effect.pass.material);
  h.effect.unload();
});
