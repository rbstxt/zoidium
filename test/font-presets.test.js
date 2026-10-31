"use strict";

// Built-in font presets: the preset list, the generated preview sprite, the
// host-side parsing of every new file, the Resolve Fonts mapping, the stage
// copies, and the pre-init preset patch. Tests that read the CM3 resource
// cache skip when it is absent (run pnpm run setup).

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const cache = process.env.ZOIDIUM_RESOURCE_DIR || path.join(root, ".zoidium-resources");
const cacheMissing = !fs.existsSync(path.join(cache, "core-1.0.102.js")) ||
  !fs.existsSync(path.join(cache, "assets", "fonts", "2d"));
const skipCache = cacheMissing ? "CM3 cache missing (run pnpm run setup)" : false;

const previews = require("../tools/build-font-previews");
const PRESET_FILES = previews.readPresetList().map(entry => `fonts/presets/${entry.name}.ttf`);

function presetEntries() {
  return previews.readPresetList();
}

function presetNames() {
  return presetEntries().map(entry => entry.name);
}

function hostNames() {
  return previews.readHostPresets();
}

function readSprite() {
  return fs.readFileSync(path.join(root, "fonts", "font-previews.svg"), "utf8");
}

function spriteRows(svg) {
  return [...svg.matchAll(/<path fill="#ffffff" d="([^"]*)"\/>/g)].map(match => match[1]);
}

async function shapeEngine() {
  const api = require("../plugins/shape-plus/vendor/harfbuzz-api");
  const factory = require("../plugins/shape-plus/vendor/harfbuzz");
  const { createEngine } = require("../plugins/shape-plus/text-engine");
  const encoded = fs.readFileSync(
    path.join(root, "plugins", "shape-plus", "vendor", "harfbuzz.wasm.base64"), "utf8");
  return createEngine(api(await factory({ wasmBinary: Buffer.from(encoded.trim(), "base64") })), () => 0);
}

function openRepoFont(engine, name) {
  const bytes = fs.readFileSync(path.join(root, "fonts", "presets", `${name}.ttf`));
  return engine.open(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), name);
}

function nativeHost() {
  const context = vm.createContext({
    PZ: {}, ISNODE: true, console, setTimeout, clearTimeout, TextEncoder, TextDecoder,
    performance, URL, Image: class {}, CSS: { supports: () => true },
    window: { addEventListener() {} }, navigator: {}, document: {},
  });
  for (const name of ["three.r91.min.js", "core-1.0.102.js", "ui-1.0.72.js"]) {
    vm.runInContext(fs.readFileSync(path.join(cache, name), "utf8"), context);
  }
  return context;
}

test("preset list is sorted, valid file names, and every file exists", () => {
  const entries = presetEntries();
  const names = entries.map(entry => entry.name);
  assert.deepEqual(names, [...names].sort(), "fonts/presets.json must stay alphabetically sorted");
  for (const { name, label } of entries) {
    assert.match(name, /^[a-z0-9][a-z0-9 ]*$/, `invalid preset name: ${name}`);
    assert.equal(typeof label, "string", `missing display label: ${name}`);
    assert.ok(label.length > 0, `empty display label: ${name}`);
    assert.ok(fs.existsSync(path.join(root, "fonts", "presets", `${name}.ttf`)), `missing file: ${name}.ttf`);
  }
});

test("sprite rows render the display label in key order", { skip: skipCache }, async () => {
  const merged = previews.mergedPresets();
  const names = merged.map(entry => entry.name);
  assert.deepEqual(names, [...names].sort(), "sprite row order must follow the lowercase preset keys");
  const labels = new Map(merged.map(entry => [entry.name, entry.label]));
  assert.equal(labels.get("geist"), "Geist");
  assert.equal(labels.get("geist pixel square"), "Geist Pixel Square");
  assert.equal(labels.get("geist serif"), "Geist Serif");
  assert.equal(labels.get("inter"), "inter");
  assert.equal(labels.get("paper mono"), "paper mono");
  // The sprite row for a labelled preset matches label shaping, not key shaping.
  const engine = await shapeEngine();
  const file = path.join(root, "fonts", "presets", "geist.ttf");
  const labelRow = previews.renderRow(engine, file, "Geist");
  const keyRow = previews.renderRow(engine, file, "geist");
  try {
    assert.notEqual(labelRow.advance, keyRow.advance, "display label must change the shaped row");
    const index = names.indexOf("geist");
    const rows = spriteRows(await previews.buildSprite());
    assert.equal(rows[index], previews.rowPath(labelRow, index * previews.ROW_HEIGHT));
  } finally {
    labelRow.font.dispose();
    keyRow.font.dispose();
  }
});

test("preset order is alphabetical and contains every host and preset file", { skip: skipCache }, () => {
  const merged = previews.mergedPresets();
  const names = merged.map(entry => entry.name);
  assert.deepEqual(names, [...names].sort(), "merged preset order must be alphabetical");
  assert.deepEqual([...hostNames(), ...presetNames()].sort(), names);
  for (const name of hostNames()) {
    assert.ok(names.includes(name), `host preset missing from sprite order: ${name}`);
  }
  for (const name of presetNames()) {
    assert.ok(names.includes(name), `new preset missing from sprite order: ${name}`);
  }
});

test("sprite build is deterministic and has one row per preset plus custom", { skip: skipCache }, async () => {
  const first = await previews.buildSprite();
  const second = await previews.buildSprite();
  assert.equal(second, first, "sprite bytes must be identical across builds");
  const rows = spriteRows(first);
  assert.equal(rows.length, previews.mergedPresets().length + 1);
  assert.ok(rows.every(row => row.length > 0), "every row must render ink");
  assert.equal(first, readSprite(), "checked-in sprite must match a fresh build");
});

test("checked-in sprite rows fit their 200x25 cells", () => {
  const svg = readSprite();
  const rows = spriteRows(svg);
  const height = Number(/height="(\d+)"/.exec(svg)[1]);
  assert.equal(rows.length, height / previews.ROW_HEIGHT);
  assert.ok(rows.length > presetNames().length, "sprite must hold host rows plus new presets plus custom");
  rows.forEach((row, index) => {
    const tokens = row.split(/(?=[MLCQZ])/);
    assert.ok(tokens.length > 0, `row ${index} is empty`);
    for (const token of tokens) {
      const numbers = token.slice(1).trim().split(/\s+/).filter(part => part.length).map(Number);
      for (let k = 0; k < numbers.length; k += 2) {
        const x = numbers[k], y = numbers[k + 1], top = index * previews.ROW_HEIGHT;
        assert.ok(x >= -0.01 && x <= previews.ROW_WIDTH + 0.01, `row ${index} overflows horizontally: ${x}`);
        assert.ok(y >= top - 0.01 && y <= top + previews.ROW_HEIGHT + 0.01, `row ${index} overflows vertically: ${y}`);
      }
    }
  });
});

test("every new preset parses with the host opentype parser", { skip: skipCache }, () => {
  const { opentype } = nativeHost();
  assert.equal(typeof opentype.parse, "function", "host bundle must expose opentype.parse");
  const variable = new Set(["geist", "geist mono", "geist serif", "inter"]);
  for (const name of presetNames()) {
    const bytes = fs.readFileSync(path.join(root, "fonts", "presets", `${name}.ttf`));
    const font = opentype.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    assert.ok(font.numGlyphs > 0, `${name} has no glyphs`);
    assert.equal(!!font.tables.fvar, variable.has(name), `${name} variable-table mismatch`);
  }
});

test("every new preset shapes through the Shape+ engine with the expected axes", async () => {
  const engine = await shapeEngine();
  const expected = {
    geist: { wght: [100, 400, 900] },
    "geist mono": { wght: [100, 400, 900] },
    "geist serif": { ELSH: [0, 0, 100] },
    inter: { opsz: [14, 14, 32], wght: [100, 400, 900] },
  };
  for (const name of presetNames()) {
    const font = openRepoFont(engine, name);
    try {
      const glyphs = font.shape(name, {});
      assert.ok(glyphs.length > 0, `${name} shapes to no glyphs`);
      assert.ok(glyphs.every(glyph => glyph.g !== 0), `${name} has missing glyphs`);
      const outline = font.outline(glyphs.find(glyph => glyph.g !== 0).g, {});
      assert.ok(outline.length > 0, `${name} has no outline`);
      const axes = font.axes;
      const wanted = expected[name] || {};
      assert.deepEqual(Object.keys(axes).sort(), Object.keys(wanted).sort(), `${name} axes mismatch`);
      for (const [tag, [min, fallback, max]] of Object.entries(wanted)) {
        assert.equal(axes[tag].min, min, `${name} ${tag} min`);
        assert.equal(axes[tag].default, fallback, `${name} ${tag} default`);
        assert.equal(axes[tag].max, max, `${name} ${tag} max`);
      }
      if (name.startsWith("geist pixel")) {
        assert.ok(!("ELSH" in axes), `${name} must be a static instance without an ELSH axis`);
      }
    } finally {
      font.dispose();
    }
  }
});

test("Resolve Fonts maps every new preset to its staged path", () => {
  const sandbox = { ZoidiumAssetRegistryParts: {} };
  vm.createContext(sandbox);
  vm.runInContext(
    fs.readFileSync(path.join(root, "plugins", "core", "asset-registry-replace.js"), "utf8"), sandbox);
  const { createReplacement } = sandbox.ZoidiumAssetRegistryParts;
  const full = ["bebas", ...presetNames()].sort();
  const { builtInFonts } = createReplacement({ PZ: { asset: { font: { preset: full } } } });
  const fonts = builtInFonts();
  for (const name of presetNames()) {
    const entry = fonts.find(font => font.name === name);
    assert.ok(entry, `Resolve Fonts lists no ${name}`);
    assert.equal(entry.key, `/assets/fonts/2d/${name}.ttf`);
  }
});

test("stage copies carry every new preset to the host font path", async () => {
  const { copyFontPresets } = require("../tools/runtime-resources-stage");
  const stage = await fs.promises.mkdtemp(path.join(os.tmpdir(), "zoidium-font-stage-"));
  try {
    await copyFontPresets(stage);
    for (const name of presetNames()) {
      const staged = await fs.promises.readFile(path.join(stage, "assets", "fonts", "2d", `${name}.ttf`));
      const checkedIn = await fs.promises.readFile(path.join(root, "fonts", "presets", `${name}.ttf`));
      assert.ok(staged.equals(checkedIn), `staged copy differs: ${name}`);
    }
  } finally {
    await fs.promises.rm(stage, { force: true, recursive: true });
  }
});

test("preset patch extends the host list in place before the dropdown builds", () => {
  const sandbox = { PZ: { asset: { font: { preset: ["vt323", "absender", "bebas"] } } } };
  vm.createContext(sandbox);
  const source = fs.readFileSync(path.join(root, "plugins", "core", "font-presets.js"), "utf8");
  const before = sandbox.PZ.asset.font.preset;
  vm.runInContext(source, sandbox);
  vm.runInContext(source, sandbox);
  const after = sandbox.PZ.asset.font.preset;
  assert.equal(after, before, "patch must mutate the preset array in place");
  assert.deepEqual(after, [...after].sort(), "patched preset order must be alphabetical");
  for (const name of presetNames()) {
    assert.ok(after.includes(name), `patched list misses ${name}`);
  }
  // The dropdown builds preset.length + 1 rows; the last row stays "custom".
  assert.equal(after.length, 3 + presetNames().length);
  assert.ok(!after.includes("custom"), "custom is a row, not a preset");
});

test("preset patch is registered as a pre-init core script", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "plugins", "core", "manifest.json"), "utf8"));
  assert.ok((manifest.coreScripts || []).some(script => script.source.includes("font-presets.js")),
    "core manifest must list the preset patch");
  const config = fs.readFileSync(path.join(root, "zoidium", "runtime-config.js"), "utf8");
  assert.ok(config.includes("./plugins/core/font-presets.js"), "runtime config must load the patch pre-init");
});

test("checked-in sprite has one row per new preset plus the host rows and custom", { skip: skipCache }, () => {
  const rows = spriteRows(readSprite());
  assert.equal(rows.length, hostNames().length + PRESET_FILES.length + 1);
});
