#!/usr/bin/env node

/*
 * Build the CCFX Shader Pack plugin from the pack's exported .txt files.
 *
 * The source pack is intentionally kept outside the repository. This builder
 * extracts standalone shader objects and group presets into the source/preset
 * layout consumed by Zoidium's plugin bundle builder.
 */

"use strict";

const fs = require("fs");
const path = require("path");

const sourceRootArg = process.argv[2];
const projectRoot = path.resolve(__dirname, "..");
const outputRoot = path.join(projectRoot, "plugins", "ccfx");

if (!sourceRootArg) {
  console.error("Usage: node tools/build-ccfx-plugin.js <ccfx-shader-pack-directory>");
  process.exit(1);
}

const sourceRoot = path.resolve(sourceRootArg);

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(entryPath) : [entryPath];
  });
}

function slugify(value) {
  return value
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function relativeSource(filePath) {
  return path.relative(sourceRoot, filePath).replace(/\\/g, "/");
}

function categoryFor(relativePath) {
  const directory = path.posix.dirname(relativePath);
  if (directory.endsWith("/Backgrounds")) return "CCFX · BACKGROUNDS";
  if (directory.endsWith("/Distort")) return "CCFX · DISTORT";
  if (directory.endsWith("/Transitions")) return "CCFX · TRANSITIONS";
  if (directory.endsWith("/Miscellaneous")) return "CCFX · MISCELLANEOUS";
  if (directory.startsWith("Part 2")) return "CCFX · PART 2";
  return "CCFX";
}

const DISPLAY_NAMES = {
  "Part 1/Distort/Puddle.txt": "Puddle",
  "Part 1/Distort/Warp waves.txt": "Warp Waves",
  "Part 1/Transitions/s_wipechecker.txt": "Wipe Checker",
  "Part 1/Transitions/s_wipedots.txt": "Wipe Dots",
  "Part 1/Transitions/s_wiperings.txt": "Wipe Rings",
  "Part 1/Transitions/s_wipestripes.txt": "Wipe Stripes",
  "Part 2/CC Bend It.txt": "CC Bend It",
};

const EFFECT_DESCRIPTIONS = Object.freeze({
  "Part 1/Backgrounds/Sunburst.txt":
    "Generates an animated radial sunburst with adjustable ray shape and color.",
  "Part 1/Backgrounds/Voronoi Cell Pattern.txt":
    "Generates evolving Voronoi patterns in several cell styles.",
  "Part 1/Distort/Puddle.txt":
    "Distorts the image with concentric ripples.",
  "Part 1/Distort/Skew V2.txt":
    "Skews and tiles the image along a chosen angle.",
  "Part 1/Distort/Warp waves.txt":
    "Warps the image with an animated directional wave.",
  "Part 1/Transitions/s_wipechecker.txt":
    "Transitions images with a checkerboard wipe.",
  "Part 1/Transitions/s_wipedots.txt":
    "Wipes the image with growing or shrinking dots.",
  "Part 1/Transitions/s_wiperings.txt":
    "Wipes the image with expanding concentric rings.",
  "Part 1/Transitions/s_wipestripes.txt":
    "Transitions images with an angled stripe wipe.",
  "Part 2/CC Light Sweep.txt":
    "Adds a linear or circular light sweep.",
  "Part 2/Lens Flare Lite.txt":
    "Generates anamorphic, geometric, or orb lens flares.",
  "Part 2/Plexus V1.txt":
    "Creates an animated network of glowing points and lines.",
});

const GROUP_DESCRIPTIONS = Object.freeze({
  "Part 1/Backgrounds/MxsterFX Halfdots BG.txt":
    "Creates a dotted background with a radial wave.",
  "Part 1/Backgrounds/MxsterFX Square BG.txt":
    "Creates a tiled square background with a radial wave.",
  "Part 1/Miscellaneous/Extrude.txt":
    "Creates a layered extrusion from the source image.",
  "Part 2/CC Bend It.txt":
    "Bends the image between two configurable points.",
  "Part 2/Hexagon Array.txt":
    "Overlays a configurable hexagonal pattern.",
  "Part 2/Plexus V2.txt":
    "Creates an animated plexus of dots and lines.",
  "Part 2/Warp.txt":
    "Warps the image with selectable geometric profiles.",
});

function descriptionFor(descriptions, relative, kind) {
  const description = descriptions[relative];
  if (typeof description !== "string" || !description.trim()) {
    throw new Error(`Missing ${kind} description for ${relative}`);
  }
  return description;
}

function displayNameFor(filePath, object) {
  const relative = relativeSource(filePath);
  return DISPLAY_NAMES[relative] || object?.properties?.name || path.basename(relative, ".txt");
}

function parseSource(filePath) {
  const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  return parsed?.[0]?.data?.[0] || null;
}

function normalizedShader(source) {
  return `${source.trimStart().replace(/\s+$/, "")}\n`;
}

fs.mkdirSync(path.join(outputRoot, "effects"), { recursive: true });
fs.mkdirSync(path.join(outputRoot, "groups"), { recursive: true });
fs.mkdirSync(path.join(outputRoot, "shaders", "groups"), { recursive: true });

const usedShaderPaths = new Set();
function writeShader(relativePath, source) {
  let candidate = relativePath;
  let suffix = 2;
  while (usedShaderPaths.has(candidate)) {
    const extension = path.posix.extname(relativePath);
    const base = relativePath.slice(0, -extension.length);
    candidate = `${base}-${suffix++}${extension}`;
  }
  usedShaderPaths.add(candidate);
  const filePath = path.join(outputRoot, candidate);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, source);
  return `./plugins/ccfx/${candidate}`;
}

function normalizeGroup(group, groupId) {
  const result = clone(group);
  const shaderPaths = [];
  const excludedShaderNames =
    groupId === "group-part-1-miscellaneous-extrude" ? new Set(["Stroke"]) : new Set();

  function visit(node, indexPath) {
    if (!node || typeof node !== "object") return;
    if (node.type === 1 && typeof node.properties?.fragShader === "string") {
      const shaderName = node.properties.name || "CCFX Shader";
      const fileName = `${groupId}-${slugify(indexPath.join("-") + "-" + shaderName)}.glsl`;
      const shaderPath = writeShader(
        path.posix.join("shaders", "groups", fileName),
        normalizedShader(node.properties.fragShader)
      );
      delete node.properties.fragShader;
      node._zoidiumShader = shaderPath;
      shaderPaths.push(shaderPath);
    }
    if (Array.isArray(node.objects)) {
      node.objects = node.objects.filter(
        (child) => !(child?.type === 1 && excludedShaderNames.has(child.properties?.name))
      );
      node.objects.forEach((child, index) => visit(child, [...indexPath, String(index)]));
    }
  }

  visit(result, []);
  return { result, shaderPaths };
}

const effects = [];
const groups = [];
const skipped = [];
const sourceFiles = walk(sourceRoot)
  .filter((filePath) => filePath.toLowerCase().endsWith(".txt"))
  .sort((a, b) => a.localeCompare(b, "en"));

for (const filePath of sourceFiles) {
  const relative = relativeSource(filePath);
  let sourceObject;
  try {
    sourceObject = parseSource(filePath);
  } catch (error) {
    skipped.push(`${relative} (${error.message})`);
    continue;
  }

  if (sourceObject?.type === 1 && typeof sourceObject.properties?.fragShader === "string") {
    const id = slugify(relative.replace(/\.txt$/i, ""));
    const name = displayNameFor(filePath, sourceObject);
    const preset = clone(sourceObject);
    preset.properties.name = name;
    delete preset.properties.fragShader;
    const shaderFile = `shaders/${id}.glsl`;
    const presetFile = `effects/${id}.json`;
    writeJson(path.join(outputRoot, presetFile), preset);
    writeShader(shaderFile, normalizedShader(sourceObject.properties.fragShader));
    effects.push({
      id,
      name,
      description: descriptionFor(EFFECT_DESCRIPTIONS, relative, "effect"),
      category: categoryFor(relative),
      source: relative,
      shader: `./plugins/ccfx/${shaderFile}`,
      preset: `./plugins/ccfx/${presetFile}`,
    });
    continue;
  }

  if (sourceObject?.type === 0 && Array.isArray(sourceObject.objects)) {
    const id = `group-${slugify(relative.replace(/\.txt$/i, ""))}`;
    const name = displayNameFor(filePath, sourceObject);
    const normalized = normalizeGroup(sourceObject, id);
    normalized.result.properties = normalized.result.properties || {};
    normalized.result.properties.name = name;
    const presetFile = `groups/${id}.json`;
    writeJson(path.join(outputRoot, presetFile), normalized.result);
    groups.push({
      id,
      name,
      description: descriptionFor(GROUP_DESCRIPTIONS, relative, "group"),
      category: categoryFor(relative),
      source: relative,
      preset: `./plugins/ccfx/${presetFile}`,
      shaders: normalized.shaderPaths,
    });
    continue;
  }

  skipped.push(relative);
}

effects.sort((a, b) => a.source.localeCompare(b.source, "en"));
groups.sort((a, b) => a.source.localeCompare(b.source, "en"));

const manifest = {
  schemaVersion: 1,
  id: "ccfx-shader-pack",
  name: "CCFX Shader Pack",
  author: "CCFX",
  version: "1",
  category: "CCFX SHADER PACK",
  description: "A collection of CCFX GLSL shader effects and group presets.",
  effectCount: effects.length,
  groupCount: groups.length,
  effects,
  groups,
};

writeJson(path.join(outputRoot, "manifest.json"), manifest);
fs.writeFileSync(
  path.join(outputRoot, "README.md"),
  `# CCFX Shader Pack\n\n` +
    `Optional CCFX shader effects and group presets for Zoidium.\n\n` +
    `- Standalone shaders: ${effects.length}\n` +
    `- Group presets: ${groups.length}\n` +
    `- Source author: CCFX\n\n` +
    `The generated files are built by \`tools/build-ccfx-plugin.js\` from the external CCFX Shader Pack source tree. ` +
    `The original source dump and project file are not included in the repository.\n`
);

console.log(`Built CCFX plugin: ${effects.length} shaders + ${groups.length} groups`);
if (skipped.length) {
  console.log(`Skipped ${skipped.length} unsupported source files:`);
  for (const file of skipped) console.log(`  - ${file}`);
}
