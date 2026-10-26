"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const { create } = require("../zoidium/community-temporal-pass");

test("the weighted pass respects CM3's unconditional tDiffuse binding and releases texture references on failure", () => {
  let material, disposed = 0, geometryDisposed = 0, throwing = false, draws = 0;
  class Vector2 { constructor(x, y) { this.set(x, y); } set(x, y) { this.x = x; this.y = y; } }
  class ShaderMaterial { constructor(options) { Object.assign(this, options); material = this; } dispose() { disposed++; } }
  class ShaderPass {
    constructor(value) { this.uniforms = value.uniforms; this.quad = { geometry: { dispose() { geometryDisposed++; } } }; }
    render(_renderer, _target, read) {
      // This is CM3's contract, including its unconditional property access.
      if (read) this.uniforms.tDiffuse.value = read.texture;
      assert.equal(this.uniforms.tap0.value, texture);
      assert.equal(this.uniforms.weight0.value, 1);
      assert.deepEqual(this.uniforms.scale0.value, new Vector2(0.5, 0.25));
      draws++;
      if (throwing) throw new Error("draw failure");
    }
  }
  const texture = {}, pass = create({ Vector2, ShaderMaterial, ShaderPass }, "gain-v1");
  const plan = { samples: [{ texture, target: { width: 100, height: 80, viewport: { z: 50, w: 20 } } }], weights: [1] };
  pass.render({}, {}, { texture: {} }, plan, 1.5);
  assert.equal(material.uniforms.gain.value, 1.5);
  assert.equal(material.uniforms.tap0.value, null);
  throwing = true;
  assert.throws(() => pass.render({}, {}, { texture: {} }, plan, 1.5), /draw failure/);
  assert.equal(material.uniforms.tap0.value, null); assert.equal(draws, 2);
  pass.release(); assert.equal(disposed, 1); assert.equal(geometryDisposed, 1);
});
