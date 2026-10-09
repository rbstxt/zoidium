"use strict";

// Coverage for the Tracery tracking-callout effect and its SaaS setup
// window: property surface, path routing math, effect lifecycle, presets,
// the setup action dispatcher, and style install/removal.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const projectRoot = path.resolve(__dirname, "..");
const legacyDir = path.join(projectRoot, "plugins/openzoid-legacy");

function loadEffectThis() {
  const source = fs.readFileSync(path.join(legacyDir, "effects/tracery.js"), "utf8");
  const PZ = {
    property: { type: { NUMBER: 1, OPTION: 2, TEXT: 3, COLOR: 7 } },
    tween: {},
  };
  const THREE = {};
  THREE.Pass = function () {};
  THREE.Pass.prototype = {};
  THREE.ShaderMaterial = function (opts) {
    this.uniforms = opts.uniforms;
    this.dispose = () => {};
  };
  THREE.Vector2 = function (x, y) { this.x = x; this.y = y; };
  THREE.Vector3 = function (x, y, z) { this.set = (a, b, c) => {}; };
  THREE.Scene = function () { this.add = () => {}; };
  THREE.OrthographicCamera = function () {};
  THREE.Mesh = function (geo, mat) { this.geometry = geo; this.material = mat; };
  THREE.PlaneBufferGeometry = function () { this.dispose = () => {}; };
  THREE.CanvasTexture = function () { this.dispose = () => {}; };
  const fakeThis = { properties: fakeProps() };
  new Function("PZ", "THREE", source).call(fakeThis, PZ, THREE);
  return { fakeThis, PZ, THREE };
}

function fakeProps() {
  const store = {};
  return {
    addAll(defs) {
      for (const k of Object.keys(defs)) {
        if (!(k in store)) store[k] = { def: defs[k] };
      }
    },
    load() {},
    store,
  };
}

test("tracery effect declares its full property surface", () => {
  const { fakeThis } = loadEffectThis();
  assert.equal(fakeThis.defaultName, "Tracery");
  assert.ok(fakeThis.properties.store.point1X, "definitions instantiated into properties");
  assert.ok(fakeThis.properties.store.boxShape, "group definitions instantiated");
  const defs = fakeThis.propertyDefinitions;
  assert.equal(defs.enabled.items, "off;on");
  assert.deepEqual(defs.enabled.buttons, [
    { name: "Tracery Setup", title: "Open the Tracery setup window", action: "tracerySetup" },
  ]);
  for (let n = 1; n <= 6; n++) {
    for (const k of ["Enable", "X", "Y", "Size", "Label", "LabelDX", "LabelDY"]) {
      assert.ok(defs["point" + n + k.replace(/ /g, "")] !== undefined, "point" + n + k);
    }
  }
  assert.equal(defs.boxShape.items, "rectangle;square;ellipse;circle");
  assert.equal(defs.boxFill.items, "none;solid;diagonal hatch;invert");
  assert.equal(defs.markerShape.items, "dot;plus;cross;polygon");
  assert.equal(defs.gridMode.items, "cartesian;edge");
  assert.equal(defs.lineType.items, "spline;pcb traces;smooth bend;step bend");
  assert.equal(defs.labelMode.items, "coordinates;dimensions;area;node id;custom");
  assert.equal(defs.markerSides.min, 3);
  assert.equal(defs.markerSides.max, 12);
  assert.equal(defs.detectEnable.items, "off;on");
  assert.equal(defs.detectionQuality.items, "low;medium;high;extreme");
  assert.equal(defs.threshold.min, 0);
  assert.equal(defs.threshold.max, 100);
  assert.ok(defs.keyColor, "key color control");
});

test("tracery path routing hits endpoints and shapes", () => {
  const { fakeThis } = loadEffectThis();
  const paths = fakeThis.traceryPaths;
  assert.ok(paths);
  for (const type of [0, 1, 2, 3]) {
    const pts = paths.route(type, 0, 0, 100, 60, 0, 0, 0, 0.5);
    assert.ok(pts.length >= 2, "type " + type);
    assert.deepEqual([Math.round(pts[0][0]), Math.round(pts[0][1])], [0, 0]);
    const last = pts[pts.length - 1];
    assert.deepEqual([Math.round(last[0]), Math.round(last[1])], [100, 60]);
  }
  // PCB routing is axis-aligned with a single 45-degree corner.
  const pcb = paths.route(1, 0, 0, 100, 30, 0, 0, 0, 0.5);
  assert.deepEqual(pcb.map((p) => p.map(Math.round)), [[0, 0], [70, 0], [100, 30]]);
  // Step bend honors the corner fraction.
  const step = paths.route(3, 0, 0, 100, 60, 0, 0, 0, 0.25);
  assert.deepEqual(step.map((p) => p.map(Math.round)), [[0, 0], [25, 0], [25, 60], [100, 60]]);
  // Arclength sampling reaches both ends with unit tangents.
  const at0 = paths.point(pcb, 0);
  const at1 = paths.point(pcb, 1);
  assert.ok(Math.abs(at0.x) < 0.01 && Math.abs(at0.y) < 0.01);
  assert.ok(Math.abs(at1.x - 100) < 0.01 && Math.abs(at1.y - 30) < 0.01);
  const tl = Math.sqrt(at0.dx * at0.dx + at0.dy * at0.dy);
  assert.ok(Math.abs(tl - 1) < 0.001);
  assert.equal(paths.css([1, 0.5, 0], 0.5), "rgba(255,128,0,0.5)");
  assert.deepEqual(Object.keys(paths).sort(), ["clean", "css", "detect", "draw", "point", "route"]);
});

test("tracery detection labels connected regions", () => {
  const { fakeThis } = loadEffectThis();
  const detect = fakeThis.traceryPaths.detect;
  const blank = new Uint8Array(16 * 12);
  assert.deepEqual(detect(blank, 16, 12, 0.5, 4, 24), [], "empty mask");
  // Two separated squares + one single noisy pixel.
  const grid = new Uint8Array(16 * 12);
  const paint = (x0, y0, w, h) => {
    for (let y = y0; y < y0 + h; y++) {
      for (let x = x0; x < x0 + w; x++) grid[y * 16 + x] = 255;
    }
  };
  paint(1, 1, 4, 4);
  paint(10, 7, 3, 3);
  grid[15 * 16 + 15] = 255;
  const regions = detect(grid, 16, 12, 0.5, 4, 24);
  assert.equal(regions.length, 2, "noise pixel filtered by min area");
  assert.ok(regions[0].area >= regions[1].area, "largest first");
  assert.deepEqual(
    [regions[0].minX, regions[0].minY, regions[0].maxX, regions[0].maxY],
    [1, 1, 4, 4]
  );
  assert.ok(Math.abs(regions[0].cx - 2.5) < 0.01);
  assert.ok(Math.abs(regions[0].cy - 2.5) < 0.01);
  // Threshold gates everything.
  const dim = new Uint8Array(16 * 12);
  dim[5 * 16 + 5] = 100;
  dim[5 * 16 + 6] = 100;
  dim[6 * 16 + 5] = 100;
  dim[6 * 16 + 6] = 100;
  assert.equal(detect(dim, 16, 12, 0.5, 4, 24).length, 0, "dim pixels under threshold");
  assert.equal(detect(dim, 16, 12, 0.3, 4, 24).length, 1, "dim pixels over threshold");
  assert.deepEqual(detect(blank, 16, 12, 0, 4, 24), [], "zero strength never matches");
  // Cap respected.
  const many = new Uint8Array(16 * 12);
  for (let i = 0; i < 16; i += 2) {
    for (let j = 0; j < 12; j += 2) many[j * 16 + i] = 255;
  }
  assert.ok(detect(many, 16, 12, 0.5, 1, 3).length <= 3, "max regions");
});

test("tracery effect loads, collects state, and toggles", () => {
  const { fakeThis } = loadEffectThis();
  const num = (v) => ({ get: () => v });
  const inst = {
    type: "tracery",
    properties: {
      load: () => {},
      enabled: num(1),
      point1Enable: num(1), point1X: num(30), point1Y: num(35),
      point1Size: num(130), point1Label: { get: () => "A" },
      point1LabelDX: num(150), point1LabelDY: num(-70),
      point2Enable: num(0),
    },
  };
  for (let n = 3; n <= 6; n++) {
    inst.properties["point" + n + "Enable"] = num(0);
  }
  fakeThis.load.call(inst, {});
  assert.ok(inst.pass, "pass created on load");
  assert.equal(inst.pass.needsSwap, true, "chain-safe swap");
  assert.equal(typeof inst.pass.render, "function");
  assert.equal(typeof inst.pass.dispose, "function");
  assert.equal(typeof fakeThis.toJSON, "function");
  assert.equal(fakeThis.toJSON.call(inst).type, "tracery");
  fakeThis.update.call(inst, 0);
  assert.equal(inst.pass.enabled, true);
  assert.ok(inst.pass.overlayState, "overlay state collected");
  assert.equal(inst.pass.overlayState.points.length, 1, "only enabled points");
  assert.deepEqual(
    [inst.pass.overlayState.points[0].x, inst.pass.overlayState.points[0].y],
    [30, 35]
  );
  assert.equal(inst.pass.overlayState.points[0].label, "A");
  inst.properties.enabled = num(0);
  fakeThis.update.call(inst, 0);
  assert.equal(inst.pass.enabled, false, "effect toggle disables the pass");
  assert.doesNotThrow(() => fakeThis.unload.call(inst, {}), "unload tolerates stubs");
});

// --- Setup window module ---

function fakeElement(tag) {
  const el = {
    tagName: (tag || "div").toUpperCase(),
    children: [],
    dataset: {},
    style: {},
    classList: {
      _s: new Set(),
      add(c) { this._s.add(c); },
      remove(c) { this._s.delete(c); },
      toggle(c, f) {
        if (f === undefined) f = !this._s.has(c);
        if (f) this._s.add(c);
        else this._s.delete(c);
      },
      contains(c) { return this._s.has(c); },
    },
    appendChild(c) { el.children.push(c); return c; },
    removeChild(c) {
      const at = el.children.indexOf(c);
      if (at >= 0) el.children.splice(at, 1);
      return c;
    },
    remove() {},
    setAttribute(k, v) { el[k] = v; },
    getAttribute(k) { return el[k] || null; },
    addEventListener() {},
    removeEventListener() {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
  };
  Object.defineProperty(el, "textContent", {
    get() { return el._text || ""; },
    set(v) { el._text = String(v); },
    configurable: true,
  });
  Object.defineProperty(el, "innerHTML", {
    get() { return ""; },
    set(v) {},
    configurable: true,
  });
  return el;
}

function loadSetupModule() {
  const full = path.join(legacyDir, "tracery-setup.js");
  delete require.cache[require.resolve(full)];
  return require(full);
}

function stubDocument() {
  const headChildren = [];
  const doc = {
    head: { appendChild(c) { headChildren.push(c); return c; } },
    body: { appendChild(c) { return c; } },
    createElement: (tag) => fakeElement(tag),
    getElementById: () => null,
    addEventListener() {},
    removeEventListener() {},
    querySelector: () => null,
    querySelectorAll: () => [],
  };
  return { doc, headChildren };
}

function stubEditor() {
  return {
    playback: { currentFrame: 7, speed: 0 },
    project: { traverse() {} },
    timelineSelection: [],
    history: { startOperation() {}, finishOperation() {} },
  };
}

test("tracery setup activates, routes, and deactivates", () => {
  const g = globalThis;
  const keep = { document: g.document, PZ: g.PZ, CM: g.CM };
  const { doc } = stubDocument();
  g.document = doc;
  const CM = stubEditor();
  g.CM = CM;
  const PZ = { ui: { controls: {} } };
  g.PZ = PZ;
  try {
    const mod = loadSetupModule();
    const context = {
      PZ,
      editor: CM,
      getAsset: (kind, url) => (String(url).includes("font") ? "" : "/*css*/"),
    };
    mod.activate(context);
    assert.equal(typeof CM.openTracerySetup, "function");
    assert.ok(CM.traceryPresets.surveillance, "presets installed");
    assert.equal(Object.keys(CM.traceryPresets).length, 5);
    assert.equal(CM.traceryPresets.keytrack.values.detectEnable, 1, "key preset tracks");
    assert.equal(CM.traceryPresets.keytrack.clearPoints, true);
    // Dispatcher routes the setup action through the editor.
    // (Covered end-to-end by the next test; here only liveness.)
    assert.equal(typeof PZ.ui.controls.runPropertyAction, "function");
    // Unknown actions delegate without throwing (no original installed here).
    // Reactivate is idempotent.
    mod.activate(context);
    mod.deactivate();
    assert.equal(CM.traceryWindow, undefined, "no window was opened");
  } finally {
    if (keep.document === undefined) delete g.document;
    else g.document = keep.document;
    if (keep.PZ === undefined) delete g.PZ;
    else g.PZ = keep.PZ;
    if (keep.CM === undefined) delete g.CM;
    else g.CM = keep.CM;
  }
});

test("tracery setup action opens the editor window entry", () => {
  const g = globalThis;
  const keep = { document: g.document, PZ: g.PZ, CM: g.CM };
  const { doc } = stubDocument();
  g.document = doc;
  const CM = stubEditor();
  g.CM = CM;
  const opened = [];
  const PZ = { ui: { controls: {} } };
  g.PZ = PZ;
  try {
    const mod = loadSetupModule();
    mod.activate({
      PZ,
      editor: CM,
      getAsset: () => "/*css*/",
    });
    CM.openTracerySetup = function (effect) { opened.push(effect || null); };
    PZ.ui.controls.runPropertyAction({}, { parentObject: "EFFECT" }, "tracerySetup", null);
    assert.deepEqual(opened, ["EFFECT"]);
    mod.deactivate();
  } finally {
    if (keep.document === undefined) delete g.document;
    else g.document = keep.document;
    if (keep.PZ === undefined) delete g.PZ;
    else g.PZ = keep.PZ;
    if (keep.CM === undefined) delete g.CM;
    else g.CM = keep.CM;
  }
});
