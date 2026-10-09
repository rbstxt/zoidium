"use strict";

// Coverage for the SaaS theme shared by the Trapcode designer and the
// Optical Flares Options window: both evaluated sources still define their
// entry points, every DOM class the logic assigns is still styled, the
// suite accent colors and Inter type are present, and each pack bundles its
// own Inter @font-face plus a runtime installer for it.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const projectRoot = path.resolve(__dirname, "..");

function readSource(pack, file) {
  return fs.readFileSync(path.join(projectRoot, "plugins", pack, file), "utf8");
}

function loadDesigner() {
  const source = readSource("trapcode-suite", "designer.js");
  const PZ = { trapcode: {} };
  new Function("PZ", "THREE", source)(PZ, {});
  return { PZ, source };
}

function loadFlaresEditor() {
  const source = readSource("optical-flares", "optflares-editor.js");
  const PZ = { trapcode: {}, object3d: { optflares: { ELEMENT_TYPES: {} } } };
  new Function("PZ", "THREE", source)(PZ, {});
  return { PZ, source };
}

const DESIGNER_CLASSES = [
  "tc-designer", "tc-titlebar", "tc-title", "tc-body", "tc-presets",
  "tc-preset", "tc-palettes-title", "tc-palette", "tc-swatches", "tc-main",
  "tc-screen", "tc-placeholder", "tc-transport", "tc-time", "tc-strip",
  "tc-block", "tc-thumb", "tc-systems", "tc-system", "tc-params",
];

const FLARES_CLASSES = [
  "of-window", "of-titlebar", "of-menu", "of-dropdown", "of-title",
  "of-paneltoggles", "of-bigbtn", "of-body", "of-col", "of-col-left",
  "of-col-right", "of-panel", "of-panel-title", "of-preview", "of-screen",
  "of-guides", "of-preview-controls", "of-transport", "of-time", "of-stack",
  "of-stack-list", "of-row", "of-row-name", "of-row-actions", "of-mini",
  "of-color", "of-editor", "of-blocks", "of-block", "of-params",
  "of-browser", "of-browser-tabs", "of-browser-tab", "of-browser-sub",
  "of-browser-grid", "of-tile", "of-hint", "of-setup-overlay", "of-setup-bg",
  "of-setup-inner", "of-setup-card", "of-setup-btn", "of-setup-titles",
  "of-setup-h1", "of-setup-hint", "of-preset-select", "of-section-label",
];

test("trapcode designer still evaluates and exposes its entry points", () => {
  const { PZ } = loadDesigner();
  assert.equal(typeof PZ.trapcode.designer.open, "function");
  assert.equal(typeof PZ.trapcode.designer.openFirst, "function");
  assert.equal(typeof PZ.trapcode.designer.registerConfig, "function");
});

test("trapcode designer keeps every logic class styled", () => {
  const { source } = loadDesigner();
  for (const cls of DESIGNER_CLASSES) {
    assert.ok(source.includes("." + cls), "missing style for " + cls);
  }
});

test("trapcode designer uses the SaaS theme tokens", () => {
  const { source } = loadDesigner();
  assert.ok(source.includes("font-family:Inter"), "Inter type stack");
  assert.ok(source.includes("@keyframes tcRise"), "rise-in motion");
  assert.ok(source.includes("@keyframes tcFade"), "fade-in motion");
  assert.ok(source.includes("#c9a13b"), "gold suite accent");
  assert.ok(source.includes("backdrop-filter"), "frosted titlebar");
  assert.ok(source.includes("prefers-reduced-motion"), "reduced-motion guard");
  assert.ok(!source.includes("Source Code Pro"), "no mono designer font");
});

test("flares editor still evaluates and exposes its entry points", () => {
  const { PZ } = loadFlaresEditor();
  assert.equal(typeof PZ.opticalflares.openSetup, "function");
  assert.equal(typeof PZ.opticalflares.openEditor, "function");
  assert.equal(typeof PZ.opticalflares.open, "function");
});

test("flares editor keeps every logic class styled", () => {
  const { source } = loadFlaresEditor();
  for (const cls of FLARES_CLASSES) {
    assert.ok(source.includes("." + cls), "missing style for " + cls);
  }
  assert.ok(source.includes(".of-row.of-global"), "global row pinned style");
});

test("flares editor uses the SaaS theme tokens", () => {
  const { source } = loadFlaresEditor();
  assert.ok(source.includes("font-family:Inter"), "Inter type stack");
  assert.ok(source.includes("@keyframes ofRise"), "rise-in motion");
  assert.ok(source.includes("@keyframes ofFade"), "fade-in motion");
  assert.ok(source.includes("#4a90d9"), "blue flare accent");
  assert.ok(source.includes("backdrop-filter"), "frosted titlebar");
  assert.ok(source.includes("prefers-reduced-motion"), "reduced-motion guard");
  assert.ok(!source.includes("Source Code Pro"), "no mono editor font");
});

test("each pack bundles its own Inter font and declares it", () => {
  for (const pack of ["trapcode-suite", "optical-flares"]) {
    const css = readSource(pack, "inter-font.css");
    assert.ok(css.includes("@font-face"), pack + " font has a face");
    assert.ok(css.includes("Inter"), pack + " font is Inter");
    const manifest = JSON.parse(readSource(pack, "manifest.json"));
    const sources = (manifest.resources || []).map((r) => r.source);
    assert.ok(
      sources.some((s) => s.includes("inter-font.css")),
      pack + " manifest declares the font resource"
    );
  }
  assert.equal(
    JSON.parse(readSource("trapcode-suite", "manifest.json")).version,
    "7"
  );
  assert.equal(
    JSON.parse(readSource("optical-flares", "manifest.json")).version,
    "2"
  );
});

test("both runtimes install and remove the font style element", () => {
  const trapcode = readSource("trapcode-suite", "trapcode-runtime.js");
  assert.ok(trapcode.includes("zoidium-trapcode-font-style"), "trapcode style id");
  assert.ok(trapcode.includes("installFont(context)"), "trapcode installs font");
  assert.ok(trapcode.includes("uninstallFont()"), "trapcode removes font");
  const flares = readSource("optical-flares", "optical-flares-runtime.js");
  assert.ok(flares.includes("zoidium-flares-font-style"), "flares style id");
  assert.ok(flares.includes("installFont(context)"), "flares installs font");
  assert.ok(flares.includes("uninstallFont()"), "flares removes font");
});
