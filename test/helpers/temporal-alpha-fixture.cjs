"use strict";
const { host } = require("./temporal-sampler-host.cjs");

function copyFixture() {
  const h = host(false);
  h.sandbox.THREE.NoBlending = 0;
  const material = { blending: 1 };
  const scale = { set(x, y) { this.x = x; this.y = y; } };
  const compositor = { renderer: {}, copyPass: {
    material,
    uniforms: { tDiffuse: {}, opacity: {}, uvScale: { value: scale } },
    render(_renderer, output) {
      const rgba = this.uniforms.tDiffuse.value.rgba;
      output.rgba = rgba.map((value, channel) => channel === 3 || material.blending === 0
        ? value : Math.round(value * rgba[3] / 255));
    },
  } };
  return { h, compositor, material, scale, source: { texture: { rgba: [128, 64, 32, 128] } } };
}


module.exports = { copyFixture };
