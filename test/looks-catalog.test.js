"use strict";

// Coverage for the Magic Looks catalog: pure color math, the 29-tool catalog
// and its schema, the default chain and chain parsing, look presets, the
// setup window surface (no fullscreen, no private theme), and manifest wiring.

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
  assert.ok(C.tintToDot(1, 1, 1).radius < 0.01, "white maps to the wheel center");
  const dot = C.tintToDot(1, 0.7, 0.6);
  const tint = C.wheelTint(dot.angle, dot.radius);
  assert.ok(Math.abs(tint[0] - 1) < 0.05 && Math.abs(tint[1] - 0.7) < 0.05, "tint round-trip");
  assert.equal(C.fmtNum(1, 1, { percent: true }), "100.0%");
  assert.equal(C.fmtNum(0.5, 2, { signed: true }), "+0.50");
  const mid = C.cubic({ x: 0, y: 0 }, { x: 0.3, y: 0.3 }, { x: 0.7, y: 0.7 }, { x: 1, y: 1 }, 0.5);
  assert.ok(Math.abs(mid.x - 0.5) < 0.01 && Math.abs(mid.y - 0.5) < 0.01, "symmetric cubic midpoint");
});

test("catalog holds all 29 reference tools in valid groups", () => {
  const { tools: T } = loadLooks();
  assert.equal(T.TOOLS.length, 29);
  assert.equal(new Set(T.TOOLS.map((t) => t.id)).size, 29, "tool ids are unique");
  assert.equal(new Set(T.TOOLS.map((t) => t.pfx)).size, 29, "property prefixes are unique");
  const groups = new Set(T.GROUPS.map((g) => g.id));
  const counts = { color: 0, light: 0, lens: 0 };
  for (const t of T.TOOLS) {
    assert.ok(groups.has(t.group), t.id + " has a valid group");
    counts[t.group]++;
  }
  assert.deepEqual(counts, { color: 16, light: 8, lens: 5 });
});

test("catalog removes controls the engine does not apply", () => {
  const { tools: T } = loadLooks();
  const keys = (id) => (T.byId(id).params || []).map((p) => p.key);
  assert.ok(!keys("mojo").includes("tint"), "Mojo II has no dead tint control");
  assert.ok(!keys("deflare").includes("size"), "Deflare has no dead size control");
  assert.ok(!keys("star-filter").includes("thresholdSoftness"), "Star Filter has no dead softness");
  assert.ok(!keys("anamorphic-flare").includes("thresholdSoftness"), "Anamorphic has no dead softness");
  assert.ok(!keys("color-ranges").includes("threshold"), "Color Ranges has no dead threshold");
  assert.ok(keys("star-filter").includes("angle"), "star angle is a regular param");
});

test("every param schema is well-formed with in-range defaults", () => {
  const { tools: T } = loadLooks();
  const customs = new Set(["hsl", "curves", "scurve", "fourway", "lut"]);
  for (const t of T.TOOLS) {
    const keys = new Set();
    for (const p of t.params || []) {
      assert.ok(["number", "toggle", "choice", "section"].includes(p.kind), t.id + " param kind");
      if (p.kind === "section") continue;
      assert.ok(p.key && !keys.has(p.key), t.id + " unique param key " + p.key);
      keys.add(p.key);
      if (p.kind === "number" && p.min !== undefined && p.max !== undefined) {
        assert.ok(p.def >= p.min && p.def <= p.max, t.id + "." + p.key + " default in range");
      }
      if (p.kind === "toggle") assert.ok(p.def === 0 || p.def === 1, t.id + " toggle default");
      if (p.kind === "choice") assert.ok(p.options.includes(p.def), t.id + " choice default listed");
    }
    const wheelKeys = new Set();
    const allWheels = (t.wheels || []).concat(...(t.extraWheels || []).map((g) => g.wheels || []));
    for (const w of allWheels) {
      assert.ok(w.key && !wheelKeys.has(w.key), t.id + " unique wheel key " + w.key);
      wheelKeys.add(w.key);
    }
    if (t.custom) assert.ok(customs.has(t.custom), t.id + " known custom widget");
  }
});

test("default state is neutral: every tool at identity, Color Contrast off", () => {
  const { tools: T } = loadLooks();
  const st = T.defaultState();
  assert.equal(st.v, 2);
  assert.equal(Object.keys(st.tools).length, 29);
  assert.equal(st.on["color-contrast"], 0, "Color Contrast ships off");
  for (const t of T.TOOLS) {
    if (t.id === "color-contrast") continue;
    assert.equal(st.on[t.id], 1, t.id + " starts enabled");
  }
  assert.deepEqual(st.tools["lift-gamma-gain"].w.gain.rgb, [1, 1, 1]);
  assert.equal(st.tools["lut"].x.lut.name, "None");
  assert.equal(st.tools["s-curve"].x.scurve.contrast, 1);
  assert.equal(st.tools["star-filter"].p.angle, 45);
  assert.deepEqual(Object.keys(st.tools["four-way"].w).sort(), ["global", "highlights", "midtones", "shadows"]);
  assert.equal(JSON.stringify(T.defaultState()), JSON.stringify(T.defaultState()), "defaults are JSON-stable");
});

test("default chain is the legacy pipeline and parses safely", () => {
  const { tools: T } = loadLooks();
  const chain = T.defaultChain();
  assert.equal(chain.length, 29);
  assert.equal(new Set(chain).size, 29, "every tool appears once");
  assert.equal(chain[0], "lens-distortion", "lens runs first");
  assert.ok(chain.indexOf("contrast") < chain.indexOf("color-contrast"), "legacy: contrast before color contrast");
  assert.ok(chain.indexOf("curves") < chain.indexOf("s-curve"), "legacy: curves before S curve");
  assert.ok(chain.indexOf("s-curve") < chain.indexOf("lut"), "legacy: S curve before LUT");
  assert.ok(chain.indexOf("telecine-net") === chain.length - 1, "legacy: telecine last");
  assert.deepEqual(T.parseChain(undefined), chain, "missing property falls back to the default");
  assert.deepEqual(T.parseChain("not json"), chain, "bad JSON falls back");
  assert.deepEqual(T.parseChain("{}"), chain, "non-array falls back");
  assert.deepEqual(T.parseChain(JSON.stringify(["lut", "bogus", "lut", "crush"])), ["lut", "crush"], "unknown and duplicate ids dropped");
  const roundTrip = T.parseChain(T.serializeChain(["crush", "lut"]));
  assert.deepEqual(roundTrip, ["crush", "lut"]);
});

test("look presets only name real tools, params and wheels", () => {
  const { tools: T } = loadLooks();
  const map = T.propMap();
  assert.ok(T.PRESETS.length >= 5, "several looks ship");
  const ids = T.PRESETS.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length, "preset ids are unique");
  for (const preset of T.PRESETS) {
    assert.ok(preset.name && preset.group, preset.id + " has a name and group");
    for (const toolId of Object.keys(preset.tools)) {
      const rec = map[toolId];
      assert.ok(rec, preset.id + " names a real tool " + toolId);
      for (const k of Object.keys(preset.tools[toolId].p || {})) {
        assert.ok(rec.params[k], preset.id + " names a real param " + toolId + "." + k);
      }
      for (const k of Object.keys(preset.tools[toolId].w || {})) {
        const ok = rec.wheels[k] || (rec.custom.fourway && rec.custom.fourway[k]);
        assert.ok(ok, preset.id + " names a real wheel " + toolId + "." + k);
      }
    }
  }
});

test("setup window is a floating window with no fullscreen, font or private theme", () => {
  const source = readPack("looks-setup.js");
  assert.ok(source.includes("context.ui") || source.includes("state.ui.openWindow"), "uses the shared window API");
  assert.ok(source.includes("openWindow"), "opens a floating window");
  assert.ok(source.includes("state.ui.controls") || source.includes("ui.controls"), "uses ZoidiumUI controls");
  assert.ok(!source.includes("inter-font"), "no Inter font");
  assert.ok(!source.includes("document.fonts"), "no font loading");
  assert.ok(!source.includes("mainViewport"), "no borrowed viewport");
  assert.ok(!source.includes("runPropertyAction"), "no global dispatcher patch");
  assert.ok(!/CM\.\w+\s*=/.test(source), "no editor globals assigned");
  assert.ok(!source.includes("magic-looks-look.json"), "no fullscreen export UI");
  const css = readPack("looks-setup.css");
  assert.ok(!css.includes("Inter"), "no Inter in styles");
  assert.ok(!css.includes("Georgia"), "no serif theme");
  assert.ok(!css.includes("@keyframes"), "no decorative motion");
});

test("setup module opens only from the effect's property button", () => {
  const source = readPack("looks-setup.js");
  assert.ok(source.includes("magicLooksSetup"), "reads the property button definition");
  const activate = source.slice(source.indexOf("activate(context)"), source.indexOf("deactivate()"));
  assert.ok(!activate.includes("openSetup("), "activation never opens a window");
});

test("widgets expose the custom canvas surface only", () => {
  const { widgets: W } = loadLooks();
  assert.equal(typeof W.ColorWheel, "function");
  assert.equal(typeof W.CurvesPad, "function");
  for (const name of ["HSLWheels", "SCurvePad", "WarmCoolPad", "AngleDial", "FourWay", "RangesGraph"]) {
    assert.equal(W[name], undefined, name + " is replaced by plain controls");
  }
});

test("manifest declares the pack and its bundled assets", () => {
  const manifest = JSON.parse(readPack("manifest.json"));
  assert.equal(manifest.id, "magic-looks");
  assert.equal(manifest.kind, "extension");
  assert.deepEqual(manifest.modules.map((m) => m.id), ["looks-setup"]);
  assert.deepEqual(manifest.nativeEffects.map((e) => e.id), ["looks"]);
  assert.equal(manifest.nativeEffects[0].name, "Magic Looks");
  const byId = {};
  for (const r of manifest.resources) byId[r.id] = r;
  for (const id of ["looks-color", "looks-tools", "looks-widgets", "looks-style", "looks-vert", "looks-grade-shader"]) {
    assert.ok(byId[id], "resource " + id);
    assert.ok(fs.existsSync(path.join(packDir, byId[id].source.split("?")[0].split("/").pop())), id + " file exists");
  }
  assert.ok(!manifest.resources.some((r) => /inter|tracery|logo/i.test(r.id)), "no removed theme assets");
  assert.ok(!fs.existsSync(path.join(packDir, "inter-font.css")), "Inter font file not copied");
});

test("setup stylesheet carries only the custom widget classes", () => {
  const css = readPack("looks-setup.css");
  for (const cls of ["lk-root", "lk-wheel", "lk-wheel-wrap", "lk-wheel-block", "lk-curves", "lk-curves-wrap", "lk-fourway", "lk-four-cell", "lk-tool-head"]) {
    assert.ok(css.includes("." + cls), "missing style for " + cls);
  }
});
