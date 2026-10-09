"use strict";

// Coverage for the Tracery tracking-callout effect: property surface, path
// routing math, region detection, lifecycle, and deterministic rendering. The
// setup window is covered by openzoid-legacy-windows.test.js.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const projectRoot = path.resolve(__dirname, "..");
const legacyDir = path.join(projectRoot, "plugins/openzoid-legacy");
const source = fs.readFileSync(path.join(legacyDir, "effects/tracery.js"), "utf8");

function loadEffectThis() {
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
  THREE.Vector3 = function () { this.set = () => {}; };
  THREE.Scene = function () { this.add = () => {}; };
  THREE.OrthographicCamera = function () {};
  THREE.Mesh = function (geo, mat) { this.geometry = geo; this.material = mat; };
  THREE.PlaneBufferGeometry = function () { this.dispose = () => {}; };
  THREE.CanvasTexture = function () { this.dispose = () => {}; };
  THREE.WebGLRenderTarget = function () { this.dispose = () => {}; };
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

function constantProps(defs, overrides) {
  const props = { load() {} };
  for (const key of Object.keys(defs)) {
    const def = defs[key];
    let value = def.value;
    if (def.group) value = def.objects.map((o) => o.value);
    if (overrides && key in overrides) value = overrides[key];
    props[key] = { get: () => value };
  }
  return props;
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
      assert.ok(defs["point" + n + k] !== undefined, "point" + n + k);
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
  assert.deepEqual(Object.keys(paths).sort(), ["clean", "css", "detect", "draw", "point", "region", "route"]);
  for (const type of [0, 1, 2, 3]) {
    const pts = paths.route(type, 0, 0, 100, 60, 0, 0, 0, 0.5);
    assert.ok(pts.length >= 2, "type " + type);
    assert.deepEqual([Math.round(pts[0][0]), Math.round(pts[0][1])], [0, 0]);
    const last = pts[pts.length - 1];
    assert.deepEqual([Math.round(last[0]), Math.round(last[1])], [100, 60]);
  }
  // PCB traces: a straight run, one 45-degree corner, then a straight run.
  const pcb = paths.route(1, 0, 0, 100, 30, 0, 0, 0, 0.5);
  assert.equal(pcb.length, 3);
  assert.deepEqual(pcb[1], [70, 0]);
  // Arclength sampling reaches both ends with unit tangents.
  const at0 = paths.point(pcb, 0);
  const at1 = paths.point(pcb, 1);
  assert.ok(Math.abs(at0.x) < 0.01 && Math.abs(at0.y) < 0.01);
  assert.ok(Math.abs(at1.x - 100) < 0.01 && Math.abs(at1.y - 30) < 0.01);
  const tl = Math.sqrt(at0.dx * at0.dx + at0.dy * at0.dy);
  assert.ok(Math.abs(tl - 1) < 0.001);
  assert.equal(paths.css([1, 0.5, 0], 0.5), "rgba(255,128,0,0.5)");
});

test("tracery layer region follows the compositor uv scale and layer resolution", () => {
  const { fakeThis } = loadEffectThis();
  const region = fakeThis.traceryPaths.region;
  // Layer occupies a third of the screen buffer; its own resolution wins when known.
  assert.deepEqual(region(1095, 616, { x: 1 / 3, y: 1 / 3 }, [640, 360]), { width: 640, height: 360, sx: 1 / 3, sy: 1 / 3 });
  assert.deepEqual(region(1095, 616, { x: 1 / 3, y: 1 / 3 }, null), { width: 365, height: 205, sx: 1 / 3, sy: 1 / 3 }, "buffer fallback");
  assert.deepEqual(region(64, 36, { x: 1, y: 1 }, null), { width: 64, height: 36, sx: 1, sy: 1 });
  assert.deepEqual(region(64, 36, null, undefined), { width: 64, height: 36, sx: 1, sy: 1 }, "no uniform");
  assert.equal(region(64, 36, { x: 3, y: 0 }, null).sx, 1, "scale never exceeds the buffer");
});

test("tracery overlay samples its canvas over the layer frame and detection through the layer region", () => {
  assert.ok(source.includes("texture2D(tOverlay, vUv)"), "overlay covers exactly the layer frame");
  assert.ok(source.includes("texture2D(tDiffuse, (vUv + vec2(fi, fj) * texel) * uvScale)"), "detection reads the layer region");
  assert.ok(source.includes("canvasTexture.minFilter = THREE.LinearFilter"), "no power-of-two resampling of the overlay");
  assert.ok(source.includes("canvasTexture.generateMipmaps = false"));
});

test("a new Tracery effect starts with Point 1 on at the frame centre", () => {
  const { fakeThis } = loadEffectThis();
  const defs = fakeThis.propertyDefinitions;
  assert.equal(defs.point1Enable.value, 1, "point 1 default on");
  assert.equal(defs.point1X.value, 50);
  assert.equal(defs.point1Y.value, 50);
  for (let n = 2; n <= 6; n++) assert.equal(defs["point" + n + "Enable"].value, 0, "point " + n + " default off");
  assert.equal(defs.detectEnable.value, 1, "detection defaults unchanged");
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

test("tracery effect loads, collects state, and toggles", async () => {
  const { fakeThis } = loadEffectThis();
  const defs = fakeThis.propertyDefinitions;
  const inst = {
    type: "tracery",
    properties: constantProps(defs, {
      point1Enable: 1, point1X: 30, point1Y: 35, point1Label: "A",
      point1Size: 130, point1LabelDX: 150, point1LabelDY: -70,
    }),
  };
  await fakeThis.load.call(inst, {});
  assert.ok(inst.pass, "pass created on load");
  assert.equal(inst.pass.needsSwap, true, "chain-safe swap");
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
  inst.properties.enabled = { get: () => 0 };
  fakeThis.update.call(inst, 0);
  assert.equal(inst.pass.enabled, false, "effect toggle disables the pass");
  assert.doesNotThrow(() => fakeThis.unload.call(inst, {}), "unload tolerates stubs");
  assert.equal(inst.pass, null);
});

test("tracery source has no nondeterministic inputs and no Inter font", () => {
  assert.ok(!/Math\.random|Date\.now|performance\.now/.test(source));
  assert.ok(!/requestAnimationFrame/.test(source));
  assert.ok(!source.includes("Inter"), "label font is Source Code Pro");
  assert.ok(source.includes("'Source Code Pro', monospace"));
});

test("tracery overlay redraws only when its state changes, unless detection follows the footage", async () => {
  const { fakeThis } = loadEffectThis();
  const inst = {
    type: "tracery",
    properties: constantProps(fakeThis.propertyDefinitions, {
      point1Enable: 1, point1X: 40, point1Y: 40, detectEnable: 0,
    }),
  };
  await fakeThis.load.call(inst, {});
  const calls = { draws: 0 };
  const previousDocument = globalThis.document;
  globalThis.document = {
    createElement: () => ({
      width: 0,
      height: 0,
      getContext: () => new Proxy({}, {
        get: (target, prop) => (prop === "measureText"
          ? () => ({ width: 10 })
          : () => { calls.draws++; }),
        set: () => true,
      }),
    }),
  };
  try {
    const pass = inst.pass;
    const renderer = { autoClear: true, render() {}, readRenderTargetPixels() {} };
    const readBuffer = { width: 64, height: 36, texture: {} };
    fakeThis.update.call(inst, 0);
    pass.render(renderer, readBuffer, readBuffer);
    const afterFirst = calls.draws;
    assert.ok(afterFirst > 0, "first frame draws the overlay");
    pass.render(renderer, readBuffer, readBuffer);
    assert.equal(calls.draws, afterFirst, "unchanged state is not redrawn");
    fakeThis.update.call(inst, 5);
    pass.render(renderer, readBuffer, readBuffer);
    assert.equal(calls.draws, afterFirst, "identical state keeps the canvas");
    inst.properties.point1X = { get: () => 60 };
    fakeThis.update.call(inst, 5);
    pass.render(renderer, readBuffer, readBuffer);
    assert.ok(calls.draws > afterFirst, "changed state redraws");
  } finally {
    globalThis.document = previousDocument;
  }
});
