"use strict";

// The smaller plugin surfaces (Easing+ editor, Magic Looks setup, Color
// Curves editor, Player+ toolbar, Plugins sidebar page) must style their UI
// chrome with the --zui-* theme tokens from zoidium/ui-window.css instead of
// literal colors or fixed fonts, so they follow Settings (theme, hue,
// saturation, UI font). Data colors (curve channels, badges, thumbnails) may
// stay literal. Canvas widgets must resolve their chrome through
// getComputedStyle at draw time.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

require("./migrate-test-apis.js").ensureMainRealmApis();

const projectRoot = path.resolve(__dirname, "..");

function readFile(relative) {
  return fs.readFileSync(path.join(projectRoot, relative), "utf8");
}

// Literal UI chrome from the old CM3 imitation palette. None of these may
// appear in plugin UI chrome anymore (data colors are stripped first).
const FORBIDDEN_CHROME = [
  "#1b1b1b", "#202020", "#2a2a2a", "#242424",
  "#384668", "#7e8fb9", "#5a6c99",
  "#ccc", "#dadada", "#e4e4e4", "#e0e0e0", "#e2e2e2",
  "#9a9a9a", "#969696", "#8a8a8a", "#aaa", "#888",
  "#6d6d6d", "#7a7a7a", "#747474",
  "#d0d0d0", "#ddd", "#bbb", "#acacac",
  "#2e2e2e", "#383838", "#2c2c2c", "#303030", "#3d3d3d", "#4a4a4a", "#444",
  "#a5b4dc", "#a8b4d4", "#93a6d3", "#65769f", "#7182aa",
  "Source Code Pro",
  "--zoidium-font-family",
  "--zoidium-theme-",
];

function assertThemed(relative, allowed = [], { expectFont = true } = {}) {
  let source = readFile(relative);
  for (const keep of allowed) source = source.split(keep).join("");
  assert.ok(source.includes("var(--zui-"), relative + " uses theme tokens");
  if (expectFont) {
    assert.ok(source.includes("var(--zui-font)"), relative + " follows the editor UI font");
  } else {
    // Sidebar pages live in CM3's own DOM and inherit its font; they must
    // simply not pin a fixed one.
    assert.ok(!/font-family\s*:/.test(source), relative + " must not pin a font");
  }
  for (const literal of FORBIDDEN_CHROME) {
    assert.ok(!source.includes(literal), relative + " still uses literal " + literal);
  }
}

test("easing-plus stylesheet uses theme tokens", () => {
  // Only the curve shadow (a black drop shadow, like ui-window.css) stays.
  assertThemed("plugins/easing-plus/easing-plus.css", ["rgba(0, 0, 0, 0.7)"]);
});

test("magic looks setup stylesheet uses theme tokens", () => {
  assertThemed("plugins/magic-looks/looks-setup.css");
});

test("color curves stylesheet uses theme tokens except channel data colors", () => {
  // The R/G/B channel colors are data, not chrome.
  assertThemed("plugins/native-fx/colorcurves.css", ["#c46f6f", "#6fa47a", "#718fc4"]);
});

test("plugins sidebar page uses theme tokens except status colors", () => {
  // Warning and experimental badge tones are semantic status colors.
  assertThemed("plugins/plugin-manager.css", [
    "rgba(120, 34, 34, 0.18)", "#a94b4b", "#df9b9b",
    "rgba(197, 107, 61, 0.2)", "rgba(197, 107, 61, 0.6)", "#d8a583",
  ], { expectFont: false });
});

test("player-plus toolbar style uses theme tokens", () => {
  assertThemed("plugins/player-plus/player-plus.js");
});

test("looks canvas widgets resolve chrome through getComputedStyle at draw time", () => {
  const source = readFile("plugins/magic-looks/looks-widgets.js");
  assert.ok(source.includes("getComputedStyle"), "reads computed theme values");
  assert.ok(source.includes("--lk-"), "canvas chrome goes through widget theme vars");
  // No canvas paint assignment may use a literal chrome color: chrome comes
  // from the theme helpers, the rest is data (hue discs, tints, channels).
  for (const match of source.matchAll(/(?:fillStyle|strokeStyle)\s*=\s*("[^"]*"|'[^']*')/g)) {
    assert.ok(match[1].startsWith('"rgb("'), "literal canvas paint " + match[0]);
  }
});

function loadLooksWidgets() {
  const Looks = {};
  for (const file of ["looks-color.js", "looks-tools.js", "looks-widgets.js"]) {
    const source = readFile("plugins/magic-looks/" + file);
    new Function("Looks", source)(Looks);
  }
  return Looks;
}

function makeDomStubs(theme) {
  const recorded = { fill: [], stroke: [] };
  const gradient = { addColorStop() {} };
  const makeCtx = () => ({
    setTransform() {}, clearRect() {}, drawImage() {},
    beginPath() {}, arc() {}, closePath() {}, fill() {}, stroke() {},
    moveTo() {}, lineTo() {}, fillRect() {},
    createRadialGradient() { return gradient; },
    set fillStyle(value) { recorded.fill.push(value); },
    set strokeStyle(value) { recorded.stroke.push(value); },
  });
  const stubs = {};
  const doc = {
    defaultView: {
      getComputedStyle: () => ({
        getPropertyValue: (name) => theme[name] || "",
      }),
    },
    createElement(tag) {
      if (tag === "canvas") {
        return {
          ownerDocument: doc, style: {},
          getContext: () => makeCtx(),
          getBoundingClientRect: () => ({ left: 0, top: 0, width: 300, height: 200 }),
          addEventListener() {}, removeEventListener() {},
          setPointerCapture() {}, title: "", setAttribute() {},
        };
      }
      return {
        className: "", textContent: "", title: "", style: {},
        parentElement: null,
        appendChild() {}, addEventListener() {}, removeEventListener() {},
        setAttribute() {},
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 300, height: 200 }),
      };
    },
  };
  stubs.document = doc;
  stubs.recorded = recorded;
  stubs.container = { appendChild() {} };
  return stubs;
}

test("curves pad canvas follows the theme at draw time", () => {
  const { widgets: W } = loadLooksWidgets();
  const theme = {
    "--lk-pad-bg": "rgb(9, 9, 9)",
    "--lk-pad-grid": "rgb(10, 10, 10)",
    "--lk-pad-diagonal": "rgb(11, 11, 11)",
    "--lk-point-fill": "rgb(12, 12, 12)",
    "--zui-text": "rgb(13, 13, 13)",
  };
  const stubs = makeDomStubs(theme);
  const realDocument = globalThis.document;
  globalThis.document = stubs.document;
  try {
    const pad = new W.CurvesPad(stubs.container, {
      channels: { RGB: [{ x: 0, y: 0 }, { x: 1, y: 1 }] },
      channel: "RGB", width: 300, height: 200,
    });
    assert.ok(stubs.recorded.fill.includes("rgb(9, 9, 9)"), "pad background follows the theme");
    assert.ok(stubs.recorded.stroke.includes("rgb(10, 10, 10)"), "pad grid follows the theme");
    assert.ok(stubs.recorded.stroke.includes("rgb(11, 11, 11)"), "pad diagonal follows the theme");
    assert.ok(stubs.recorded.fill.includes("rgb(12, 12, 12)"), "pad points follow the theme");
    assert.ok(stubs.recorded.stroke.includes("rgb(13, 13, 13)"), "RGB curve follows the text token");
    pad.destroy();
  } finally {
    if (realDocument === undefined) delete globalThis.document;
    else globalThis.document = realDocument;
  }
});

test("color wheel tint dot follows the theme at draw time", () => {
  const { widgets: W } = loadLooksWidgets();
  const theme = { "--lk-dot-ring": "rgb(21, 21, 21)", "--lk-dot-core": "rgb(22, 22, 22)" };
  const stubs = makeDomStubs(theme);
  const realDocument = globalThis.document;
  globalThis.document = stubs.document;
  try {
    const wheel = new W.ColorWheel(stubs.container, {
      size: 120, initial: { angle: 0, radius: 0.5 },
    });
    assert.ok(stubs.recorded.stroke.includes("rgb(21, 21, 21)"), "dot ring follows the theme");
    assert.ok(stubs.recorded.fill.includes("rgb(22, 22, 22)"), "dot core follows the theme");
    wheel.destroy();
  } finally {
    if (realDocument === undefined) delete globalThis.document;
    else globalThis.document = realDocument;
  }
});

test("canvas widgets fall back to neutral defaults without a theme", () => {
  const { widgets: W } = loadLooksWidgets();
  const stubs = makeDomStubs({});
  stubs.document.defaultView = undefined;
  const realDocument = globalThis.document;
  globalThis.document = stubs.document;
  try {
    const pad = new W.CurvesPad(stubs.container, {
      channels: { Red: [{ x: 0, y: 0 }, { x: 1, y: 1 }] },
      channel: "Red", width: 300, height: 200,
    });
    assert.ok(stubs.recorded.fill.includes("#202020"), "pad background falls back");
    assert.ok(stubs.recorded.stroke.includes("#e05a5a"), "red channel data color stays");
    pad.destroy();
  } finally {
    if (realDocument === undefined) delete globalThis.document;
    else globalThis.document = realDocument;
  }
});
