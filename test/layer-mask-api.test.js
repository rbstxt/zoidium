"use strict";
// Mask API frame mapping and reference evaluation (Node-testable seams).
const test = require("node:test"),
  assert = require("node:assert/strict");
const { installMaskApi, toSourceFrame, coverageSize, MAX_SHADER_SIDE } = require("../plugins/shape-plus/mask-api.js");
const { FIELD, parseReference, formatReference, toUV } = require("../plugins/shape-plus/mask-model.js");
const { createModel } = require("../plugins/shape-plus/model.js");
const { PZ } = require("./shape-plus-host.js");

test("source frames map through both clips", () => {
  const shaderClip = { start: 10, offset: 2 }, sourceClip = { start: 30, offset: 5 };
  // Project frame = 0 + 10 - 2 = 8; source local = 8 - 30 + 5 = -17.
  assert.equal(toSourceFrame(0, shaderClip, sourceClip), -17);
  // Same clip: identity.
  const clip = { start: 10, offset: 5 };
  assert.equal(toSourceFrame(7, clip, clip), 7);
  // Missing clips default to zero offsets.
  assert.equal(toSourceFrame(7, null, null), 7);
});

test("coverage size keeps aspect and caps the long side", () => {
  assert.deepEqual(coverageSize([640, 360]), { width: 640, height: 360, scale: 1 });
  assert.deepEqual(coverageSize([0, 5]), { width: 1, height: 5, scale: 1 });
  const hd = coverageSize([1920, 1080]);
  assert.equal(Math.max(hd.width, hd.height), MAX_SHADER_SIDE);
  assert.ok(Math.abs(hd.width / hd.height - 16 / 9) < 0.01);
  const big = coverageSize([8192, 4096]);
  assert.equal(Math.max(big.width, big.height), MAX_SHADER_SIDE);
  assert.ok(Math.abs(big.width / big.height - 2) < 0.01);
});

test("references survive format and parse", () => {
  const value = formatReference({ source: "mask", clip: [0, 1, 0, 0, 0], mask: "m1" });
  assert.deepEqual(parseReference(value), { source: "mask", clip: [0, 1, 0, 0, 0], mask: "m1" });
  const shape = formatReference({ source: "shape", clip: [0, 1, 0, 0, 0], path: "p9" });
  assert.deepEqual(parseReference(shape), { source: "shape", clip: [0, 1, 0, 0, 0], path: "p9" });
  // The clip address is optional; the picker re-links through it when present.
  assert.deepEqual(parseReference(formatReference({ source: "mask", mask: "m" })), { source: "mask", mask: "m" });
  assert.equal(parseReference("not json"), null);
  assert.equal(parseReference(JSON.stringify({ version: 1, source: "mask" })), null);
});

function rectMask(id, x0, y0, x1, y1, extra = {}) {
  const v = (x, y) => [x, y, 0, 0, 0, 0];
  return { id, kind: "path", mode: "add", feather: 0, opacity: 1, invert: 0,
    vertexIds: ["v1", "v2", "v3", "v4"], vertexModes: {},
    properties: { name: "Mask " + id, enabled: 1, closed: 1,
      path: { animated: false, keyframes: [{ frame: 0,
        value: [...v(x0, y0), ...v(x1, y0), ...v(x1, y1), ...v(x0, y1)], tween: 1 }] } },
    ...extra };
}

function apiAndLayer(masks, resolution = [200, 100]) {
  const { Content } = createModel(PZ);
  const api = installMaskApi({ PZ: { zoidium: {} }, Content, onDispose() {} });
  const layer = { label: "Scene", properties: { resolution: { get: () => resolution.slice() } }, [FIELD]: masks };
  const project = { addressLookup: address => (Array.isArray(address) ? { object: layer } : null) };
  return { api, layer, project };
}

test("reference evaluation resolves masks deterministically", () => {
  const { api, project } = apiAndLayer([rectMask("m1", 0, 0, 200, 50)]);
  const ref = formatReference({ source: "mask", clip: [0], mask: "m1" });
  const first = api.evaluateReference(project, ref, 0);
  assert.ok(first);
  assert.equal(first.points.length, 256);
  assert.equal(first.closed, true);
  // Deterministic: the same frame evaluates to the same signature.
  assert.equal(api.evaluateReference(project, ref, 0).signature, first.signature);
  // Coverage is in mask space with row 0 at the top: a top-half rect
  // covers the first rows and leaves the last rows empty. The flipped
  // texture upload (v = 1 at top) and the display convention (displayed
  // top samples v = 1) carry this orientation to the screen; the browser
  // probes pin the full chain against the native Mask effect.
  const coverage = api.coverageData(first);
  assert.deepEqual([coverage.width, coverage.height], [200, 100]);
  for (let x = 0; x < 200; x++) assert.equal(coverage.data[x], 255, "top row " + x);
  for (let x = 0; x < 200; x++) assert.equal(coverage.data[99 * 200 + x], 0, "bottom row " + x);
});

test("evaluation returns null for unresolvable references", () => {
  const { api, project } = apiAndLayer([rectMask("m1", 0, 0, 200, 100)]);
  const ghostClip = { addressLookup: () => null };
  assert.equal(api.evaluateReference(ghostClip, formatReference({ source: "mask", clip: [9], mask: "m1" }), 0), null);
  assert.equal(api.evaluateReference(project, formatReference({ source: "mask", clip: [0], mask: "ghost" }), 0), null);
  assert.equal(api.evaluateReference(project, formatReference({ source: "shape", clip: [0], path: "ghost" }), 0), null);
  assert.equal(api.evaluateReference(project, formatReference({ source: "mask", clip: [0], mask: "m1" }), NaN), null);
  assert.equal(api.evaluateReference(project, formatReference({ source: "mask", clip: [0], mask: "m1" }), Infinity), null);
  assert.equal(api.evaluateReference(project, formatReference({ source: "effect", clip: [0], mask: "m1" }), 0), null);
  assert.equal(api.evaluateReference(project, "null", 0), null);
  // Disabled masks bind nothing.
  const disabled = apiAndLayer([{ ...rectMask("m1", 0, 0, 200, 100), enabled: 0 }]);
  assert.equal(disabled.api.evaluateReference(disabled.project, formatReference({ source: "mask", clip: [0], mask: "m1" }), 0), null);
  // Corrupt mask collections fail closed, and cyclic-looking input (a
  // reference pointing at its own layer) terminates: sampling never
  // renders, so no render cycle can occur by construction.
  const corrupt = apiAndLayer([{ id: "bad", kind: "group", contents: [] }]);
  assert.equal(corrupt.api.evaluateReference(corrupt.project, formatReference({ source: "mask", clip: [0], mask: "bad" }), 0), null);
});

test("layer renames and duplicates keep references resolving", () => {
  const { api, layer, project } = apiAndLayer([rectMask("m1", 0, 0, 200, 50)]);
  const ref = formatReference({ source: "mask", clip: [0], mask: "m1" });
  const before = api.evaluateReference(project, ref, 0).signature;
  // Renaming the layer leaves the clip address (the stable token) alone.
  layer.label = "Renamed scene";
  assert.equal(api.evaluateReference(project, ref, 0).signature, before);
  // Duplication through load/toJSON preserves the masks: a JSON-cloned
  // collection evaluates to the same signature on a fresh layer object.
  const twin = { label: "Scene copy", properties: { resolution: { get: () => [200, 100] } } };
  twin[FIELD] = JSON.parse(JSON.stringify(layer[FIELD]));
  const twinProject = { addressLookup: address => (Array.isArray(address) ? { object: twin } : null) };
  assert.equal(api.evaluateReference(twinProject, ref, 0).signature, before);
});

test("Shape+ paths convert centered y-up to mask space", () => {
  const { Content } = createModel(PZ);
  const api = installMaskApi({ PZ: { zoidium: {} }, Content, onDispose() {} });
  // A rect centered at the Shape+ origin on a 200x100 layer.
  const data = rectMask("p1", -50, -25, 50, 25);
  const item = new Content(data.kind, data);
  item.load(data);
  const layer = { label: "Shape+", properties: { resolution: { get: () => [200, 100] } }, contents: [item] };
  item.id = "p1";
  const project = { addressLookup: address => (Array.isArray(address) ? { object: layer } : null) };
  const evaluated = api.evaluateReference(project, formatReference({ source: "shape", clip: [0], path: "p1" }), 0);
  assert.ok(evaluated);
  const coverage = api.coverageData(evaluated);
  // Centered path lands centered: middle pixel covered, corner empty.
  assert.equal(coverage.data[50 * 200 + 100], 255);
  assert.equal(coverage.data[0], 0);
  assert.equal(coverage.data[99 * 200 + 199], 0);
  // A path starting at the top of Shape+ space (y-up) samples near the
  // top of shader UV (v = 1 at top).
  const top = rectMask("p2", -50, 50, 50, -50);
  top.properties.path.keyframes[0].value = [-50, 50, 0, 0, 0, 0, 50, 50, 0, 0, 0, 0, 50, -50, 0, 0, 0, 0, -50, -50, 0, 0, 0, 0];
  const topItem = new Content(top.kind, top);
  topItem.load(top);
  topItem.id = "p2";
  const topLayer = { label: "Shape+", properties: { resolution: { get: () => [200, 100] } }, contents: [topItem] };
  const topProject = { addressLookup: address => (Array.isArray(address) ? { object: topLayer } : null) };
  const topEvaluated = api.evaluateReference(topProject, formatReference({ source: "shape", clip: [0], path: "p2" }), 0);
  const [u, v] = toUV([topEvaluated.points[0]], 200, 100)[0];
  assert.ok(v > 0.8, "first point near the top, got [" + u + ", " + v + "]");
});
