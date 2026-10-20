"use strict";
// Floating-point CPU reference for instance ordering. Inputs and outputs are
// premultiplied RGBA in [0,1]; intermediate color remains straight and unclipped.
function gradeImage(input, width, height, instances, Looks) {
  const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));
  let image = Array.from(input), straight = false;
  function sample(u, v) {
    const x = clamp(u, 0, 1) * width - 0.5, y = clamp(v, 0, 1) * height - 0.5;
    const x0 = Math.floor(x), y0 = Math.floor(y), tx = x - x0, ty = y - y0;
    const at = (x, y, c) => image[(clamp(y, 0, height - 1) * width + clamp(x, 0, width - 1)) * 4 + c];
    const result = [0, 1, 2, 3].map(c => (at(x0, y0, c) * (1 - tx) + at(x0 + 1, y0, c) * tx) * (1 - ty) +
      (at(x0, y0 + 1, c) * (1 - tx) + at(x0 + 1, y0 + 1, c) * tx) * ty);
    for (let c = 0; c < 3; c++) result[c] = result[3] <= 0.000001 ? 0 : straight ? result[c] : result[c] / result[3];
    return result;
  }
  for (const instance of instances) {
    if (instance.enabled === false) continue;
    const state = Looks.tools.defaultState();
    state.tools[instance.tool] = instance.state || Looks.tools.defaultToolState(Looks.tools.byId(instance.tool));
    const enabled = { [instance.tool]: 1 }, luts = Looks.grade.buildFrameLuts(state.tools);
    const result = new Array(image.length);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const uv = [(x + 0.5) / width, (y + 0.5) / height], pixel = (y * width + x) * 4;
      let alphaUv = uv;
      if (instance.tool === "lens-distortion") {
        const p = state.tools[instance.tool].p, ox = uv[0] - .5, oy = uv[1] - .5, r2 = ox * ox + oy * oy;
        alphaUv = [.5 + ox * (1 + p.distortion * r2 * 4), .5 + oy * (1 + p.distortion * r2 * 4 * p.flatten)];
      }
      const alpha = sample(...alphaUv)[3];
      const color = Looks.grade.gradePixel(sample(...uv).slice(0, 3), uv, state.tools, enabled,
        (u, v) => sample(u, v).slice(0, 3), [width, height], luts, [instance.tool]);
      for (let c = 0; c < 3; c++) result[pixel + c] = alpha > 0.000001 ? color[c] : 0;
      result[pixel + 3] = alpha;
    }
    image = result; straight = true;
  }
  if (!straight) return Array.from(input);
  return image.map((value, index) => index % 4 === 3 ? value : clamp(value, 0, 1) * image[index - index % 4 + 3]);
}
module.exports = { gradeImage };
