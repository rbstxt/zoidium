"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { parseConditions, formatConditions, matches } = require("../plugins/shader-plus/visibility");
for (const [text, yes, no] of [
  ["> 5.5", [5.5001, 6], [5.5, 0]], [">= 1", [1, 2], [.999, -1]],
  ["< 0", [-1, -.001], [0, 1]], ["<= 2", [1, 2], [2.001, 3]],
  ["!= 3", [2, 3.001], [3]], ["= 4", [4], [3, 4.001]],
  ["1..5", [1, 3, 5], [.999, 5.001]], ["-2.5..-1e-2", [-2.5, -.01], [-3, 0]],
  ["> 5.5; 1..3; = 4; off", [6, 1, 3, 4, "off"], [5, 3.5]],
]) test("visibility evaluates " + text + " with strict numeric boundaries", () => {
  const condition = parseConditions(text);
  for (const value of yes) assert.equal(matches(condition, value), true, String(value));
  for (const value of [...no, null, undefined, {}, NaN, Infinity]) assert.equal(matches(condition, value), false, String(value));
  assert.deepEqual(parseConditions(formatConditions(condition)), condition);
});
for (const text of [">", ">= no", "== 4", "! 3", "5..1", "1..x", "> Infinity", "1..Infinity", " ", "1....2"]) {
  test("visibility rejects invalid input " + JSON.stringify(text), () => assert.throws(() => parseConditions(text)));
}
test("legacy values retain exact native equality without interpreting strings", () => {
  const old = { values: [3, "3", "> 5", "1..5", "off"] };
  for (const value of old.values) assert.equal(matches(old, value), true);
  for (const value of [4, 6, false, null, undefined]) assert.equal(matches(old, value), false);
});

const { unreachable } = require("../plugins/shader-plus/visibility");
const { KINDS } = require("../plugins/shader-plus/kinds");
function controller(kind, overrides = {}) {
  return { definition: KINDS[kind].create(), keyframes: [{ value: 0 }], ...overrides };
}
test("finite controller choices warn about unreachable conditions without rejecting them", () => {
  assert.equal(unreachable(parseConditions("3"), controller("dropdown")), true);
  assert.equal(unreachable(parseConditions("2"), controller("dropdown")), false);
  assert.equal(unreachable(parseConditions("> 5"), controller("checkbox")), true);
  assert.equal(unreachable(parseConditions("1..5"), controller("checkbox")), false);
  assert.equal(unreachable({ values: ["2"] }, controller("staticDropdown")), false);
  assert.equal(unreachable({ values: [2] }, controller("staticDropdown")), true, "static options retain strict string equality");
});
test("visibility warnings preserve evaluated values and unknown controller ranges", () => {
  const when = parseConditions("3");
  assert.equal(unreachable(when, controller("dropdown", { expression: {} })), false);
  assert.equal(unreachable(when, controller("dropdown", { interpolated: true })), false);
  assert.equal(unreachable(when, controller("dropdown", { keyframes: [{ value: 3 }] })), false);
  assert.equal(unreachable(when, controller("slider")), false);
  assert.equal(unreachable(when, null), false);
});
