"use strict";

// ExpressText+ Voronoi shatter cells and chunk poses.

const { numberValue, vector3 } = require("./expresstext-select.js");

/* ------------------------------------------------- voronoi chunks */

// Halton low-discrepancy value in [0,1) for spreading shatter sites.
function haltonSequence(index, base) {
  let f = 1;
  let r = 0;
  let i = Math.max(1, Math.floor(numberValue(index, 1)));
  const b = Math.max(2, Math.floor(numberValue(base, 2)));
  while (i > 0) {
    f /= b;
    r += f * (i % b);
    i = Math.floor(i / b);
  }
  return r;
}

// Partition letter triangles into voronoi cells: seeded sites spread
// over the glyph bounds, each triangle assigned to its nearest site.
// Pure array math (no THREE): positions/normals/uvs are flat per-triangle
// arrays; returns per nonempty cell { position, normal, uv, center }.
function splitVoronoiCells(positions, normals, uvs, count, seed) {
  // Live geometry hands typed arrays (Float32Array), tests hand plain
  // arrays: accept any indexable array-like.
  const pos = positions && typeof positions.length === "number" ? positions : [];
  const triCount = Math.floor(pos.length / 9);
  const want = Math.max(1, Math.min(64, Math.floor(numberValue(count, 8))));
  if (triCount <= 0) return [];
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < pos.length; i += 3) {
    if (pos[i] < minX) minX = pos[i];
    if (pos[i] > maxX) maxX = pos[i];
    if (pos[i + 1] < minY) minY = pos[i + 1];
    if (pos[i + 1] > maxY) maxY = pos[i + 1];
    if (pos[i + 2] < minZ) minZ = pos[i + 2];
    if (pos[i + 2] > maxZ) maxZ = pos[i + 2];
  }
  const seedNum = numberValue(seed, 1);
  const seedFrac = seedNum - Math.floor(seedNum) + (seedNum < 0 ? 1 : 0);
  const spanX = maxX > minX ? maxX - minX : 1;
  const spanY = maxY > minY ? maxY - minY : 1;
  const spanZ = maxZ > minZ ? maxZ - minZ : 1;
  const sites = [];
  const siteCount = Math.min(want, triCount);
  for (let s = 0; s < siteCount; s += 1) {
    const jx = (haltonSequence(s + 1, 2) + seedFrac * 0.6180339887) % 1;
    const jy = (haltonSequence(s + 1, 3) + seedFrac * 0.3819660113) % 1;
    const jz = (haltonSequence(s + 1, 5) + seedFrac * 0.5) % 1;
    sites.push([minX + spanX * jx, minY + spanY * jy, minZ + spanZ * jz]);
  }
  const cells = sites.map(() => ({ tris: [], center: [0, 0, 0] }));
  for (let t = 0; t < triCount; t += 1) {
    const cx = (pos[t * 9] + pos[t * 9 + 3] + pos[t * 9 + 6]) / 3;
    const cy = (pos[t * 9 + 1] + pos[t * 9 + 4] + pos[t * 9 + 7]) / 3;
    const cz = (pos[t * 9 + 2] + pos[t * 9 + 5] + pos[t * 9 + 8]) / 3;
    let best = 0;
    let bestD = Infinity;
    for (let s = 0; s < sites.length; s += 1) {
      const dx = cx - sites[s][0];
      const dy = cy - sites[s][1];
      const dz = cz - sites[s][2];
      const d = dx * dx + dy * dy + dz * dz;
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    cells[best].tris.push(t);
  }
  const nor = normals && typeof normals.length === "number" ? normals : [];
  const uv = uvs && typeof uvs.length === "number" ? uvs : [];
  const out = [];
  for (const cell of cells) {
    if (!cell.tris.length) continue;
    const position = [];
    const normal = [];
    const uvOut = [];
    let ccx = 0;
    let ccy = 0;
    let ccz = 0;
    for (const t of cell.tris) {
      for (let k = 0; k < 9; k += 1) position.push(pos[t * 9 + k]);
      for (let k = 0; k < 9; k += 1) {
        if (nor.length > t * 9 + k) normal.push(nor[t * 9 + k]);
      }
      for (let k = 0; k < 6; k += 1) {
        if (uv.length > t * 6 + k) uvOut.push(uv[t * 6 + k]);
      }
      ccx += (pos[t * 9] + pos[t * 9 + 3] + pos[t * 9 + 6]) / 3;
      ccy += (pos[t * 9 + 1] + pos[t * 9 + 4] + pos[t * 9 + 7]) / 3;
      ccz += (pos[t * 9 + 2] + pos[t * 9 + 5] + pos[t * 9 + 8]) / 3;
    }
    const n = cell.tris.length;
    out.push({ position, normal, uv: uvOut, center: [ccx / n, ccy / n, ccz / n] });
  }
  return out;
}

// Chunk pose from summed totals: offset along the letter-center
// direction, tumble by signed spin. Pure (no THREE).
function voronoiChunkPose(chunkCenter, letterCenter, explode, spin, signs) {
  const cc = vector3(chunkCenter, [0, 0, 0]);
  const lc = vector3(letterCenter, [0, 0, 0]);
  const dx = cc[0] - lc[0];
  const dy = cc[1] - lc[1];
  const dz = cc[2] - lc[2];
  const len = Math.hypot(dx, dy, dz);
  const dir = len > 1e-9 ? [dx / len, dy / len, dz / len] : [0, 1, 0];
  const ex = numberValue(explode, 0);
  const sp = Array.isArray(spin) ? spin : [0, 0, 0];
  const sg = Array.isArray(signs) ? signs : [1, 1, 1];
  return {
    offset: [dir[0] * ex, dir[1] * ex, dir[2] * ex],
    rotation: [sp[0] * sg[0], sp[1] * sg[1], sp[2] * sg[2]],
  };
}

module.exports = { haltonSequence, splitVoronoiCells, voronoiChunkPose };
