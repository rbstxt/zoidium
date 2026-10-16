"use strict";
const { compile } = require("./compiler.js");
const { createRenderer } = require("./render.js");
// The editor runs the same command renderer at composition resolution. Pan
// and zoom only resample this cached image, never alter evaluated geometry.
function createPreview(s) {
  const THREE = s.window.THREE, canvas = s.document.createElement("canvas");
  const renderer = new THREE.WebGLRenderer({ alpha: true }), engine = createRenderer(THREE);
  const target = new THREE.WebGLRenderTarget(1, 1), context = canvas.getContext("2d");
  let signature = "", disposed = false;
  function image() {
    const resolution = s.layer.properties.resolution.get(), contents = Array.from(s.layer.contents, n => n.evaluate(s.localFrame()));
    const next = JSON.stringify([contents, resolution]);
    if (next === signature) return canvas;
    const [width, height] = resolution.map(v => Math.max(1, Math.round(v)));
    if (width * height > 16777216) throw Error("Shape+ editor preview size budget exceeded");
    const compiled = compile(contents, .125);
    engine.setCommands(compiled.commands, resolution);
    renderer.setSize(width, height, false); target.setSize(width, height);
    engine.render(renderer, target);
    const pixels = new Uint8Array(width * height * 4), data = context.createImageData(width, height);
    renderer.readRenderTargetPixels(target, 0, 0, width, height, pixels);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const src = ((height - 1 - y) * width + x) * 4, dst = (y * width + x) * 4, alpha = pixels[src + 3];
      for (let k = 0; k < 3; k++) data.data[dst + k] = alpha ? Math.min(255, Math.round(pixels[src + k] * 255 / alpha)) : 0;
      data.data[dst + 3] = alpha;
    }
    canvas.width = width; canvas.height = height; context.putImageData(data, 0, 0); signature = next;
    return canvas;
  }
  return { image, dispose() { if (disposed) return; disposed = true; engine.dispose(); target.dispose(); renderer.dispose(); renderer.forceContextLoss(); } };
}
module.exports = { createPreview };
