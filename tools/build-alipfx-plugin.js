#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const sourceRoot = process.argv[2];
const projectRoot = path.resolve(__dirname, "..");
const outputRoot = path.join(projectRoot, "plugins", "alipfx");
const descriptionsPath = path.join(outputRoot, "descriptions.json");

if (!sourceRoot) {
  console.error("Usage: node tools/build-alipfx-plugin.js <shader-pack-directory>");
  process.exit(1);
}

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
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function descriptionFor(id, displayName) {
  const description = descriptions[id];
  if (typeof description !== "string" || !description.trim()) {
    throw new Error(`Missing description for ${displayName} (${id})`);
  }
  return description.trim();
}

let descriptions = {};
if (fs.existsSync(descriptionsPath)) {
  try {
    descriptions = JSON.parse(fs.readFileSync(descriptionsPath, "utf8"));
    if (!descriptions || typeof descriptions !== "object" || Array.isArray(descriptions)) {
      throw new Error("descriptions.json must contain an object keyed by effect id");
    }
  } catch (error) {
    console.error(`Unable to read ${descriptionsPath}: ${error.message}`);
    process.exit(1);
  }
}

const sourceFiles = walk(path.resolve(sourceRoot))
  .filter((filePath) => filePath.toLowerCase().endsWith(".txt"))
  .sort((a, b) => a.localeCompare(b, "en"));

fs.mkdirSync(path.join(outputRoot, "effects"), { recursive: true });
fs.mkdirSync(path.join(outputRoot, "shaders"), { recursive: true });

const usedIds = new Map();
const effects = [];
const skipped = [];

for (const sourcePath of sourceFiles) {
  const relativeSource = path.relative(path.resolve(sourceRoot), sourcePath);
  let sourceObject;

  try {
    sourceObject = JSON.parse(fs.readFileSync(sourcePath, "utf8"));
  } catch (_error) {
    skipped.push(relativeSource);
    continue;
  }

  const shaderData = sourceObject?.[0]?.data?.[0];
  const fragmentShader = shaderData?.properties?.fragShader;
  if (shaderData?.type !== 1 || typeof fragmentShader !== "string") {
    skipped.push(relativeSource);
    continue;
  }

  const displayName = shaderData.properties.name || path.basename(sourcePath, ".txt");
  const baseId = slugify(displayName) || "shader";
  const idCount = (usedIds.get(baseId) || 0) + 1;
  usedIds.set(baseId, idCount);
  const id = idCount === 1 ? baseId : `${baseId}-${idCount}`;

  const preset = JSON.parse(JSON.stringify(shaderData));
  delete preset.properties.fragShader;

  const shaderFile = `shaders/${id}.glsl`;
  const presetFile = `effects/${id}.json`;
  const normalizedShader = fragmentShader.trimStart().replace(/\s+$/, "") + "\n";

  fs.writeFileSync(path.join(outputRoot, shaderFile), normalizedShader);
  writeJson(path.join(outputRoot, presetFile), preset);

  effects.push({
    id,
    name: displayName,
    description: descriptionFor(id, displayName),
    source: relativeSource,
    shader: `./plugins/alipfx/${shaderFile}`,
    preset: `./plugins/alipfx/${presetFile}`,
  });
}

effects.sort((a, b) => a.name.localeCompare(b.name, "en"));

const manifest = {
  schemaVersion: 1,
  id: "alipfx-shader-pack-4",
  name: "Afterzoid Shader Pack 4",
  author: "AlipFX",
  version: "4",
  category: "ALIPFX · SHADER PACK 4",
  description: "A collection of native Panzoid GLSL shader effects.",
  effectCount: effects.length,
  effects,
};

writeJson(path.join(outputRoot, "manifest.json"), manifest);

console.log(`Built ${effects.length} AlipFX shader effects in ${outputRoot}`);
if (skipped.length) {
  console.log(`Skipped ${skipped.length} non-shader text files:`);
  for (const file of skipped) console.log(`  - ${file}`);
}
