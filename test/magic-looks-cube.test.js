"use strict";

// 3D .cube LUT import for Magic Looks: the parser (valid files, domains,
// CRLF, row counts, NaN, 1D rejection), the atlas layout, trilinear sampling
// against an independent CPU reference, the project storage codec, the JS
// reference grade, and the effect's texture lifecycle.

require("./migrate-test-apis.js").ensureMainRealmApis();
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const projectRoot = path.resolve(__dirname, "..");
const packDir = path.join(projectRoot, "plugins/magic-looks");

function readPack(file) {
  return fs.readFileSync(path.join(packDir, file), "utf8");
}

function loadLooks() {
  const Looks = {};
  for (const file of ["looks-cube.js", "looks-color.js", "looks-tools.js"]) {
    new Function("Looks", readPack(file))(Looks);
  }
  return Looks;
}

// Builds .cube text for fn(r, g, b in 0..1) -> [r, g, b], red fastest.
function cubeText(size, fn, opts) {
  opts = opts || {};
  const eol = opts.eol || "\n";
  const rows = [];
  for (let b = 0; b < size; b++) {
    for (let g = 0; g < size; g++) {
      for (let r = 0; r < size; r++) {
        rows.push(fn(r / (size - 1), g / (size - 1), b / (size - 1)).join(" "));
      }
    }
  }
  const head = (opts.head || "") + "LUT_3D_SIZE " + size + eol;
  return head + rows.join(eol) + eol + (opts.tail || "");
}

const IDENTITY = (r, g, b) => [r, g, b];
const ROTATE = (r, g, b) => [g, b, r];
const fmt = (v) => Number(v).toFixed(6);

// Independent CPU reference: trilinear over the float grid in file order,
// with domain mapping. Written against the spec, not against looks-cube.js.
function refSample(grid, n, dmin, dmax, r, g, b) {
  const cl = (v) => Math.min(1, Math.max(0, v));
  const map = (v, lo, hi) => cl((v - lo) / (hi - lo)) * (n - 1);
  const x = map(r, dmin[0], dmax[0]);
  const y = map(g, dmin[1], dmax[1]);
  const z = map(b, dmin[2], dmax[2]);
  const x0 = Math.floor(x), y0 = Math.floor(y), z0 = Math.floor(z);
  const x1 = Math.min(x0 + 1, n - 1), y1 = Math.min(y0 + 1, n - 1), z1 = Math.min(z0 + 1, n - 1);
  const fx = x - x0, fy = y - y0, fz = z - z0;
  const at = (ri, gi, bi) => {
    const o = ((bi * n + gi) * n + ri) * 3;
    return [grid[o], grid[o + 1], grid[o + 2]];
  };
  const L = (a, bb, t) => a + (bb - a) * t;
  const out = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    const zA = L(L(at(x0, y0, z0)[i], at(x1, y0, z0)[i], fx), L(at(x0, y1, z0)[i], at(x1, y1, z0)[i], fx), fy);
    const zB = L(L(at(x0, y0, z1)[i], at(x1, y0, z1)[i], fx), L(at(x0, y1, z1)[i], at(x1, y1, z1)[i], fx), fy);
    out[i] = L(zA, zB, fz);
  }
  return out;
}

const PROBE_POINTS = [
  [-1, 2, 0.4], [0, 0, 0], [1, 1, 1], [0.5, 0.5, 0.5], [0.13, 0.29, 0.71],
  [0.77, 0.11, 0.43], [1, 0, 0.5], [0.02, 0.98, 0.33], [0.66, 0.34, 0.85],
];

test("parser accepts title, domain, comments, blanks and CRLF", () => {
  const Looks = loadLooks();
  const text = "TITLE \"Warm #1\"\r\n# a comment\r\n\r\nLUT_3D_SIZE 2\r\nDOMAIN_MIN 0.1\r\nDOMAIN_MAX 0.9 0.9 0.9\r\n" +
    cubeText(2, IDENTITY, { head: "", eol: "\r\n" }).split("\r\n").slice(1).join("\r\n");
  const p = Looks.cube.parseCubeLut(text);
  assert.equal(p.title, "Warm #1");
  assert.equal(p.size, 2);
  assert.ok(p.dmin.every(v => Math.abs(v - 0.1) < 1e-7));
  assert.ok(p.dmax.every(v => Math.abs(v - 0.9) < 1e-7));
  assert.equal(p.data.length, 8 * 3);
});

test("parser rejects 1D-only files with a clear message", () => {
  const Looks = loadLooks();
  assert.throws(() => Looks.cube.parseCubeLut("LUT_1D_SIZE 4\n0 0 0\n"), /1D LUT/);
  assert.throws(() => Looks.cube.parseCubeLut("LUT_1D_SIZE 4\n"), /1D LUT/);
  assert.throws(() => Looks.cube.parseCubeLut("# empty\n"), /LUT_3D_SIZE/);
});

test("parser validates the exact row count", () => {
  const Looks = loadLooks();
  const full = cubeText(3, IDENTITY);
  assert.equal(Looks.cube.parseCubeLut(full).data.length, 27 * 3);
  const short = full.split("\n").slice(0, -2).join("\n") + "\n";
  assert.throws(() => Looks.cube.parseCubeLut(short), /26 were found/);
  assert.throws(() => Looks.cube.parseCubeLut(full + "0 0 0\n"), /too many data rows/);
});

test("parser rejects NaN, infinite and out-of-range sizes", () => {
  const Looks = loadLooks();
  const badRow = (row, pattern) => {
    const lines = cubeText(2, IDENTITY).split("\n");
    lines[lines.length - 2] = row;
    assert.throws(() => Looks.cube.parseCubeLut(lines.join("\n")), pattern || /finite/);
  };
  badRow("NaN 0 0");
  badRow("0 Infinity 0");
  badRow("0 0 0 0", /exactly three numbers/);
  badRow("0 0", /exactly three numbers/);
  for (const size of ["1", "129", "0", "2.5", "x"]) {
    assert.throws(() => Looks.cube.parseCubeLut("LUT_3D_SIZE " + size + "\n"), /LUT_3D_SIZE/);
  }
  assert.throws(() => Looks.cube.parseCubeLut("TITLE bare\nLUT_3D_SIZE 2\n"), /TITLE/);
  assert.throws(() => Looks.cube.parseCubeLut("0 0 0\n"), /LUT_3D_SIZE header first/);
  assert.throws(() => Looks.cube.parseCubeLut("LUT_3D_SIZE 2\nDOMAIN_MIN 0.9\nDOMAIN_MAX 0.1\n" +
    cubeText(2, IDENTITY).split("\n").slice(1).join("\n")), /DOMAIN_MIN/);
});

test("parser accepts the maximum supported 128-cubed table", () => {
  const cube = loadLooks().cube;
  const parsed = cube.parseCubeLut("LUT_3D_SIZE 128\n" + "0 0 0\n".repeat(128 ** 3));
  assert.equal(parsed.size, 128);
  assert.equal(parsed.data.length, 128 ** 3 * 3);
  assert.equal(parsed.data.at(-1), 0);
});

test("atlas tiles slices red-fastest and preserves negative/HDR outputs", () => {
  const Looks = loadLooks();
  const a = Looks.cube.buildAtlas(Looks.cube.parseCubeLut(cubeText(2, (r, g, b) => [r * 2 - 0.5, g, b])));
  assert.deepEqual([a.width, a.height, a.cols, a.rows], [4, 2, 2, 1]);
  assert.deepEqual(Looks.cube.sampleAtlas(a, 1, 0, 0), [1.5, 0, 0]);
  assert.deepEqual(Looks.cube.sampleAtlas(a, 0, 0, 0), [-0.5, 0, 0]);
  assert.deepEqual(Looks.cube.sampleAtlas(a, 0, 1, 1), [-0.5, 1, 1]);
  assert.deepEqual(Looks.cube.sampleAtlas(a, 0.5, 0.5, 0.5), [0.5, 0.5, 0.5]);
});

test("trilinear sampling matches the independent CPU reference", () => {
  const Looks = loadLooks();
  const cases = [
    { size: 4, fn: IDENTITY, dmin: [0, 0, 0], dmax: [1, 1, 1] },
    { size: 4, fn: ROTATE, dmin: [0, 0, 0], dmax: [1, 1, 1] },
    { size: 17, fn: (r, g, b) => [r * r, Math.sqrt(g), 1 - b], dmin: [0, 0, 0], dmax: [1, 1, 1] },
    { size: 5, fn: IDENTITY, dmin: [0.1, 0.1, 0.1], dmax: [0.9, 0.9, 0.9] },
    { size: 5, fn: ROTATE, dmin: [-0.1, 0.2, -2], dmax: [1.3, 0.9, 2] },
    { size: 4, fn: (r, g, b) => [2 * r - 0.5, 3 * g, -b], dmin: [0, 0, 0], dmax: [1, 1, 1] },
  ];
  for (const { size, fn, dmin, dmax } of cases) {
    const head = "LUT_3D_SIZE " + size + "\nDOMAIN_MIN " + dmin.join(" ") + "\nDOMAIN_MAX " + dmax.join(" ") + "\n";
    const p = Looks.cube.parseCubeLut(head + cubeText(size, (r, g, b) => fn(r, g, b).map(fmt)).split("\n").slice(1).join("\n"));
    const a = Looks.cube.buildAtlas(p);
    for (const [r, g, b] of PROBE_POINTS) {
      const got = Looks.cube.sampleAtlas(a, r, g, b);
      const want = refSample(p.data, size, p.dmin, p.dmax, r, g, b);
      for (let i = 0; i < 3; i++) {
        assert.ok(Math.abs(got[i] - want[i]) <= 2e-7, `size ${size} point ${r},${g},${b} ch ${i}: ${got[i]} vs ${want[i]}`);
      }
    }
  }
});

test("identity LUT samples within 1/255 of the input", () => {
  const Looks = loadLooks();
  const a = Looks.cube.buildAtlas(Looks.cube.parseCubeLut(cubeText(33, IDENTITY)));
  for (const [r, g, b] of PROBE_POINTS) {
    const got = Looks.cube.sampleAtlas(a, r, g, b);
    assert.ok(Math.abs(got[0] - Math.min(1, Math.max(0, r))) <= 1 / 255 + 1e-9, `red ${got[0]} vs ${r}`);
    assert.ok(Math.abs(got[1] - Math.min(1, Math.max(0, g))) <= 1 / 255 + 1e-9, `green ${got[1]} vs ${g}`);
    assert.ok(Math.abs(got[2] - Math.min(1, Math.max(0, b))) <= 1 / 255 + 1e-9, `blue ${got[2]} vs ${b}`);
  }
});

test("parser rejects malformed headers, overflow, duplicate domains and mixed 1D/3D files", () => {
  const cube = loadLooks().cube;
  const rows = cubeText(2, IDENTITY).split("\n").slice(1).join("\n");
  assert.throws(() => cube.parseCubeLut("LUT_3D_SIZE 2\nLUT_1D_SIZE 2\n" + rows), /1D/);
  assert.throws(() => cube.parseCubeLut("LUT_3D_SIZE 2\nDOMAIN_MIN 0\nDOMAIN_MIN 0\n" + rows), /duplicate DOMAIN_MIN/);
  assert.throws(() => cube.parseCubeLut("LUT_3D_SIZE 2\n1e100 0 0\n"), /GPU float range/);
  assert.throws(() => cube.parseCubeLut("LUT_3D_SIZE 2\nUNKNOWN 1 2\n"), /finite numbers/);
  assert.throws(() => cube.parseCubeLut(" ".repeat(cube.MAX_TEXT_LENGTH + 1)), /larger than 80 MB/);
  assert.equal(cube.parseCubeLut('TITLE "A # B" # comment\nLUT_3D_SIZE 2\n' + rows).title, "A # B");
  assert.deepEqual(cube.layoutFor(128), { cols: 12, rows: 11, width: 1536, height: 1408 });
});

function enOnly(Looks, ids) {
  const en = {};
  for (const k of Object.keys(Looks.tools.defaultState().tools)) en[k] = ids.includes(k) ? 1 : 0;
  return en;
}

function px(Looks, c, T, en) {
  const luts = Looks.grade.buildFrameLuts(T);
  return Looks.grade.gradePixel(c, [0.5, 0.5], T, en, () => c, [16, 16], luts);
}

test("reference grade: Custom LUT grades, mixes and wraps gamma like presets", () => {
  const Looks = loadLooks();
  const S = Looks.tools.defaultState();
  const atlas = Looks.cube.buildAtlas(Looks.cube.parseCubeLut(cubeText(9, ROTATE)));
  S.tools.lut.x.lut.name = "Custom";
  S.tools.lut.x.lut.data = atlas;
  const en = enOnly(Looks, ["lut"]);
  const got = px(Looks, [0.2, 0.5, 0.8], S.tools, en);
  const want = Looks.cube.sampleAtlas(atlas, 0.2, 0.5, 0.8);
  assert.ok(got.every((v, i) => Math.abs(v - want[i]) < 1e-9), "Custom matches the sampler");
  S.tools.lut.x.lut.strength = 0.5;
  const half = px(Looks, [0.2, 0.5, 0.8], S.tools, en);
  assert.ok(half.every((v, i) => Math.abs(v - (0.5 * [0.2, 0.5, 0.8][i] + 0.5 * want[i])) < 1e-9), "Strength mixes halfway");
  S.tools.lut.x.lut.strength = 1;
  S.tools.lut.x.lut.gamma = "Input";
  const gin = px(Looks, [0.2, 0.5, 0.8], S.tools, en);
  const lin = [0.2, 0.5, 0.8].map((v) => Math.pow(Math.max(v, 1e-6), 2.2));
  const win = Looks.cube.sampleAtlas(atlas, lin[0], lin[1], lin[2]);
  assert.ok(gin.every((v, i) => Math.abs(v - win[i]) < 1e-9), "Input gamma runs before the table");
  S.tools.lut.x.lut.gamma = "Output";
  const gout = px(Looks, [0.2, 0.5, 0.8], S.tools, en);
  assert.ok(gout.every((v, i) => Math.abs(v - Math.pow(Math.max(want[i], 1e-6), 1 / 2.2)) < 1e-9));
  S.tools.lut.x.lut.data = null;
  assert.deepEqual(px(Looks, [0.2, 0.5, 0.8], S.tools, en), [0.2, 0.5, 0.8], "missing data bypasses");
  S.tools.lut.x.lut.name = "Hot";
  const hot = px(Looks, [0.5, 0.5, 0.5], S.tools, en);
  assert.ok(hot[0] > hot[2] + 0.05, "Hot preset unchanged");
});

// ---------- effect surface ----------

function loadEffect() {
  const source = readPack("looks-fx.js");
  const PZ = { asset: { type: { MISC: 5 } }, property: { type: { NUMBER: 0, OPTION: 6, TEXT: 7, ASSET: 8 } } };
  const created = [];
  const THREE = {
    Vector2: function (x, y) { this.x = x; this.y = y; this.set = (a, b) => { this.x = a; this.y = b; }; },
    Vector3: function (x, y, z) {
      this.x = x; this.y = y; this.z = z;
      this.set = (a, b, c) => { this.x = a; this.y = b; this.z = c; };
    },
    ShaderMaterial: function (opts) { this.uniforms = opts.uniforms; this.dispose = () => {}; },
    ShaderPass: function (mat) { this.uniforms = mat.uniforms; this.enabled = true; this.material = mat; },
    DataTexture: function (data, w, h) {
      this.data = data; this.width = w; this.height = h;
      this.disposed = false;
      this.dispose = () => { this.disposed = true; };
      created.push(this);
    },
    RGBFormat: 1, RGBAFormat: 2, LinearFilter: 1, NearestFilter: 2, ClampToEdgeWrapping: 1,
  };
  const store = {};
  const assets = new Map();
  let nextKey = 0;
  const projectAssets = {
    async createFromFile(_type, file) {
      const asset = { key: "asset-" + (++nextKey), file, references: 0 };
      assets.set(asset.key, asset);
      return asset;
    },
    load(key) { const asset = assets.get(key); if (asset) asset.references++; return asset; },
    unload(asset) { asset.references--; if (!asset.references) assets.delete(asset.key); },
  };
  function FakeProp(def) {
    this.def = def;
    this.v = def.value;
  }
  FakeProp.prototype.get = function () { return this.v; };
  FakeProp.prototype.set = function (v) { this.v = v; };
  const fakeThis = {
    _zoidiumGetAsset: (kind, url) => readPack(String(url).split("/").pop().split("?")[0]),
    parentProject: { assets: projectAssets },
    properties: {
      addAll(defs) {
        for (const k of Object.keys(defs)) {
          if (!(k in store)) {
            store[k] = new FakeProp(defs[k]);
            this[k] = store[k];
          }
        }
      },
      load() {},
      store,
    },
  };
  new Function("PZ", "THREE", source).call(fakeThis, PZ, THREE);
  return { fakeThis, store, created, assets };
}

test("effect stores a static project asset key and keeps preset defaults", () => {
  const { fakeThis } = loadEffect();
  const defs = fakeThis.propertyDefinitions;
  assert.equal(defs.lutData.type, 8);
  assert.equal(defs.lutData.assetType, 5);
  assert.equal(defs.lutData.dynamic, undefined);
  assert.equal(defs.lutData.visible, false);
  assert.equal(defs.lutData.value, null);
  assert.equal(defs.lutName.value, "None");
});

async function importTable(effect, store, size, fn) {
  const file = new Blob([cubeText(size, fn)]);
  const key = await effect._looksLutAssets.importFile(file);
  store.lutData.v = key;
  store.lutName.v = "Custom";
  await effect.prepare();
  effect.update({});
  return key;
}

test("effect uploads WebGL1 byte atlases once and disposes them on change/unload", async () => {
  const { fakeThis: effect, store, created, assets } = loadEffect();
  await effect.load({});
  const key = await importTable(effect, store, 5, ROTATE);
  const u = effect.pass.uniforms;
  assert.equal(u.u_lutMode.value, 4);
  assert.equal(created.length, 5);
  const first = [u.u_lutAtlasR.value, u.u_lutAtlasG.value, u.u_lutAtlasB.value];
  assert.deepEqual([first[0].width, first[0].height], [15, 10]);
  effect.update({});
  assert.equal(created.length, 5, "unchanged file does not re-upload");
  store.lutName.v = "Hot";
  effect.update({});
  assert.ok(first.every(tex => tex.disposed), "preset selection releases imported textures");
  assert.equal(u.u_lutMode.value, 1);
  store.lutName.v = "Custom";
  await effect.prepare();
  effect.update({});
  assert.equal(u.u_lutMode.value, 4);
  await importTable(effect, store, 4, IDENTITY);
  assert.ok(first.every(tex => tex.disposed));
  store.lutData.v = null;
  await effect.prepare();
  effect.update({});
  assert.equal(u.u_lutMode.value, 0);
  assert.equal(u.u_lutAtlasR.value, null);
  assert.equal(effect.pass.enabled, false);
  assert.equal(assets.get(key).references, 1, "file retained for native undo");
  store.lutData.v = key;
  await effect.prepare();
  effect.update({});
  assert.equal(u.u_lutMode.value, 4, "restoring a property key restores its LUT");
  effect.unload();
  assert.equal(effect.pass, null);
  assert.ok(created.every(tex => tex.disposed));
  assert.equal(assets.size, 0, "all file references released");
});

test("prepare awaits saved project files, missing files bypass, invalid imports preserve the current LUT", async () => {
  const { fakeThis: effect, store, assets } = loadEffect();
  await effect.load({});
  const key = await importTable(effect, store, 3, ROTATE);
  await assert.rejects(effect._looksLutAssets.importFile(new Blob(["LUT_1D_SIZE 2\n"])), /1D/);
  assert.equal(store.lutData.v, key);
  let finish;
  assets.set("saved", { key: "saved", references: 0, file: { size: 50, text: () => new Promise(resolve => { finish = resolve; }) } });
  store.lutData.v = "saved";
  const pending = effect.prepare();
  await Promise.resolve();
  finish(cubeText(2, IDENTITY));
  await pending;
  effect.update({});
  assert.equal(effect.pass.uniforms.u_lutConfig.value.x, 2);
  store.lutData.v = "missing";
  await effect.prepare();
  effect.update({});
  assert.equal(effect.pass.uniforms.u_lutMode.value, 0);
  assert.match(effect._looksCubeError, /missing from the project/);
  effect.unload();
});


test("animated LUT selection uses the requested frame during prepare and update", async () => {
  const { fakeThis: effect, store } = loadEffect();
  await effect.load({});
  await importTable(effect, store, 3, ROTATE);
  store.lutName.get = frame => frame === 10 ? "Custom" : "None";
  await effect.prepare(10);
  effect.update(10);
  assert.equal(effect.pass.uniforms.u_lutMode.value, 4);
  await effect.prepare(0);
  effect.update(0);
  assert.equal(effect.pass.uniforms.u_lutMode.value, 0);
  assert.equal(effect.pass.uniforms.u_lutAtlasR.value, null);
  await effect.prepare(10);
  effect.update(10);
  assert.equal(effect.pass.uniforms.u_lutMode.value, 4);
});
