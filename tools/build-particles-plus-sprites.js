#!/usr/bin/env node

/*
 * Build the procedural, monochrome sprite set used by Particles+.
 *
 * The source images are deliberately generated from equations rather than
 * copied from the CM3 resource cache or from any reference preset. Every
 * output pixel is white; opacity is the only carrier of tone.
 */

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const { withFade } = require("./particles-plus-math");
const { fieldForSprite } = require("./particles-plus-fields");
const {
  HEIGHT, WIDTH, decodePng, encodePng, pngChunk, renderSprite,
} = require("./particles-plus-png");

const ROOT = path.resolve(__dirname, "..");
const OUTPUT_DIR = path.join(ROOT, "plugins", "particles-plus", "sprites");

const SPRITE_IDS = [
  "circle",
  "square",
  "triangle",
  "pentagon",
  "hexagon",
  "octagon",
  "diamond",
  "ring_outline",
  "ring_double",
  "triangle_outline",
  "square_outline",
  "rounded_square",
  "rounded_square_outline",
  "hexagon_outline",
  "plus",
  "plus_cut_square",
  "cross",
  "cross_outline",
  "line_horizontal",
  "line_vertical",
  "grid",
  "dot_grid",
  "radial_lines",
  "spiral",
  "snowflake",
  "lattice",
  "concentric_rings",
  "broken_ring",
  "star_5",
  "star_6",
  "star_8",
  "flare_glow_ring",
  "flare_halo",
  "flare_double_halo",
  "flare_blob",
  "flare_orb_soft",
  "flare_burst",
  "flare_burst_soft",
  "flare_needles",
  "flare_starburst_fine",
  "flare_starburst_dust",
  "flare_eight_ray",
  "flare_streak_thin",
  "flare_streak_wide",
  "flare_streak_glow",
  "flare_vertical_streak",
  "flare_crossbeam",
  "flare_fourdot",
  "flare_fourdot_soft",
  "flare_sixdot",
  "flare_ring_streak",
  "flare_ripple",
  "flare_spectral",
  "flare_glint",
];

function assertManifestMatches() {
  const manifestPath = path.join(ROOT, "plugins", "particles-plus", "manifest.json");
  if (!fs.existsSync(manifestPath)) return;
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const manifestIds = manifest.resources
    .filter((resource) => resource.type === "image")
    .map((resource) => resource.id.replace(/^sprite-/, ""))
    .sort();
  const catalogIds = [...SPRITE_IDS].sort();
  if (JSON.stringify(manifestIds) !== JSON.stringify(catalogIds)) {
    throw new Error(`manifest image resources do not match sprite catalog (${manifestIds.length} vs ${catalogIds.length})`);
  }
}

function validateSprites({ checkManifest = true } = {}) {
  if (new Set(SPRITE_IDS).size !== SPRITE_IDS.length) throw new Error("sprite ids are not unique");
  for (const id of SPRITE_IDS) {
    if (!/^[a-z0-9]+(?:_[a-z0-9]+)*$/.test(id)) throw new Error(`invalid sprite id: ${id}`);
  }
  if (checkManifest) assertManifestMatches();
  if (!fs.existsSync(OUTPUT_DIR)) throw new Error(`missing sprite directory: ${OUTPUT_DIR}`);
  const expectedFiles = new Set(SPRITE_IDS.map((id) => `${id}.png`));
  const actualFiles = new Set(fs.readdirSync(OUTPUT_DIR).filter((name) => name.endsWith(".png")));
  for (const file of expectedFiles) if (!actualFiles.has(file)) throw new Error(`missing sprite: ${file}`);
  for (const file of actualFiles) if (!expectedFiles.has(file)) throw new Error(`unexpected sprite: ${file}`);

  for (const id of SPRITE_IDS) {
    const { width, height, rgba } = decodePng(fs.readFileSync(path.join(OUTPUT_DIR, `${id}.png`)));
    if (width !== WIDTH || height !== HEIGHT) throw new Error(`${id}: expected ${WIDTH}x${HEIGHT}, got ${width}x${height}`);
    let visible = 0;
    let minX = WIDTH;
    let minY = HEIGHT;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const offset = (y * width + x) * 4;
        if (rgba[offset] !== 255 || rgba[offset + 1] !== 255 || rgba[offset + 2] !== 255) {
          throw new Error(`${id}: non-white RGB at ${x},${y}`);
        }
        if (rgba[offset + 3] > 0) {
          visible += 1;
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x);
          maxY = Math.max(maxY, y);
        }
      }
    }
    if (visible === 0) throw new Error(`${id}: sprite is fully transparent`);
    if (minX < 4 || minY < 4 || maxX > WIDTH - 5 || maxY > HEIGHT - 5) {
      throw new Error(`${id}: visible bounds ${minX},${minY}..${maxX},${maxY} violate safety margin`);
    }
  }
}

function generateSprites(spriteIds = SPRITE_IDS) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  for (const id of spriteIds) {
    const field = fieldForSprite(id);
    if (!field) throw new Error(`no field registered for ${id}`);
    fs.writeFileSync(
      path.join(OUTPUT_DIR, `${id}.png`),
      encodePng(renderSprite(withFade(field), id.startsWith("flare_"))),
    );
  }
  validateSprites({ checkManifest: false });
}

function writeContactSheet(filePath) {
  const columns = 6;
  const cellSize = 160;
  const rows = Math.ceil(SPRITE_IDS.length / columns);
  const sheetWidth = columns * cellSize;
  const sheetHeight = rows * cellSize;
  const sheet = Buffer.alloc(sheetWidth * sheetHeight * 4);
  for (let index = 0; index < sheet.length; index += 4) {
    sheet[index] = 0;
    sheet[index + 1] = 0;
    sheet[index + 2] = 0;
    sheet[index + 3] = 255;
  }
  SPRITE_IDS.forEach((id, index) => {
    const { rgba } = decodePng(fs.readFileSync(path.join(OUTPUT_DIR, `${id}.png`)));
    const cellX = (index % columns) * cellSize + 16;
    const cellY = Math.floor(index / columns) * cellSize + 16;
    for (let y = 0; y < HEIGHT; y += 1) {
      for (let x = 0; x < WIDTH; x += 1) {
        const sourceOffset = (y * WIDTH + x) * 4;
        const targetOffset = ((cellY + y) * sheetWidth + cellX + x) * 4;
        const alpha = rgba[sourceOffset + 3] / 255;
        sheet[targetOffset] = Math.round(255 * alpha);
        sheet[targetOffset + 1] = Math.round(255 * alpha);
        sheet[targetOffset + 2] = Math.round(255 * alpha);
        sheet[targetOffset + 3] = 255;
      }
    }
  });

  const raw = Buffer.alloc((sheetWidth * 4 + 1) * sheetHeight);
  for (let y = 0; y < sheetHeight; y += 1) {
    const rowOffset = y * (sheetWidth * 4 + 1);
    raw[rowOffset] = 0;
    sheet.copy(raw, rowOffset + 1, y * sheetWidth * 4, (y + 1) * sheetWidth * 4);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(sheetWidth, 0);
  header.writeUInt32BE(sheetHeight, 4);
  header[8] = 8;
  header[9] = 6;
  fs.mkdirSync(path.dirname(path.resolve(filePath)), { recursive: true });
  fs.writeFileSync(path.resolve(filePath), Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    pngChunk("IHDR", header),
    pngChunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]));
}

function main() {
  const args = process.argv.slice(2);
  const sheetIndex = args.indexOf("--sheet");
  const sheetPath = sheetIndex >= 0 ? args[sheetIndex + 1] : null;
  if (sheetIndex >= 0 && (!sheetPath || sheetPath.startsWith("--"))) throw new Error("--sheet requires a file path");

  const onlyIndex = args.indexOf("--only");
  let selectedIds = SPRITE_IDS;
  if (onlyIndex >= 0) {
    const onlyValue = args[onlyIndex + 1];
    if (!onlyValue || onlyValue.startsWith("--")) throw new Error("--only requires a comma-separated sprite id list");
    selectedIds = onlyValue.split(",").map((id) => id.trim()).filter(Boolean);
    for (const id of selectedIds) {
      if (!SPRITE_IDS.includes(id)) throw new Error(`unknown sprite id in --only: ${id}`);
    }
  }

  if (!args.includes("--check")) generateSprites(selectedIds);
  validateSprites({ checkManifest: true });
  if (sheetPath) writeContactSheet(sheetPath);
  process.stdout.write(`Particles+ sprites valid: ${SPRITE_IDS.length} x ${WIDTH}x${HEIGHT}\n`);
  if (sheetPath) process.stdout.write(`Contact sheet: ${path.resolve(sheetPath)}\n`);
  process.stdout.write(`${SPRITE_IDS.join(" ")}\n`);
}

main();

module.exports = { OUTPUT_DIR, SPRITE_IDS, generateSprites, validateSprites };
