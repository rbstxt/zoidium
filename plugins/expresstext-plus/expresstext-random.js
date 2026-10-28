"use strict";

// ExpressText+ Seeded random, lattice noise and stagger ranks.

const { numberValue } = require("./expresstext-select.js");

/* ------------------------------------------------- stagger, random, curves */

function hashSeed(seed, salt) {
  let h = (Math.floor(numberValue(seed, 1)) * 374761393 + salt * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function seededRandom(seed, index, channel) {
  return hashSeed(numberValue(seed, 1) * 1000 + index * 131 + channel * 17, 7);
}

// Integer-lattice hash in [0,1): the dice behind Random/Gaussian and the
// lattice behind Noise/Turbulence. 32-bit wrapped, so any integer seed
// (including free-entered decimals scaled up) stays deterministic.
function hashLattice(ix, iy, iz, seedInt) {
  let h =
    (seedInt | 0) ^
    Math.imul(ix | 0, 374761393) ^
    Math.imul(iy | 0, 668265263) ^
    Math.imul(iz | 0, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function smoothNoiseUnit(t) {
  return t * t * (3 - 2 * t);
}

// Trilinear value noise in [0,1].
function valueNoise3(x, y, z, seedInt) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  const fx = smoothNoiseUnit(x - ix);
  const fy = smoothNoiseUnit(y - iy);
  const fz = smoothNoiseUnit(z - iz);
  const c000 = hashLattice(ix, iy, iz, seedInt);
  const c100 = hashLattice(ix + 1, iy, iz, seedInt);
  const c010 = hashLattice(ix, iy + 1, iz, seedInt);
  const c110 = hashLattice(ix + 1, iy + 1, iz, seedInt);
  const c001 = hashLattice(ix, iy, iz + 1, seedInt);
  const c101 = hashLattice(ix + 1, iy, iz + 1, seedInt);
  const c011 = hashLattice(ix, iy + 1, iz + 1, seedInt);
  const c111 = hashLattice(ix + 1, iy + 1, iz + 1, seedInt);
  const x00 = c000 + (c100 - c000) * fx;
  const x10 = c010 + (c110 - c010) * fx;
  const x01 = c001 + (c101 - c001) * fx;
  const x11 = c011 + (c111 - c011) * fx;
  const y0 = x00 + (x10 - x00) * fy;
  const y1 = x01 + (x11 - x01) * fy;
  return y0 + (y1 - y0) * fz;
}

// Fractal noise in [0,1]: plain octaves for Noise, absolute octaves
// (ridged, less uniform) for Turbulence.
function fractalNoise3(x, y, z, seedInt, octaves, turbulence) {
  let sum = 0;
  let norm = 0;
  let amp = 0.5;
  let fx = x;
  let fy = y;
  let fz = z;
  for (let o = 0; o < octaves; o += 1) {
    const n = valueNoise3(fx, fy, fz, seedInt + o * 101);
    sum += (turbulence ? Math.abs(n * 2 - 1) : n) * amp;
    norm += amp;
    amp *= 0.5;
    fx *= 2.03;
    fy *= 2.03;
    fz *= 2.03;
  }
  return norm > 0 ? sum / norm : 0.5;
}

// Fisher-Yates shuffle of [0..count), deterministic per salt. Sorted mode
// hands each letter a distinct stratum so values spread evenly.
function shuffledStrata(count, salt) {
  const order = [];
  for (let i = 0; i < count; i += 1) order.push(i);
  for (let i = count - 1; i > 0; i -= 1) {
    const j = Math.floor(hashSeed(salt, i) * (i + 1));
    const swap = order[i];
    order[i] = order[j];
    order[j] = swap;
  }
  return order;
}

// Rank of a letter inside an ordered list for stagger math.
function delayRank(order, position, count, seed) {
  const kind = Math.round(numberValue(order, 0));
  if (count <= 1) return 0;
  if (kind === 1) return count - 1 - position;
  if (kind === 2) {
    const middle = (count - 1) / 2;
    return Math.abs(position - middle);
  }
  if (kind === 3) {
    // Deterministic shuffle:_latest_ rank of this position.
    const slots = [];
    for (let i = 0; i < count; i += 1) slots.push(i);
    for (let i = count - 1; i > 0; i -= 1) {
      const j = Math.floor(seededRandom(seed, i, 101) * (i + 1));
      const swap = slots[i];
      slots[i] = slots[j];
      slots[j] = swap;
    }
    return slots.indexOf(position);
  }
  return position;
}

// Shake oscillator: frequency in cycles per second, offset
// and per-letter delay in cycles. Returns [-1, 1].
function shakeValue(frame, frequency, offset, stagger, rate = 30) {
  const t =
    numberValue(frame, 0) * (numberValue(frequency, 1) / rate) +
    numberValue(offset, 0) +
    numberValue(stagger, 0);
  return Math.sin(t * Math.PI * 2);
}

module.exports = { delayRank, fractalNoise3, hashLattice, hashSeed, seededRandom, shakeValue, shuffledStrata, smoothNoiseUnit, valueNoise3 };
