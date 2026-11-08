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
