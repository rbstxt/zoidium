"use strict";
// Text kind rasterization. Glyph outlines come from the CM3 font asset's
// opentype font, so preset and imported fonts render identically in every
// build without CSS font loading. Output rows are bottom-up RGBA8 (white
// glyphs, coverage or signed distance in alpha) for a DataTexture.
const MAX_SIDE = 2048;
const INF = 1e20;

function metrics(font, size) {
  const scale = size / font.unitsPerEm;
  return { scale, ascent: font.ascender * scale, descent: -font.descender * scale };
}

// Advance positions for one line, including kerning and letter spacing.
function placeLine(font, line, size, spacing) {
  const { scale } = metrics(font, size), glyphs = font.stringToGlyphs(line), placed = [];
  let x = 0;
  glyphs.forEach((glyph, i) => {
    if (i > 0) x += (font.getKerningValue(glyphs[i - 1], glyph) || 0) * scale + spacing * size;
    placed.push({ glyph, x });
    x += (glyph.advanceWidth || 0) * scale;
  });
  return { placed, width: Math.max(0, x) };
}

function layout(font, options) {
  let size = options.size;
  for (let attempt = 0; attempt < 8; attempt++) {
    const { ascent, descent } = metrics(font, size), pad = Math.ceil(size * 0.25);
    if (options.mode === "atlas") {
      const chars = Array.from(new Set(Array.from(options.text.replace(/\n/g, "")))).slice(0, 256);
      const count = Math.max(1, chars.length), cols = Math.ceil(Math.sqrt(count)), rows = Math.ceil(count / cols);
      const cell = Math.ceil(Math.max(ascent + descent, size) + pad * 2);
      if (Math.max(cols, rows) * cell > MAX_SIDE) { size *= (MAX_SIDE - 2) / (Math.max(cols, rows) * cell); continue; }
      const draws = chars.map((ch, index) => {
        const { placed, width } = placeLine(font, ch, size, 0);
        const col = index % cols, row = Math.floor(index / cols);
        return placed.map(p => ({ glyph: p.glyph, x: col * cell + (cell - width) / 2 + p.x, y: row * cell + pad + ascent, size }));
      }).flat();
      return { width: cols * cell, height: rows * cell, draws, grid: [cols, rows], count, size, pad };
    }
    const lines = options.text.split("\n").map(line => placeLine(font, line, size, options.letterSpacing));
    const lineStep = size * options.lineHeight, inner = Math.max(1, ...lines.map(l => l.width));
    const width = Math.ceil(inner + pad * 2), height = Math.ceil((lines.length - 1) * lineStep + ascent + descent + pad * 2);
    if (Math.max(width, height) > MAX_SIDE) { size *= (MAX_SIDE - 2) / Math.max(width, height); continue; }
    const draws = lines.map((line, index) => {
      const offset = options.align === "left" ? 0 : options.align === "right" ? inner - line.width : (inner - line.width) / 2;
      return line.placed.map(p => ({ glyph: p.glyph, x: pad + offset + p.x, y: pad + ascent + index * lineStep, size }));
    }).flat();
    return { width: Math.max(1, width), height: Math.max(1, height), draws, grid: [1, 1], count: 1, size, pad };
  }
  throw new Error("Text does not fit the maximum texture size");
}

// Felzenszwalb-Huttenlocher squared Euclidean distance transform.
function edt1d(f, n, d, v, z) {
  let k = 0; v[0] = 0; z[0] = -INF; z[1] = INF;
  for (let q = 1; q < n; q++) {
    let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) { k--; s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
    k++; v[k] = q; z[k] = s; z[k + 1] = INF;
  }
  k = 0;
  for (let q = 0; q < n; q++) { while (z[k + 1] < q) k++; d[q] = (q - v[k]) * (q - v[k]) + f[v[k]]; }
}
function edt(grid, width, height) {
  const size = Math.max(width, height), f = new Float64Array(size), d = new Float64Array(size), v = new Int32Array(size), z = new Float64Array(size + 1);
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) f[y] = grid[y * width + x];
    edt1d(f, height, d, v, z);
    for (let y = 0; y < height; y++) grid[y * width + x] = d[y];
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) f[x] = grid[y * width + x];
    edt1d(f, width, d, v, z);
    for (let x = 0; x < width; x++) grid[y * width + x] = Math.sqrt(d[x]);
  }
  return grid;
}
// Coverage (0-255, top-down) to a signed distance field: 128 at the edge,
// higher inside, `spread` pixels to either extreme.
function signedDistance(coverage, width, height, spread) {
  const outside = new Float64Array(width * height), inside = new Float64Array(width * height);
  for (let i = 0; i < coverage.length; i++) {
    const a = coverage[i] / 255;
    outside[i] = a >= 0.5 ? 0 : INF; inside[i] = a >= 0.5 ? INF : 0;
  }
  edt(outside, width, height); edt(inside, width, height);
  const out = new Uint8Array(width * height);
  for (let i = 0; i < out.length; i++) {
    const distance = outside[i] - inside[i];
    out[i] = Math.round(Math.min(1, Math.max(0, 0.5 - distance / (2 * spread))) * 255);
  }
  return out;
}

function rasterize(doc, font, options) {
  const plan = layout(font, options);
  const canvas = doc.createElement("canvas");
  canvas.width = plan.width; canvas.height = plan.height;
  const ctx = canvas.getContext("2d");
  for (const draw of plan.draws) {
    const path = draw.glyph.getPath(draw.x, draw.y, draw.size);
    path.fill = "#ffffff"; path.stroke = null;
    path.draw(ctx);
  }
  const pixels = ctx.getImageData(0, 0, plan.width, plan.height).data;
  let alpha = new Uint8Array(plan.width * plan.height);
  for (let i = 0; i < alpha.length; i++) alpha[i] = pixels[i * 4 + 3];
  if (options.sdf) alpha = signedDistance(alpha, plan.width, plan.height, Math.max(2, plan.pad * 0.8));
  const data = new Uint8Array(plan.width * plan.height * 4);
  for (let y = 0; y < plan.height; y++) {
    const source = y * plan.width, target = (plan.height - 1 - y) * plan.width;
    for (let x = 0; x < plan.width; x++) {
      const o = (target + x) * 4;
      data[o] = data[o + 1] = data[o + 2] = 255; data[o + 3] = alpha[source + x];
    }
  }
  return { width: plan.width, height: plan.height, data, grid: plan.grid, count: plan.count };
}

module.exports = { MAX_SIDE, layout, placeLine, edt, signedDistance, rasterize };
