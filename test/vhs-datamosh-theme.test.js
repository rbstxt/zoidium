"use strict";

// Coverage for the SaaS theme of the VHS and Datamosh setup windows: the
// shared vhs-setup.css stylesheet styles every DOM class either setup
// assigns, carries the SaaS theme tokens, and both setup modules install
// the bundled Inter font on enable and release it on disable.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const projectRoot = path.resolve(__dirname, "..");

function readSource(file) {
  return fs.readFileSync(path.join(projectRoot, "plugins/openzoid-legacy", file), "utf8");
}

const SHARED_CLASSES = [
  "vhs-window", "vhs-titlebar", "vhs-title-left", "vhs-title", "vhs-subtitle",
  "vhs-live", "vhs-status", "vhs-status-text", "vhs-close", "vhs-body",
  "vhs-sidebar", "vhs-main", "vhs-screen", "vhs-screen-placeholder",
  "vhs-controls", "vhs-logo", "vhs-logo-cover",
  "vhs-section", "vhs-section-title", "vhs-section-sub", "vhs-presets",
  "vhs-preset", "vhs-list", "vhs-info-list", "vhs-item", "vhs-info",
  "vhs-info-wrap", "vhs-name", "vhs-hint", "vhs-group", "vhs-group-head",
  "vhs-group-title", "vhs-group-sub", "vhs-slider", "vhs-label-wrap",
  "vhs-value", "vhs-status-row", "vhs-dot", "vhs-buttons", "vhs-glitch-btn",
  "vhs-empty",
];

test("shared stylesheet styles every class the setups assign", () => {
  const css = readSource("vhs-setup.css");
  for (const cls of SHARED_CLASSES) {
    assert.ok(css.includes("." + cls), "missing style for " + cls);
  }
});

test("shared stylesheet uses the SaaS theme tokens", () => {
  const css = readSource("vhs-setup.css");
  assert.ok(css.includes("font-family: Inter"), "Inter type stack");
  assert.ok(css.includes("@keyframes vhsRise"), "rise-in motion");
  assert.ok(css.includes("@keyframes vhsFade"), "fade-in motion");
  assert.ok(css.includes("backdrop-filter"), "frosted titlebar");
  assert.ok(css.includes("#f7941d"), "orange brand accent kept");
  assert.ok(css.includes("prefers-reduced-motion"), "reduced-motion guard");
  assert.ok(!css.includes("Source Code Pro"), "no mono setup font");
});

test("both setups install and release the shared Inter font", () => {
  for (const file of ["vhs-setup.js", "datamosh-setup.js"]) {
    const source = readSource(file);
    assert.ok(source.includes("zoidium-vhs-font-style"), file + " font style id");
    assert.ok(source.includes("tracery-font.css"), file + " reuses the bundled font");
    assert.ok(source.includes("installFont(getAsset)"), file + " installs font");
    assert.ok(source.includes("uninstallFont()"), file + " releases font");
    assert.ok(source.includes("document.fonts.load"), file + " kicks font load");
  }
  assert.equal(
    JSON.parse(readSource("manifest.json")).version,
    "8"
  );
});

test("both setups use the new cover-banner logo art", () => {
  const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff]);
  for (const file of ["vhs-logo.jpg", "datamosh-logo.jpg"]) {
    const bytes = fs.readFileSync(path.join(projectRoot, "plugins/openzoid-legacy", file));
    assert.ok(bytes.subarray(0, 3).equals(JPEG_MAGIC), file + " is a JPEG");
    assert.ok(bytes.length > 50000, file + " is banner-sized, not a stub");
  }
  assert.ok(
    !fs.existsSync(path.join(projectRoot, "plugins/openzoid-legacy/datamosh-logo.svg")),
    "old SVG logo is gone"
  );
  const manifest = JSON.parse(readSource("manifest.json"));
  for (const id of ["vhs-logo", "datamosh-logo"]) {
    const entry = (manifest.resources || []).find((r) => r.id === id);
    assert.ok(entry, "manifest declares " + id);
    assert.equal(entry.type, "image", id + " is an image asset");
    assert.ok(entry.source.endsWith(".jpg?v=8"), id + " points at the new art");
  }
  const vhs = readSource("vhs-setup.js");
  assert.ok(vhs.includes("vhs-logo.jpg"), "vhs setup loads the new art");
  assert.ok(vhs.includes("vhs-logo-cover"), "vhs setup builds the cover banner");
  const datamosh = readSource("datamosh-setup.js");
  assert.ok(datamosh.includes("datamosh-logo.jpg"), "datamosh setup loads the new art");
  assert.ok(datamosh.includes("vhs-logo-cover"), "datamosh setup builds the cover banner");
  assert.ok(!datamosh.includes("datamosh-logo.svg"), "datamosh no longer references the SVG");
});
