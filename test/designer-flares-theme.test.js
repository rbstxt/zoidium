"use strict";

// The Optical Flares options window uses the shared floating window kit and the
// CM3 panel look. It must not ship a private theme, a fullscreen overlay, the
// Inter font or a borrowed preview viewport.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const projectRoot = path.resolve(__dirname, "..");
const flaresDir = path.join(projectRoot, "plugins", "optical-flares");

function read(file) {
  return fs.readFileSync(path.join(flaresDir, file), "utf8");
}

const FLARE_SOURCES = ["optflares-math.js", "optflares.js", "optflares-window.js", "optical-flares-runtime.js"];

test("the window is built from the shared controls and window kit", () => {
  const source = read("optflares-window.js");
  assert.ok(source.includes("ui.openWindow("), "opens through context.ui");
  assert.ok(source.includes("ui.controls") || source.includes("controls"), "uses ZoidiumUI controls");
  assert.ok(source.includes('persistKey: "options"'), "remembers window position");
  assert.ok(source.includes("isValid:"), "closes when the flare is removed");
});

test("the window ships no private theme, overlay, font or borrowed viewport", () => {
  const forbidden = [
    "font-family",
    "Inter",
    "position:fixed",
    "position: fixed",
    "backdrop-filter",
    "@keyframes",
    "setup-overlay",
    "fullscreen",
    "acquirePreview",
    "mainViewport",
    "_designerPreview",
    "PZ.trapcode",
    "ZoidiumI18n",
  ];
  for (const file of FLARE_SOURCES) {
    const source = read(file);
    for (const token of forbidden) {
      assert.ok(!source.includes(token), file + " must not contain " + token);
    }
  }
});

test("the runtime installs no font and the manifest declares none", () => {
  const runtime = read("optical-flares-runtime.js");
  assert.ok(!runtime.includes("FONT"), "no font installer");
  assert.ok(!runtime.includes("document.head"), "no injected style element");
  const manifest = JSON.parse(read("manifest.json"));
  const sources = (manifest.resources || []).map((resource) => resource.source);
  assert.ok(!sources.some((source) => source.includes("inter-font")), "no Inter resource");
  assert.ok(!sources.some((source) => source.includes("editor")), "no editor resource");
  assert.ok(!sources.some((source) => source.includes("trapcode-common")), "no copied Trapcode helpers");
});

test("the window sources use English-only text", () => {
  for (const file of FLARE_SOURCES) {
    const source = read(file);
    // Comments and labels are English; no non-ASCII letters anywhere in the sources.
    assert.ok(!/[^\x00-\x7F]/.test(source), file + " is ASCII only");
  }
});
