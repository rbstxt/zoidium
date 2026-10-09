"use strict";

// Coverage for the Magic Looks setup pack: pure color math, the 29-tool
// catalog integrity (ids, groups, schema ranges, wheel keys), widget and
// module surface, theme tokens, and manifest wiring.

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
  for (const file of ["looks-color.js", "looks-tools.js", "looks-widgets.js"]) {
    new Function("Looks", readPack(file))(Looks);
  }
  return Looks;
}

test("color math round-trips and matches the wheel contract", () => {
  const { color: C } = loadLooks();
  for (const h of [0, 30, 120, 210, 300]) {
    const rgb = C.hsvToRgb(h, 0.7, 0.9);
    const back = C.rgbToHsv(rgb[0], rgb[1], rgb[2]);
    assert.ok(Math.abs(back.h - h) < 1, "hue round-trip at " + h);
    assert.ok(Math.abs(back.s - 0.7) < 0.01, "sat round-trip");
    assert.ok(Math.abs(back.v - 0.9) < 0.01, "val round-trip");
  }
  assert.deepEqual(C.wheelTint(0, 0).map((v) => Math.round(v * 1000) / 1000), [1, 1, 1]);
  const center = C.tintToDot(1, 1, 1);
  assert.ok(center.radius < 0.01, "white maps to the wheel center");
  const dot = C.tintToDot(1, 0.7, 0.6);
  const tint = C.wheelTint(dot.angle, dot.radius);
  assert.ok(Math.abs(tint[0] - 1) < 0.05 && Math.abs(tint[1] - 0.7) < 0.05, "tint round-trip");
  assert.equal(C.fmtNum(1, 1, { percent: true, fraction: true }), "100.0%");
  assert.equal(C.fmtNum(-0.325, 3, { signed: true }), "-0.325");
  assert.equal(C.fmtNum(0.5, 2, { signed: true }), "+0.50");
  assert.equal(C.parseNum("85.0%", { percent: true, fraction: true }), 0.85);
  assert.equal(C.parseNum("+0.50", { signed: true }), 0.5);
  assert.equal(C.parseNum("abc", {}), null);
  assert.ok(C.gauss(0.5, 0.5, 0.2) > C.gauss(0.1, 0.5, 0.2), "gauss peaks at mu");
  const mid = C.cubic({ x: 0, y: 0 }, { x: 0.3, y: 0.3 }, { x: 0.7, y: 0.7 }, { x: 1, y: 1 }, 0.5);
  assert.ok(Math.abs(mid.x - 0.5) < 0.01 && Math.abs(mid.y - 0.5) < 0.01, "symmetric cubic midpoint");
});

test("catalog holds all 29 reference tools in valid groups", () => {
  const { tools: T } = loadLooks();
  assert.equal(T.TOOLS.length, 29);
  const ids = T.TOOLS.map((t) => t.id);
  assert.equal(new Set(ids).size, 29, "tool ids are unique");
  const groups = new Set(T.GROUPS.map((g) => g.id));
  assert.deepEqual([...groups].sort(), ["color", "lens", "light"]);
  const counts = { color: 0, light: 0, lens: 0 };
  for (const t of T.TOOLS) {
    assert.ok(groups.has(t.group), t.id + " has a valid group");
    assert.ok(t.name && t.name.length > 1, t.id + " has a name");
    counts[t.group]++;
  }
  assert.deepEqual(counts, { color: 16, light: 8, lens: 5 });
  for (const name of ["Color Contrast", "HSL Colors", "Mojo II", "4-Way Color", "S Curve", "LUT", "Anamorphic Flare", "Telecine Net"]) {
    assert.ok(T.TOOLS.some((t) => t.name === name), "catalog has " + name);
  }
});

test("every param schema is well-formed with in-range defaults", () => {
  const { tools: T } = loadLooks();
  const customs = new Set(["hsl", "curves", "scurve", "fourway", "warmcool", "angledial", "lut"]);
  for (const t of T.TOOLS) {
    const keys = new Set();
    for (const p of t.params || []) {
      assert.ok(["number", "toggle", "choice", "section"].includes(p.kind), t.id + " param kind");
      if (p.kind === "section") continue;
      assert.ok(p.key && !keys.has(p.key), t.id + " unique param key " + p.key);
      keys.add(p.key);
      if (p.kind === "number") {
        if (p.min !== undefined && p.max !== undefined) {
          assert.ok(p.min <= p.max, t.id + "." + p.key + " range");
          assert.ok(p.def >= p.min && p.def <= p.max, t.id + "." + p.key + " default in range");
        }
        assert.ok(Number.isInteger(p.decimals) && p.decimals >= 0, t.id + "." + p.key + " decimals");
      }
      if (p.kind === "toggle") assert.ok(p.def === 0 || p.def === 1, t.id + " toggle default");
      if (p.kind === "choice") assert.ok(p.options.includes(p.def), t.id + " choice default listed");
    }
    const wheelKeys = new Set();
    const allWheels = (t.wheels || []).concat(...(t.extraWheels || []).map((g) => g.wheels || []));
    for (const w of allWheels) {
      assert.ok(w.key && !wheelKeys.has(w.key), t.id + " unique wheel key " + w.key);
      wheelKeys.add(w.key);
      assert.equal(w.rgb.length, 3, t.id + " wheel rgb triple");
    }
    if (t.custom) assert.ok(customs.has(t.custom), t.id + " known custom widget");
  }
});

test("default state covers every tool and resets cleanly", () => {
  const { tools: T, color: C } = loadLooks();
  const st = T.defaultState();
  assert.equal(st.v, 1);
  assert.equal(Object.keys(st.tools).length, 29);
  const lgg = st.tools["lift-gamma-gain"];
  assert.deepEqual(Object.keys(lgg.w).sort(), ["gain", "gamma", "lift"]);
  assert.deepEqual(lgg.w.gain.rgb, [1, 1, 1], "identity defaults keep the effect neutral");
  const hsl = st.tools["hsl-colors"].x.hsl;
  assert.equal(hsl.length, 8, "eight HSL anchors");
  assert.ok(hsl.every((h) => h.sat === 0 && h.light === 0), "HSL defaults neutral");
  assert.equal(st.tools["s-curve"].x.scurve.contrast, 1);
  assert.equal(st.tools["lut"].x.lut.name, "None");
  assert.equal(st.tools["star-filter"].x.angle, 45);
  assert.equal(st.enabled, 1, "chain bypass defaults to engaged");
  assert.equal(Object.keys(st.on).length, 29, "every tool has an enable flag");
  assert.ok(Object.values(st.on).every((v) => v === 1), "all tools start enabled");
  // Fresh defaults are JSON-stable (tweak detection relies on it).
  assert.equal(JSON.stringify(T.defaultState()), JSON.stringify(T.defaultState()));
  void C;
});

test("widgets expose the DOM-free component surface", () => {
  const { widgets: W } = loadLooks();
  for (const name of ["ColorWheel", "HSLWheels", "CurvesPad", "SCurvePad", "WarmCoolPad", "AngleDial", "RangesGraph"]) {
    assert.equal(typeof W[name], "function", name + " is defined");
  }
});

test("setup module exposes activate/deactivate and references its assets", () => {
  const mod = require(path.join(packDir, "looks-setup.js"));
  assert.equal(typeof mod.activate, "function");
  assert.equal(typeof mod.deactivate, "function");
  const source = readPack("looks-setup.js");
  assert.ok(source.includes("looks-setup.css"), "loads its stylesheet");
  assert.ok(source.includes("inter-font.css"), "loads Inter");
  assert.ok(source.includes("CM.openMagicLooks"), "reopen hook");
  assert.ok(source.includes("magic-looks-look.json"), "export filename");
});

test("setup stylesheet carries the SaaS theme and every widget class", () => {  const css = readPack("looks-setup.css");
  assert.ok(css.includes("font-family:Inter"), "Inter type stack");
  assert.ok(css.includes("@keyframes lkRise"), "rise-in motion");
  assert.ok(css.includes("@keyframes lkPop"), "pop-in motion");
  assert.ok(css.includes("backdrop-filter"), "frosted header");
  assert.ok(css.includes("Georgia"), "serif tool titles like the reference");
  assert.ok(!css.includes("Source Code Pro"), "no mono setup font");
  for (const cls of [
    "lk-window", "lk-header", "lk-head-title", "lk-head-select", "lk-head-btn",
    "lk-close", "lk-body", "lk-side", "lk-search", "lk-group-name", "lk-tool",
    "lk-tool-dot", "lk-tool-tweaked", "lk-panel", "lk-panel-inner", "lk-toolhead",
    "lk-tool-title", "lk-reset", "lk-preset-row", "lk-select", "lk-prow",
    "lk-plabel", "lk-pval", "lk-toggle", "lk-section", "lk-wheelrow",
    "lk-wheel-wrap", "lk-wheel", "lk-rgb", "lk-hsl-table", "lk-curves-bar",
    "lk-curves-ch", "lk-curves", "lk-curves-read", "lk-scurve", "lk-pad",
    "lk-dial-wrap", "lk-dial", "lk-dial-read", "lk-ranges", "lk-fourway",
    "lk-four-col", "lk-lut-row", "lk-lut-name", "lk-lut-x", "lk-foot",
  ]) {
    assert.ok(css.includes("." + cls), "missing style for " + cls);
  }
});

test("manifest declares the pack and its bundled assets", () => {
  const manifest = JSON.parse(readPack("manifest.json"));
  assert.equal(manifest.id, "magic-looks");
  assert.equal(manifest.version, "2");
  assert.equal(manifest.kind, "extension");
  assert.deepEqual(manifest.modules.map((m) => m.id), ["looks-setup"]);
  assert.deepEqual(manifest.nativeEffects.map((e) => e.id), ["looks"]);
  assert.equal(manifest.nativeEffects[0].name, "Magic Looks");
  const byId = {};
  for (const r of manifest.resources) byId[r.id] = r;
  for (const id of ["looks-color", "looks-tools", "looks-widgets", "looks-style", "looks-inter-font", "looks-vert", "looks-grade-shader"]) {
    assert.ok(byId[id], "resource " + id);
    assert.ok(fs.existsSync(path.join(packDir, byId[id].source.split("?")[0].split("/").pop())), id + " file exists");
  }
  const fontCss = readPack("inter-font.css");
  assert.ok(fontCss.includes("@font-face") && fontCss.includes("Inter"), "bundled Inter face");
});

test("every tool carries a chain thumbnail spec with a known kind", () => {
  const { tools: T, widgets: W } = loadLooks();
  assert.equal(typeof W.paintChainThumb, "function", "thumb painter exists");
  const kinds = new Set([
    "input", "wheel", "dots3", "letter", "radial", "hsplit", "thirds",
    "splitdisc", "bars3", "smini", "diagonal", "contrast", "sbezier", "cube",
    "grad2d", "diamond", "dot", "softdot", "star", "hstreak", "circle",
    "grid", "rgblines",
  ]);
  for (const t of T.TOOLS) {
    assert.ok(t.thumb && kinds.has(t.thumb.kind), t.id + " has a known thumb kind");
    if (t.thumb.kind === "letter") {
      assert.ok(t.thumb.text && t.thumb.text.length === 1, t.id + " letter thumb has one glyph");
    }
  }
});

test("chain strip builders and styles are wired", () => {
  const source = readPack("looks-setup.js");
  for (const fn of ["buildChain", "refreshChain", "selectTool", "syncToolEnable", "syncChainBypass", "paintChainThumb"]) {
    assert.ok(source.includes(fn), "setup references " + fn);
  }
  assert.ok(source.includes("Output - Rec.709"), "input slot labels the output space");
  const css = readPack("looks-setup.css");
  for (const cls of [
    "lk-chain", "lk-chain-looks", "lk-chain-tools", "lk-slot", "lk-slot-input",
    "lk-slot-add", "lk-thumbbox", "lk-badge", "lk-slot-name", "lk-slot-sub",
    "lk-add-plus", "lk-sep",
  ]) {
    assert.ok(css.includes("." + cls), "missing style for " + cls);
  }
});
