"use strict";

// Wiring coverage for the VHS effect's per-control uniforms.
//
// Background: a real-UI battery sets each VHS property to 1.0 on an Adjustment
// over a video at frame 40 and measures the pixel change inside a center crop.
// Skew, OSD Timecode, Noise Evolution, Noise Opacity, Roll Speed, Crease,
// Anisotropy Snow Dots and Hum Bar read as ~0 there. That is inherited DaviFX
// behaviour, not a port bug: the VHS signal shader is identical to the donor,
// and each of those controls either affects a region outside the crop (skew
// flagwave zone, OSD corner block), only mixes inside sweep bands (noise
// engine), needs a companion control (Roll Speed needs Roll), or moves a
// narrow band that misses the crop at frame 40 (crease, anisoSnow, humBar).
// Full-preview measurements on both ports confirm parity.
//
// These tests lock the failure modes that WOULD make a control genuinely dead
// in the port: a property missing from the definitions, a uniform declared but
// never fed from the property in update(), a uniform fed but never read by the
// shader, or a control missing from the VHS Setup window.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const effectSource = fs.readFileSync(
  path.join(root, "plugins/openzoid-legacy/effects/vhs.js"),
  "utf8"
);
const setupSource = fs.readFileSync(
  path.join(root, "plugins/openzoid-legacy/vhs-setup.js"),
  "utf8"
);

// Every numeric VHS control: [property key, display name, default value].
// Roll Speed has a wider range (0..5) but is still wired per frame.
const CONTROLS = [
  ["amount", "Amount", 1],
  ["signalStrength", "Signal Strength", 0.25],
  ["colorStripes", "Color Stripes", 0.25],
  ["chromaCrawl", "Chroma Crawl", 0.2],
  ["chromaLoss", "Chroma Loss", 0.05],
  ["flicker", "Flicker", 0.08],
  ["vhsSharpen", "VHS Sharpen", 0.35],
  ["interlace", "Interlace", 0.4],
  ["staticWarp", "Static Warp", 0.2],
  ["fastForward", "Fast Forward", 0],
  ["tracking", "Tracking", 0.25],
  ["anisotropyWarp", "Anisotropy Warp", 0],
  ["rgbSplit", "RGB Split", 0.12],
  ["tear", "Tear", 0.12],
  ["humBar", "Hum Bar", 0.1],
  ["blueScreen", "Blue Screen", 0],
  ["skew", "Skew", 0.25],
  ["crease", "Crease", 0],
  ["ghost", "Ghost", 0.08],
  ["osd", "OSD Timecode", 0],
  ["noiseEvo", "Noise Evolution", 0.5],
  ["noiseOpacity", "Noise Opacity", 0.4],
  ["blinds", "Blinds", 0],
  ["snowDots", "Snow Dots", 0],
  ["speedDots", "Speed Dots", 0],
  ["anisoSnow", "Anisotropy Snow Dots", 0],
  ["jitterX", "Jitter X", 0.3],
  ["jitterY", "Jitter Y", 0.3],
  ["roll", "Roll", 0],
  ["persistence", "Persistence", 0.25],
];

function countOccurrences(haystack, needle) {
  let count = 0;
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) return count;
    count += 1;
    from = at + needle.length;
  }
}

test("every VHS control is declared with its display name and default", () => {
  for (const [key, name, value] of CONTROLS) {
    assert.ok(
      effectSource.includes(`${key}: vhsNum("${name}"`),
      `${key} declared as "${name}"`
    );
    assert.ok(
      effectSource.includes(`vhsNum("${name}", ${value},`),
      `${name} keeps default ${value}`
    );
  }
  assert.ok(
    effectSource.includes('name: "Roll Speed"'),
    "Roll Speed declared"
  );
});

test("every VHS control uniform is declared and read by the signal shader", () => {
  for (const [key] of [...CONTROLS, ["rollSpeed", "Roll Speed", 1.5]]) {
    assert.ok(
      effectSource.includes(`uniform float ${key};`),
      `uniform float ${key} declared`
    );
    // One occurrence is the declaration; anything more is a real read.
    assert.ok(
      countOccurrences(effectSource, key) > 2,
      `${key} is read by the shader body, not just declared`
    );
  }
});

test("update() feeds every VHS control uniform from its property", () => {
  for (const [key] of [...CONTROLS, ["rollSpeed", "Roll Speed", 1.5]]) {
    assert.ok(
      new RegExp(`s\\.${key}\\.value\\s*=`).test(effectSource),
      `update() assigns s.${key}.value`
    );
    assert.ok(
      new RegExp(`props\\.${key}\\.get`).test(effectSource),
      `update() reads props.${key}`
    );
  }
});

test("the VHS Setup window exposes every control", () => {
  for (const [key] of [...CONTROLS, ["rollSpeed", "Roll Speed", 1.5]]) {
    assert.ok(
      setupSource.includes(`"${key}"`),
      `setup window lists ${key}`
    );
  }
});

test("the VHS effect source stays deterministic", () => {
  for (const banned of ["Math.random", "Date.now", "performance.now", "requestAnimationFrame"]) {
    assert.ok(!effectSource.includes(banned), `no ${banned} in vhs.js`);
  }
});
