#!/usr/bin/env node

/*
 * Build the generated font-picker preview sprite (fonts/font-previews.svg).
 *
 * The CM3 font dropdown renders one 200x25 row per preset from a sprite
 * sheet. This tool renders every preset name in its own font as outline
 * paths through the Shape+ HarfBuzz engine in Node, so adding a preset is
 * just a TTF plus a presets.json entry. No system fonts or browsers are
 * involved. Output is byte-deterministic: fixed row geometry, fixed float
 * precision, and no timestamps or absolute paths.
 *
 * Usage:
 *   node tools/build-font-previews.js         rebuild fonts/font-previews.svg
 *   node tools/build-font-previews.js --check verify the sprite and the
 *     runtime preset list (wired into pnpm run verify)
 */

"use strict";

const fs = require("fs");
const path = require("path");
const { defaultResourceCacheRoot, projectRoot } = require("./runtime-resources-paths");
const { writeFileIfChangedAtomic } = require("./atomic-write");

const checkOnly = process.argv.includes("--check");

const ROW_WIDTH = 200;
const ROW_HEIGHT = 25;
const NOMINAL_EM_PX = 20;
const BASELINE_PX = 18.5;
const CUSTOM_LABEL = "custom";
const PRESETS_PATH = path.join(projectRoot, "fonts", "presets.json");
const SPRITE_PATH = path.join(projectRoot, "fonts", "font-previews.svg");
const PATCH_PATH = path.join(projectRoot, "plugins", "core", "font-presets.js");
const INTER_TTF = path.join(projectRoot, "fonts", "presets", "inter.ttf");

function presetFile(name) {
  return path.join(projectRoot, "fonts", "presets", `${name}.ttf`);
}

function readPresetList() {
  let list;
  try {
    list = JSON.parse(fs.readFileSync(PRESETS_PATH, "utf8"));
  } catch (error) {
    throw new Error(`Could not read fonts/presets.json: ${error.message}`);
  }
  if (!Array.isArray(list) || list.length === 0 || list.some(name => typeof name !== "string")) {
    throw new Error("fonts/presets.json must be a non-empty array of preset names.");
  }
  const seen = new Set();
  for (const name of list) {
    if (!/^[a-z0-9][a-z0-9 ]*$/.test(name)) {
      throw new Error(`Invalid preset name (lowercase, valid file name required): ${name}`);
    }
    if (seen.has(name)) throw new Error(`Duplicate preset name: ${name}`);
    seen.add(name);
    if (!fs.existsSync(presetFile(name))) {
      throw new Error(`Missing preset file for ${name}: fonts/presets/${name}.ttf`);
    }
  }
  return [...list].sort();
}

function readHostPresets() {
  const directory = path.join(defaultResourceCacheRoot, "assets", "fonts", "2d");
  let entries;
  try {
    entries = fs.readdirSync(directory);
  } catch (error) {
    throw new Error(
      `CM3 font cache is missing at ${directory} (run pnpm run setup): ${error.message}`
    );
  }
  return entries
    .filter(entry => entry.endsWith(".ttf"))
    .map(entry => entry.slice(0, -".ttf".length))
    .sort();
}

function mergedPresets() {
  const host = readHostPresets();
  const extra = readPresetList();
  for (const name of extra) {
    if (host.includes(name)) throw new Error(`Preset name collides with a host preset: ${name}`);
  }
  return [...host, ...extra].sort();
}

async function loadEngine() {
  const vendor = path.join(projectRoot, "plugins", "shape-plus", "vendor");
  const api = require(path.join(vendor, "harfbuzz-api"));
  const factory = require(path.join(vendor, "harfbuzz"));
  const { createEngine } = require(path.join(projectRoot, "plugins", "shape-plus", "text-engine"));
  const encoded = fs.readFileSync(path.join(vendor, "harfbuzz.wasm.base64"), "utf8");
  const wasmBinary = Buffer.from(encoded.trim(), "base64");
  return createEngine(api(await factory({ wasmBinary })), () => 0, 256 * 1024 * 1024);
}

function openFont(engine, filePath, reference) {
  const bytes = fs.readFileSync(filePath);
  return engine.open(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), reference);
}

// Two decimals are far below a pixel at this sprite scale and keep the file
// byte-deterministic across runs.
function quantize(value) {
  return String(Math.round(value * 100) / 100);
}

function appendPath(d, type, values) {
  d.push(type + values.map(quantize).join(" "));
}

// Render one label at the default variation instance. Returns the SVG path
// data and the ink box in row pixels at a nominal 1x scale.
function renderRow(engine, filePath, label) {
  const font = openFont(engine, filePath, label);
  try {
    const units = NOMINAL_EM_PX / font.upem;
    const glyphs = font.shape(label, {});
    const runs = [];
    let pen = 0;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const glyph of glyphs) {
      if (glyph.g !== 0) {
        const outline = font.outline(glyph.g, {});
        const placed = [];
        let empty = true;
        let first = true, gx0 = 0, gx1 = 0, gy0 = 0, gy1 = 0;
        for (const command of outline) {
          const values = [];
          for (let i = 0; i + 1 < command.values.length; i += 2) {
            const x = pen + (glyph.dx + command.values[i]) * units;
            const y = (glyph.dy + command.values[i + 1]) * units;
            values.push(x, y);
            if (first) { gx0 = gx1 = x; gy0 = gy1 = y; first = false; }
            else {
              if (x < gx0) gx0 = x; if (x > gx1) gx1 = x;
              if (y < gy0) gy0 = y; if (y > gy1) gy1 = y;
            }
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
          placed.push({ type: command.type, values });
        }
        // Whitespace maps to an empty glyph with an advance but no ink.
        // Zero-area runs paint nothing, so drop them.
        if (!first && (gx0 !== gx1 || gy0 !== gy1)) {
          if (placed.length > 0) runs.push({ pen, glyph, placed });
        }
      }
      pen += glyph.ax * units;
    }
    return { font, runs, advance: pen, minX, maxX, minY, maxY };
  } catch (error) {
    font.dispose();
    throw error;
  }
}

function rowPath(row, rowTop) {
  if (!isFinite(row.minX)) return "";
  const width = Math.max(row.advance, row.maxX - row.minX);
  // Keep ink inside the row: shift right past a negative left bearing, then
  // scale down only when too wide (or, as a safety net, too tall).
  const shift = row.minX < 0 ? -row.minX : 0;
  const fitWidth = ROW_WIDTH / Math.max(width + shift, 1e-9);
  const fitTop = row.maxY > 0 ? BASELINE_PX / row.maxY : 1;
  const fitBottom = row.minY < 0 ? (ROW_HEIGHT - BASELINE_PX) / -row.minY : 1;
  const scale = Math.min(1, fitWidth, fitTop, fitBottom);
  const d = [];
  for (const run of row.runs) {
    for (const command of run.placed) {
      const values = [];
      for (let i = 0; i + 1 < command.values.length; i += 2) {
        values.push((command.values[i] + shift) * scale, rowTop + BASELINE_PX - command.values[i + 1] * scale);
      }
      appendPath(d, command.type, values);
    }
  }
  return d.join("");
}

async function buildSprite() {
  const names = mergedPresets();
  const engine = await loadEngine();
  try {
    const hostDirectory = path.join(defaultResourceCacheRoot, "assets", "fonts", "2d");
    const rows = [];
    for (const name of names) {
      const filePath = presetFile(name);
      const source = fs.existsSync(filePath) ? filePath : path.join(hostDirectory, `${name}.ttf`);
      const row = renderRow(engine, source, name);
      try {
        rows.push(rowPath(row, rows.length * ROW_HEIGHT));
      } finally {
        row.font.dispose();
      }
    }
    const custom = renderRow(engine, INTER_TTF, CUSTOM_LABEL);
    try {
      rows.push(rowPath(custom, rows.length * ROW_HEIGHT));
    } finally {
      custom.font.dispose();
    }
    const height = rows.length * ROW_HEIGHT;
    const body = rows.map(row => `<path fill="#ffffff" d="${row}"/>`).join("");
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${ROW_WIDTH}" height="${height}" viewBox="0 0 ${ROW_WIDTH} ${height}">${body}</svg>\n`;
  } finally {
    // Engine disposal is per-font; the WASM instance is reclaimed on exit.
  }
}

// The runtime patch embeds the same name list so the dropdown row order
// matches the sprite without a runtime fetch. The check keeps them in sync.
function patchNames() {
  const source = fs.readFileSync(PATCH_PATH, "utf8");
  const match = /PRESET_NAMES = (\[[^\]]*\])/.exec(source);
  if (!match) throw new Error("plugins/core/font-presets.js has no synced PRESET_NAMES list.");
  return JSON.parse(match[1]);
}

async function main() {
  if (checkOnly) {
    const sprite = await buildSprite();
    const checkedIn = fs.existsSync(SPRITE_PATH) ? fs.readFileSync(SPRITE_PATH, "utf8") : null;
    if (checkedIn !== sprite) {
      throw new Error("fonts/font-previews.svg is stale (run node tools/build-font-previews.js).");
    }
    const wanted = readPresetList();
    const embedded = patchNames();
    if (JSON.stringify(embedded) !== JSON.stringify(wanted)) {
      throw new Error("plugins/core/font-presets.js preset list differs from fonts/presets.json.");
    }
    console.log(`[Zoidium] font previews are fresh (${wanted.length} presets).`);
    return;
  }
  const sprite = await buildSprite();
  if (writeFileIfChangedAtomic(SPRITE_PATH, sprite)) console.log("[Zoidium] rebuilt fonts/font-previews.svg.");
  else console.log("[Zoidium] fonts/font-previews.svg is already fresh.");
}

main().catch(error => {
  console.error(`[Zoidium] ${error.message}`);
  process.exitCode = 1;
});
