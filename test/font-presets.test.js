"use strict";

// Built-in font presets: the preset list, the generated preview sprite, the
// host-side parsing of every new file, the host-safe outlines (host path
// equals the HarfBuzz reference and no contour self-overlaps), the variable
// files for Shape+, the Resolve Fonts mapping, the stage copies, and the
// pre-init preset patch. Tests that read the CM3 resource cache skip when it
// is absent (run pnpm run setup).

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

function openVariableFont(engine, name, file) {
  const bytes = fs.readFileSync(path.join(root, "fonts", "presets-variable", file));
  return engine.open(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), name);
}

// Outline comparison between the host parser and the HarfBuzz reference.
// Both sides are flattened to line polygons in 1000-em units (y up) so line,
// quadratic, and cubic segments compare uniformly. Zero-length segments are
// dropped: the host parser emits them for contours starting on an off-curve
// point and they carry no ink.
function flattenCommandsToPolygons(commands, yNegated, scale) {
  const polygons = [];
  let current = null, startX = 0, startY = 0, penX = 0, penY = 0;
  const lineTo = (x, y) => {
    if (Math.abs(x - penX) > 1e-9 || Math.abs(y - penY) > 1e-9) current.push([x, y]);
    penX = x; penY = y;
  };
  const point = (x, y) => yNegated ? [x * scale, -y * scale] : [x * scale, y * scale];
  const quad = (p0, p1, p2) => {
    for (let k = 1; k <= 16; k += 1) {
      const t = k / 16, u = 1 - t;
      lineTo(u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0],
        u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1]);
    }
  };
  const cubic = (p0, p1, p2, p3) => {
    for (let k = 1; k <= 24; k += 1) {
      const t = k / 24, u = 1 - t;
      lineTo(u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
        u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1]);
    }
  };
  for (const command of commands) {
    if (command.type === "M") {
      if (current) polygons.push(current);
      const [x, y] = command.values ? point(command.values[0], command.values[1]) : point(command.x, command.y);
      current = [[x, y]]; startX = x; startY = y; penX = x; penY = y;
    } else if (command.type === "Z") {
      if (current) { polygons.push(current); current = null; }
    } else if (!current) {
      continue;
    } else if (command.type === "L") {
      if (command.values) lineTo(...point(command.values[0], command.values[1]));
      else lineTo(...point(command.x, command.y));
    } else if (command.type === "Q") {
      if (command.values) {
        quad([penX, penY], point(command.values[0], command.values[1]),
          point(command.values[2], command.values[3]));
      } else {
        quad([penX, penY], point(command.x1, command.y1), point(command.x, command.y));
      }
    } else if (command.type === "C") {
      if (command.values) {
        cubic([penX, penY], point(command.values[0], command.values[1]),
          point(command.values[2], command.values[3]), point(command.values[4], command.values[5]));
      } else {
        cubic([penX, penY], point(command.x1, command.y1),
          point(command.x2, command.y2), point(command.x, command.y));
      }
    }
  }
  if (current) polygons.push(current);
  return polygons.filter(polygon => polygon.length > 2).map(polygon => {
    const first = polygon[0], last = polygon[polygon.length - 1];
    if (Math.abs(first[0] - last[0]) < 1e-9 && Math.abs(first[1] - last[1]) < 1e-9) return polygon.slice(0, -1);
    return polygon;
  }).filter(polygon => polygon.length > 2);
}

function polygonKey(polygon) {
  const rounded = polygon.map(([x, y]) => `${Math.round(x / 0.02)},${Math.round(y / 0.02)}`);
  const rotations = [];
  for (let s = 0; s < rounded.length; s += 1) rotations.push(rounded.slice(s).concat(rounded.slice(0, s)));
  const reversed = rounded.slice().reverse();
  for (let s = 0; s < reversed.length; s += 1) rotations.push(reversed.slice(s).concat(reversed.slice(0, s)));
  return rotations.map(points => points.join("|")).sort()[0];
}

function polygonsEqual(left, right) {
  if (left.length !== right.length) return false;
  const leftKeys = left.map(polygonKey).sort(), rightKeys = right.map(polygonKey).sort();
  return leftKeys.every((key, index) => key === rightKeys[index]);
}

// A self-intersecting contour fills wrongly under the host nonzero fill while
// the Shape+ sweep triangulates the union. Only crossings that span an area
// change the ink: contours touching at shared endpoints, and the tiny
// sub-pixel kinks some vendor outlines carry, are harmless. The quad spanned
// by the two crossing segments approximates the misfilled sliver; the 25
// square-unit threshold (0.01 px^2 at a 20 px em) separates the interpolation
// stitches of the variable fonts (thousands of square units) from the kinks.
function selfCrossArea(polygon) {
  const cross = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const eps = 1e-9;
  const same = (p, q) => Math.abs(p[0] - q[0]) < eps && Math.abs(p[1] - q[1]) < eps;
  const quad = (a, b, c, d) => Math.abs(a[0] * b[1] + b[0] * c[1] + c[0] * d[1] + d[0] * a[1]
    - b[0] * a[1] - c[0] * b[1] - d[0] * c[1] - a[0] * d[1]) / 2;
  let worst = 0;
  for (let i = 0; i < polygon.length; i += 1) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length];
    for (let j = i + 1; j < polygon.length; j += 1) {
      if (j === (i + 1) % polygon.length || i === (j + 1) % polygon.length) continue;
      const c = polygon[j], d = polygon[(j + 1) % polygon.length];
      if (same(a, c) || same(a, d) || same(b, c) || same(b, d)) continue;
      const abc = cross(a, b, c), abd = cross(a, b, d), cda = cross(c, d, a), cdb = cross(c, d, b);
      if (((abc > eps && abd < -eps) || (abc < -eps && abd > eps)) &&
        ((cda > eps && cdb < -eps) || (cda < -eps && cdb > eps))) {
        const area = quad(a, b, c, d);
        if (area > worst) worst = area;
      }
    }
  }
  return worst;
}

// Bounds of one sprite row path, flattening curves the same way.
function spriteRowBounds(d) {
  const tokens = d.match(/[MLCQZ][^MLCQZ]*/g) || [];
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  let penX = 0, penY = 0;
  const eat = (x, y) => {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  };
  const quad = (p0, p1, p2) => {
    for (let k = 1; k <= 16; k += 1) {
      const t = k / 16, u = 1 - t;
      eat(u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0],
        u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1]);
    }
  };
  const cubic = (p0, p1, p2, p3) => {
    for (let k = 1; k <= 24; k += 1) {
      const t = k / 24, u = 1 - t;
      eat(u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
        u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1]);
    }
  };
  for (const token of tokens) {
    const numbers = token.slice(1).trim().split(/\s+/).filter(part => part.length).map(Number);
    if (token[0] === "M") { penX = numbers[0]; penY = numbers[1]; eat(penX, penY); }
    else if (token[0] === "L") {
      for (let i = 0; i + 1 < numbers.length; i += 2) { penX = numbers[i]; penY = numbers[i + 1]; eat(penX, penY); }
    } else if (token[0] === "Q") {
      for (let i = 0; i + 3 < numbers.length; i += 4) {
        quad([penX, penY], [numbers[i], numbers[i + 1]], [numbers[i + 2], numbers[i + 3]]);
        penX = numbers[i + 2]; penY = numbers[i + 3];
      }
    } else if (token[0] === "C") {
      for (let i = 0; i + 5 < numbers.length; i += 6) {
        cubic([penX, penY], [numbers[i], numbers[i + 1]], [numbers[i + 2], numbers[i + 3]],
          [numbers[i + 4], numbers[i + 5]]);
        penX = numbers[i + 4]; penY = numbers[i + 5];
      }
    }
  }
  return { minX, maxX, minY, maxY };
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
  assert.equal(labels.get("geist serif square"), "Geist Serif Square");
  assert.equal(labels.get("geist serif triangle"), "Geist Serif Triangle");
  assert.equal(labels.get("geist serif heart"), "Geist Serif Heart");
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

test("every sprite row centres its ink vertically and stays inside the row", () => {
  const rows = spriteRows(readSprite());
  rows.forEach((row, index) => {
    const bounds = spriteRowBounds(row);
    assert.ok(isFinite(bounds.minX), `row ${index} renders no ink`);
    const top = index * previews.ROW_HEIGHT;
    const centre = (bounds.minY + bounds.maxY) / 2;
    assert.ok(Math.abs(centre - (top + previews.ROW_HEIGHT / 2)) <= 0.5,
      `row ${index} ink sits off-centre: ${centre.toFixed(2)} vs ${top + previews.ROW_HEIGHT / 2}`);
    assert.ok(bounds.minX >= -0.01 && bounds.maxX <= previews.ROW_WIDTH + 0.01,
      `row ${index} overflows horizontally`);
    assert.ok(bounds.minY >= top - 0.01 && bounds.maxY <= top + previews.ROW_HEIGHT + 0.01,
      `row ${index} overflows vertically`);
  });
});

test("empty optional fonts show None on the picker button", () => {
  function fakeSpan() {
    const classes = new Set();
    return {
      textContent: "",
      classList: {
        add: name => classes.add(name),
        remove: name => classes.delete(name),
        contains: name => classes.has(name),
      },
    };
  }
  function run(definitionValue, propertyValue) {
    const span = fakeSpan();
    let updateCalls = 0;
    const sandbox = {
      PZ: {
        ui: {
          controls: {
            generateFontInput() {
              const buttonDiv = { children: [{ children: [span] }] };
              buttonDiv.pz_update = () => {
                updateCalls += 1;
              };
              return [buttonDiv, { pz_update() {} }];
            },
          },
        },
      },
    };
    vm.createContext(sandbox);
    const source = fs.readFileSync(path.join(root, "plugins", "core", "font-empty-state.js"), "utf8");
    vm.runInContext(source, sandbox);
    const generate = sandbox.PZ.ui.controls.generateFontInput;
    const property = { definition: { value: definitionValue }, get: () => propertyValue };
    const [buttonDiv] = generate(property);
    buttonDiv.pz_update();
    vm.runInContext(source, sandbox);
    assert.equal(sandbox.PZ.ui.controls.generateFontInput, generate, "patch must install once");
    assert.equal(updateCalls, 1, "host update must run");
    return span;
  }
  const emptyOptional = run(null, null);
  assert.equal(emptyOptional.textContent, "None");
  assert.ok(emptyOptional.classList.contains("zoidium-font-none"));
  const fileSet = run(null, "abc123");
  assert.equal(fileSet.textContent, "");
  assert.ok(!fileSet.classList.contains("zoidium-font-none"));
  const presetSet = run(null, "/assets/fonts/2d/bebas.ttf");
  assert.equal(presetSet.textContent, "");
  assert.ok(!presetSet.classList.contains("zoidium-font-none"));
  const requiredEmpty = run("/assets/fonts/2d/bebas.ttf", null);
  assert.equal(requiredEmpty.textContent, "");
  assert.ok(!requiredEmpty.classList.contains("zoidium-font-none"));
  const functionDefault = run(() => null, null);
  assert.equal(functionDefault.textContent, "");
  assert.ok(!functionDefault.classList.contains("zoidium-font-none"));
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

test("preset list entries allow an optional variable file", () => {
  for (const entry of presetEntries()) {
    if (entry.variable === undefined) continue;
    assert.match(entry.variable, /^[a-z0-9][a-z0-9 ]*\.ttf$/, `invalid variable file for ${entry.name}`);
    assert.ok(fs.existsSync(path.join(root, "fonts", "presets-variable", entry.variable)),
      `missing variable file: ${entry.variable}`);
  }
  const withVariable = presetEntries().filter(entry => entry.variable !== undefined).map(entry => entry.name);
  assert.deepEqual(withVariable, ["geist", "geist mono", "geist serif", "inter"]);
});

test("every new preset is static and parses with the host opentype parser", { skip: skipCache }, () => {
  const { opentype } = nativeHost();
  assert.equal(typeof opentype.parse, "function", "host bundle must expose opentype.parse");
  for (const name of presetNames()) {
    const bytes = fs.readFileSync(path.join(root, "fonts", "presets", `${name}.ttf`));
    const font = opentype.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    assert.ok(font.numGlyphs > 0, `${name} has no glyphs`);
    assert.equal(!!font.tables.fvar, false, `${name} must be a host-safe static instance`);
  }
  for (const { name, variable } of presetEntries()) {
    if (variable === undefined) continue;
    const bytes = fs.readFileSync(path.join(root, "fonts", "presets-variable", variable));
    const font = opentype.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    assert.ok(font.tables.fvar, `${variable} must stay variable for Shape+`);
  }
});

test("variable files shape through the Shape+ engine with the expected axes", async () => {
  const engine = await shapeEngine();
  const expected = {
    geist: { wght: [100, 400, 900] },
    "geist mono": { wght: [100, 400, 900] },
    "geist serif": { ELSH: [0, 0, 100] },
    inter: { opsz: [14, 14, 32], wght: [100, 400, 900] },
  };
  for (const { name, variable } of presetEntries()) {
    if (variable === undefined) continue;
    const font = openVariableFont(engine, name, variable);
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
    } finally {
      font.dispose();
    }
  }
});

test("every new preset shapes through the Shape+ engine without axes", async () => {
  const engine = await shapeEngine();
  for (const name of presetNames()) {
    const font = openRepoFont(engine, name);
    try {
      const glyphs = font.shape(name, {});
      assert.ok(glyphs.length > 0, `${name} shapes to no glyphs`);
      assert.ok(glyphs.every(glyph => glyph.g !== 0), `${name} has missing glyphs`);
      assert.deepEqual(font.axes, {}, `${name} preset must be static`);
    } finally {
      font.dispose();
    }
  }
});

test("every preset glyph matches the reference outline and has no self-overlap", { skip: skipCache }, async () => {
  const { opentype } = nativeHost();
  const engine = await shapeEngine();
  for (const name of presetNames()) {
    const bytes = fs.readFileSync(path.join(root, "fonts", "presets", `${name}.ttf`));
    const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const hostFont = opentype.parse(ab.slice(0));
    const hbFont = engine.open(ab.slice(0), name);
    try {
      const scale = 1000 / hbFont.upem;
      const mismatched = [], overlapping = [];
      for (let gid = 0; gid < hostFont.numGlyphs; gid += 1) {
        const glyph = hostFont.glyphs.get(gid);
        const hostPolygons = flattenCommandsToPolygons(glyph.getPath(0, 0, 1000).commands, true, 1);
        const referencePolygons = flattenCommandsToPolygons(hbFont.outline(gid, {}), false, scale);
        if (!polygonsEqual(hostPolygons, referencePolygons)) mismatched.push(glyph.name || String(gid));
        if (hostPolygons.some(polygon => selfCrossArea(polygon) >= 25)) overlapping.push(glyph.name || String(gid));
      }
      assert.deepEqual(mismatched, [], `${name}: host path differs from the reference outline`);
      assert.deepEqual(overlapping, [], `${name}: self-overlapping contours render wrongly in the host`);
    } finally {
      hbFont.dispose();
    }
  }
});

test("static presets preserve the variable default metrics", async () => {
  const engine = await shapeEngine();
  const sample = new Set("custom");
  for (const { label } of presetEntries()) for (const ch of label) sample.add(ch);
  for (let code = 32; code < 127; code += 1) sample.add(String.fromCharCode(code));
  const chars = [...sample];
  // A few serif glyphs carry a vendor production difference of up to 15 units
  // in one bbox edge (union trim or redraw); advances still match.
  const knownBboxDiffs = new Set(["s", "8", "@", "d"]);
  function bounds(outline) {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const command of outline) {
      for (let i = 0; i + 1 < command.values.length; i += 2) {
        const x = command.values[i], y = command.values[i + 1];
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
    return [minX, minY, maxX, maxY];
  }
  for (const { name, variable } of presetEntries()) {
    if (variable === undefined) continue;
    const variableFont = openVariableFont(engine, name, variable);
    const staticFont = openRepoFont(engine, name);
    try {
      const bboxDiffs = [];
      for (const ch of chars) {
        const [shapedVariable] = variableFont.shape(ch, {});
        const [shapedStatic] = staticFont.shape(ch, {});
        if (!shapedVariable || !shapedStatic) continue;
        assert.equal(shapedStatic.ax, shapedVariable.ax, `${name} ${JSON.stringify(ch)} advance changed`);
        if (shapedVariable.g === 0 || shapedStatic.g === 0) continue;
        const variableBounds = bounds(variableFont.outline(shapedVariable.g, {}));
        const staticBounds = bounds(staticFont.outline(shapedStatic.g, {}));
        if (!isFinite(variableBounds[0]) || !isFinite(staticBounds[0])) continue;
        const same = variableBounds.every((value, index) => Math.abs(value - staticBounds[index]) <= 1);
        if (!same && !(name === "geist serif" && knownBboxDiffs.has(ch))) bboxDiffs.push(ch);
      }
      assert.deepEqual(bboxDiffs, [], `${name}: variable/static ink bounds differ`);
    } finally {
      variableFont.dispose();
      staticFont.dispose();
    }
  }
});

test("Shape+ variable map matches presets.json and the text service uses it", () => {
  const { VARIABLE_BY_PRESET, resolveVariableRef } = require("../plugins/shape-plus/preset-variables");
  const wanted = {};
  for (const { name, variable } of presetEntries()) {
    if (variable === undefined) continue;
    wanted[`/assets/fonts/2d/${name}.ttf`] = `/assets/fonts/2d-variable/${variable}`;
  }
  assert.deepEqual(VARIABLE_BY_PRESET, wanted);
  assert.equal(resolveVariableRef("/assets/fonts/2d/geist mono.ttf"), "/assets/fonts/2d-variable/geist mono.ttf");
  assert.equal(resolveVariableRef("/assets/fonts/2d/bebas.ttf"), "/assets/fonts/2d/bebas.ttf");
  assert.equal(resolveVariableRef(null), null);
  const service = fs.readFileSync(path.join(root, "plugins", "shape-plus", "text-service.js"), "utf8");
  assert.ok(service.includes("preset-variables"), "text service must load the variable map");
  const headers = fs.readFileSync(path.join(root, "_headers"), "utf8");
  assert.ok(headers.includes("/assets/fonts/2d-variable/*"), "variable fonts need a cache stanza");
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
    for (const { variable } of presetEntries()) {
      if (variable === undefined) continue;
      const staged = await fs.promises.readFile(path.join(stage, "assets", "fonts", "2d-variable", variable));
      const checkedIn = await fs.promises.readFile(path.join(root, "fonts", "presets-variable", variable));
      assert.ok(staged.equals(checkedIn), `staged variable copy differs: ${variable}`);
    }
  } finally {
    await fs.promises.rm(stage, { force: true, recursive: true });
  }
});

test("preset patch runs twice and on a replaced array with exactly one copy", () => {
  function run(preset) {
    const sandbox = { PZ: { asset: { font: { preset } } } };
    vm.createContext(sandbox);
    vm.runInContext(source, sandbox);
    return sandbox;
  }
  const source = fs.readFileSync(path.join(root, "plugins", "core", "font-presets.js"), "utf8");
  const before = ["vt323", "absender", "bebas"];
  const first = run(before);
  const patched = first.PZ.asset.font.preset;
  assert.equal(patched, before, "patch must mutate the preset array in place");
  run(patched);
  assert.deepEqual(patched, [...patched].sort(), "patched preset order must be alphabetical");
  // The dropdown builds preset.length + 1 rows; the last row stays "custom".
  assert.equal(patched.length, 3 + presetNames().length);
  assert.ok(!patched.includes("custom"), "custom is a row, not a preset");
  for (const name of presetNames()) {
    assert.equal(patched.filter(entry => entry === name).length, 1, `duplicate ${name} after re-run`);
  }
  assert.equal(patched.__zoidiumFontPresetsPatched, true, "marker lives on the list object");
  assert.ok(!("__zoidiumFontPresetsPatched" in first), "no global re-run flag is set");
  // A replaced array object is patched again instead of skipped.
  const replaced = run(["bebas", "absender", "vt323"]).PZ.asset.font.preset;
  assert.deepEqual([...replaced].sort(), [...patched].sort());
  for (const name of presetNames()) {
    assert.equal(replaced.filter(entry => entry === name).length, 1, `duplicate ${name} on replaced array`);
  }
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
