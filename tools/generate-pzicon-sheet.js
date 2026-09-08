#!/usr/bin/env node

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const projectRoot = path.resolve(__dirname, "..");
const defaultInputs = [
  process.env.ZOIDIUM_PZICON_SOURCE,
  path.join(projectRoot, ".zoidium-resources", "pz.icons29.svg"),
  path.join(projectRoot, "dist", "web", "pz.icons29.svg"),
].filter(Boolean);

const args = process.argv.slice(2);
const helpRequested = args.includes("--help") || args.includes("-h");

if (helpRequested) {
  console.log(`Usage: node tools/generate-pzicon-sheet.js [options]

Options:
  --input <path>   Read pz.icons29.svg from this path.
  --output <path>  Write the SVG sheet to this path.
  --png            Also convert the SVG sheet to PNG with rsvg-convert.
  --png-output <path>
                   Choose the PNG output path (implies --png).
  -h, --help       Show this help.

Defaults:
  input:  .zoidium-resources/pz.icons29.svg (or dist/web/pz.icons29.svg)
  output: dist/pzicon-sheet.svg
  PNG:    dist/pzicon-sheet.png when --png is supplied
`);
  process.exit(0);
}

function optionValue(name) {
  const index = args.indexOf(name);
  return index === -1 ? null : args[index + 1];
}

function firstExisting(paths) {
  return paths.find((candidate) => fs.existsSync(candidate));
}

const inputPath = path.resolve(optionValue("--input") || firstExisting(defaultInputs) || defaultInputs[0]);
const outputPath = path.resolve(
  optionValue("--output") || path.join(projectRoot, "dist", "pzicon-sheet.svg"),
);
const pngRequested = args.includes("--png") || args.includes("--png-output");
const pngPath = path.resolve(
  optionValue("--png-output") || outputPath.replace(/\.svg$/i, ".png"),
);

if (!fs.existsSync(inputPath)) {
  console.error(`Could not find the pzicon source SVG: ${inputPath}`);
  console.error("Run `pnpm run setup` first, or pass --input <path>.");
  process.exit(1);
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function parseSymbols(source) {
  const symbols = [];
  const pattern = /<symbol\b([^>]*)>([\s\S]*?)<\/symbol>/g;
  for (const match of source.matchAll(pattern)) {
    const attributes = match[1];
    const idMatch = attributes.match(/\bid="([^"]+)"/);
    const viewBoxMatch = attributes.match(/\bviewBox="([^"]+)"/);
    if (!idMatch || !viewBoxMatch) continue;
    symbols.push({
      id: idMatch[1],
      viewBox: viewBoxMatch[1],
      markup: match[0],
    });
  }
  if (symbols.length === 0) throw new Error("No <symbol> elements were found in the pzicon source SVG.");
  return symbols;
}

function numericViewBox(viewBox) {
  const values = viewBox.trim().split(/\s+/).map(Number);
  return values.length === 4 && values.every(Number.isFinite) ? values : [0, 0, 100, 100];
}

function groupFor(id) {
  if (/^ease_\d+$/.test(id)) return "Easing presets";
  if (/^interp_\d+$/.test(id)) return "Interpolation presets";
  return "General icons";
}

function sortSymbols(symbols) {
  const groupOrder = { "General icons": 0, "Easing presets": 1, "Interpolation presets": 2 };
  return [...symbols].sort((a, b) => {
    const groupDifference = groupOrder[groupFor(a.id)] - groupOrder[groupFor(b.id)];
    if (groupDifference !== 0) return groupDifference;
    const aPreset = a.id.match(/^(?:ease|interp)_(\d+)$/);
    const bPreset = b.id.match(/^(?:ease|interp)_(\d+)$/);
    if (aPreset && bPreset) return Number(aPreset[1]) - Number(bPreset[1]);
    return a.sourceIndex - b.sourceIndex;
  });
}

function makeSheet(symbols) {
  const columns = 8;
  const cellWidth = 168;
  const cellHeight = 132;
  const outer = 36;
  const groupGap = 38;
  const headerHeight = 116;
  const groups = ["General icons", "Easing presets", "Interpolation presets"].map((name) => ({
    name,
    items: symbols.filter((symbol) => groupFor(symbol.id) === name),
  }));
  let y = headerHeight;
  const placements = [];
  const groupLayouts = [];

  for (const group of groups) {
    const rows = Math.ceil(group.items.length / columns);
    const headingY = y + 22;
    y += groupGap;
    group.items.forEach((symbol, index) => {
      const column = index % columns;
      const row = Math.floor(index / columns);
      placements.push({
        symbol,
        x: outer + column * cellWidth,
        y: y + row * cellHeight,
      });
    });
    groupLayouts.push({ ...group, headingY, y, rows });
    y += rows * cellHeight + 20;
  }

  const width = outer * 2 + columns * cellWidth;
  const height = y + 12;
  const defs = symbols.map((symbol) => symbol.markup).join("");
  const icons = placements.map(({ symbol, x, y: cellY }) => {
    const [minX, minY, viewWidth, viewHeight] = numericViewBox(symbol.viewBox);
    const iconSize = /^ease_|^interp_/.test(symbol.id) ? { width: 92, height: 62 } : { width: 76, height: 76 };
    const iconX = x + (cellWidth - iconSize.width) / 2;
    const iconY = cellY + 11 + (76 - iconSize.height) / 2;
    const labelY = cellY + 109;
    return `
    <g class="pzicon-cell" transform="translate(${x} ${cellY})">
      <rect width="${cellWidth - 8}" height="${cellHeight - 8}" rx="5" fill="#222832" stroke="#3a4351" />
      <svg x="${iconX - x}" y="${iconY - cellY}" width="${iconSize.width}" height="${iconSize.height}" viewBox="${escapeXml(`${minX} ${minY} ${viewWidth} ${viewHeight}`)}" preserveAspectRatio="xMidYMid meet" overflow="visible" aria-label="${escapeXml(symbol.id)}">
        <use href="#${escapeXml(symbol.id)}" xlink:href="#${escapeXml(symbol.id)}" fill="#e2e8f0" />
      </svg>
      <text x="${(cellWidth - 8) / 2}" y="${labelY - cellY}" fill="#d8dee9" font-size="12" text-anchor="middle">${escapeXml(symbol.id)}</text>
    </g>`;
  }).join("");
  const headings = groupLayouts.map((group) => `
    <text x="${outer}" y="${group.headingY}" class="group-heading">${escapeXml(group.name)} <tspan class="group-count">(${group.items.length})</tspan></text>`).join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <title>pzicon catalog</title>
  <desc>${symbols.length} icons extracted from pz.icons29.svg</desc>
  <style>
    text { font-family: "Source Code Pro", "SFMono-Regular", Consolas, monospace; }
    .title { fill: #f2f5f9; font-size: 27px; font-weight: 600; }
    .subtitle { fill: #9da8b8; font-size: 13px; }
    .group-heading { fill: #aeb9d1; font-size: 16px; font-weight: 600; }
    .group-count { fill: #768398; font-weight: 400; }
  </style>
  <rect width="100%" height="100%" fill="#171b21" />
  <text x="${outer}" y="45" class="title">pzicon catalog</text>
  <text x="${outer}" y="71" class="subtitle">${symbols.length} symbols from pz.icons29.svg · generated by Zoidium</text>
  <text x="${width - outer}" y="45" class="subtitle" text-anchor="end">${new Date().toISOString().slice(0, 10)}</text>
  ${headings}
  <defs>${defs}</defs>
  ${icons}
</svg>
`;
}

const source = fs.readFileSync(inputPath, "utf8");
const symbols = parseSymbols(source).map((symbol, sourceIndex) => ({ ...symbol, sourceIndex }));
const sortedSymbols = sortSymbols(symbols);
const sheet = makeSheet(sortedSymbols);
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, sheet);

console.log(`Wrote ${sortedSymbols.length} pzicon entries to ${path.relative(projectRoot, outputPath) || outputPath}`);

if (pngRequested) {
  const converter = spawnSync("rsvg-convert", ["-o", pngPath, outputPath], { encoding: "utf8" });
  if (converter.error || converter.status !== 0) {
    const reason = converter.error?.message || converter.stderr?.trim() || `exit code ${converter.status}`;
    console.error(`Could not convert the SVG sheet to PNG: ${reason}`);
    console.error("Install librsvg or run without --png to keep the SVG output.");
    process.exit(1);
  }
  console.log(`Wrote PNG preview to ${path.relative(projectRoot, pngPath) || pngPath}`);
}
