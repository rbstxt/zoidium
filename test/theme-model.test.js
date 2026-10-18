"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const model = require("../zoidium/theme-model.js");
function theme() { return { id: "user:test", name: "Example", main: "#384668", overrides: {}, clips: { "cm3:7": "#ffffff" } }; }
test("Classic main color reproduces all five original colors exactly", () => {
  assert.deepEqual(model.derive("#384668"), Object.fromEntries(Object.entries(model.PALETTE).map(([k, v]) => [k, "#" + v.toString(16)])));
});
test("built-in palettes retain the historical hue and saturation transform", () => {
  const expected = {
    panzoid: ["#384668", "#7e8fb9", "#526183", "#7f94c7", "#273465"],
    signal: ["#385468", "#7ea1b9", "#527083", "#7faac7", "#274765"],
    ember: ["#684538", "#b98e7e", "#835f52", "#c7937f", "#653d27"],
    moss: ["#683868", "#b97eb8", "#835283", "#c77fc6", "#65275f"],
    rose: ["#386850", "#7eb99c", "#52836a", "#7fc7a4", "#27654c"],
    gray: ["#505050", "#9c9c9c", "#6a6a6a", "#a3a3a3", "#464646"],
  };
  // Compare to the original algorithm as well as fixed palette snapshots.
  for (const preset of model.PRESETS.filter((p) => p.value !== "custom")) {
    const palette = model.presetPalette(preset.value);
    for (const key of Object.keys(model.PALETTE)) {
      const original = model.shiftThemeColor(model.PALETTE[key], preset.value === "gray" ? 0 : preset.hue, preset.value === "gray" ? 0 : 1);
      assert.equal(palette[key], "#" + original.toString(16).padStart(6, "0"));
    }
    assert.deepEqual(Object.values(palette), expected[preset.value]);
    const copy = model.copyPalette(palette);
    assert.deepEqual(model.derive(copy.main, copy.overrides), palette, "duplicates preserve every channel");
  }
  assert.deepEqual(model.presetPalette("custom", 0, 100), model.presetPalette("panzoid"));
  assert.deepEqual(model.presetPalette("custom", 0, 0), model.presetPalette("gray"));
});
test("derived overrides and extreme main colors are valid", () => {
  for (const main of ["#000000", "#ffffff", "#ff0000", "#010101"]) {
    for (const value of Object.values(model.derive(main))) assert.match(value, /^#[0-9a-f]{6}$/);
  }
  assert.equal(model.derive("#384668", { link: "#123456" }).link, "#123456");
});
test("storage accepts versioned records and rejects corrupt, foreign and duplicate records", () => {
  assert.deepEqual(model.parseStorage(JSON.stringify({ version: 1, themes: [theme()] })), [theme()]);
  for (const value of [null, "{", "[]", '{"version":2,"themes":[]}', JSON.stringify({ version: 1, themes: [theme(), theme()] }),
    JSON.stringify({ version: 1, themes: [{ ...theme(), main: "red" }] })]) assert.deepEqual(model.parseStorage(value), []);
  const malicious = JSON.parse('{"__proto__":"#ffffff"}');
  assert.equal(model.validateTheme({ ...theme(), overrides: malicious }), null);
  assert.equal(model.validateTheme({ ...theme(), clips: { constructor: "#ffffff" } }), null);
});
test("single-theme import validates version, colors, keys and sizes; export round trips", () => {
  const text = JSON.stringify({ version: 1, theme: theme() });
  assert.deepEqual(model.parseImport(text), theme());
  for (const text of ["{", "{}", JSON.stringify({ version: 2, theme: theme() }), JSON.stringify({ version: 1, theme: { ...theme(), overrides: { clip: "#fff" } } }), " ".repeat(262145)]) {
    assert.throws(() => model.parseImport(text));
  }
  assert.equal(model.uniqueName("Example", [theme(), { name: "Example (2)" }]), "Example (3)");
});
test("type keys distinguish audio from numeric layers and normalize plugin legacy aliases", () => {
  assert.equal(model.typeKey(7), "cm3:7");
  assert.equal(model.typeKey(4), "cm3:4");
  assert.equal(model.typeKey(0), "cm3:0");
  assert.equal(model.typeKey(undefined, true), "audio");
  assert.equal(model.typeKey("zoidium:camera-plus/camera-layer"), "zoidium:camera-plus/camera-layer");
  assert.equal(model.typeKey(12, false, { 12: "zoidium:precomp-plus/precomp-layer" }), "zoidium:precomp-plus/precomp-layer");
  assert.equal(model.typeKey("__proto__"), null);
  assert.equal(model.typeKey(-1), null);
});
test("selected custom clips lighten and label contrast follows the actual background", () => {
  assert.ok(model.hsl(model.selectedClip("#123456"))[2] > model.hsl("#123456")[2]);
  assert.equal(model.labelColor("#000000"), "#f4f4f4");
  assert.equal(model.labelColor("#ffffff"), "#2c323f");
});

test("all built-in themes retain dark chrome and light custom themes use contrasting neutrals", () => {
  for (const preset of model.PRESETS) {
    const tokens = model.uiTokens(model.presetPalette(preset.value, 0, 100));
    assert.equal(tokens.bg, "#2a2a2a");
    assert.equal(tokens.danger, "#df9b9b");
    assert.equal(tokens.shadow, "#000000");
  }
  const light = model.uiTokens(model.derive("#cad9f4"));
  assert.equal(light.bg, "#f1f1f1");
  assert.ok(model.hsl(light.text)[2] < model.hsl(light.bg)[2]);
  assert.ok(model.hsl(light.value)[2] < 0.4);
  assert.equal(light.danger, "#9b3030");
  const darkKeys = Object.keys(model.uiTokens(model.derive("#384668"))).sort();
  assert.deepEqual(Object.keys(light).sort(), darkKeys);
});
