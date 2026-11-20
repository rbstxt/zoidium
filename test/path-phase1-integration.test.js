"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createPathController } = require("../plugins/shape-plus/path-controller.js");
const { createPathInput } = require("../plugins/shape-plus/path-input.js");
const { createMask } = require("../plugins/shape-plus/mask-model.js");
const { duplicate, move } = require("../plugins/shape-plus/mask-metadata.js");
const { createMaskPathHost } = require("../plugins/shape-plus/path-hosts.js");
const { LIMITS } = require("../plugins/shape-plus/mask-row-view.js");
const { scaleEvaluated, signatureOf } = require("../plugins/shape-plus/mask-gpu.js");
const { rasterizeCoverage } = require("../plugins/shape-plus/mask-raster.js");

test("shortcuts require focus and hostless outline activation fails", () => {
  const controller = createPathController({ project: {}, viewport: {} });
  const input = createPathInput({ controller });
  const event = { key: "q", target: { closest: () => null } };
  assert.equal(input.handleKeyDown(event).action, "ignore");
  assert.equal(input.activateAt([1, 1], ["missing"]), null);
  assert.equal(controller.activePathId, null);
  assert.equal(input.handleKeyDown(event, { viewportFocused: true }).action, "select-pen");
});

test("mask and vertex IDs share one collision domain", () => {
  const original = createMask("mask", "Mask", [0, 0]);
  original.vertexIds = ["vertex"];
  const candidates = ["vertex", "new-mask", "mask", "new-mask", "new-vertex"];
  const copy = duplicate([original], "mask", () => candidates.shift());
  assert.equal(copy.id, "new-mask");
  assert.deepEqual(copy.masks[1].vertexIds, ["new-vertex"]);
  let records = [original];
  const ids = ["vertex", "other"];
  const host = createMaskPathHost({ id: "m", store: {
    read: () => records, write: value => { records = value; }, nextId: () => ids.shift(),
  } });
  assert.equal(host.createPath(), "other");
  assert.notEqual(records[1].vertexIds[0], "mask");
  assert.notEqual(records[1].vertexIds[0], "vertex");
});

test("locked masks can be reordered without changing their contents", () => {
  const first = createMask("a", "A", [0, 0]);
  first.locked = true;
  const second = createMask("b", "B", [0, 0]);
  const result = move([first, second], "a", 1);
  assert.deepEqual(result.map(mask => mask.id), ["b", "a"]);
  assert.deepEqual(result[1], first);
});

test("expansion bounds and signatures preserve the zero coverage path", () => {
  assert.equal(LIMITS.expansionMin, -128);
  assert.equal(LIMITS.expansionMax, 128);
  const v = (x, y) => ({ point: [x, y], in: [0, 0], out: [0, 0] });
  const entry = { vertices: [v(4, 4), v(12, 4), v(12, 12), v(4, 12)], closed: true, enabled: true };
  const zero = scaleEvaluated([entry], 1);
  const explicit = scaleEvaluated([{ ...entry, expansion: 0 }], 1);
  const expanded = scaleEvaluated([{ ...entry, expansion: 2 }], 1);
  assert.deepEqual(rasterizeCoverage(zero, 16, 16).data, rasterizeCoverage(explicit, 16, 16).data);
  assert.notEqual(signatureOf(zero, 16, 16), signatureOf(expanded, 16, 16));
  assert.notDeepEqual(rasterizeCoverage(zero, 16, 16).data, rasterizeCoverage(expanded, 16, 16).data);
});
