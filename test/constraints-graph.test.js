"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const graph = require("../plugins/constraints/constraint-graph.js");
const { listTargets } = require("../plugins/constraints/constraint-ui.js");

test("constraint ordering skips cycles but evaluates independent and downstream objects", () => {
  const result = graph.orderConstraints([
    { key: "child", deps: ["parent"] },
    { key: "parent", deps: [] },
    { key: "a", deps: ["b"] },
    { key: "b", deps: ["a"] },
    { key: "descendant", deps: ["a"] },
    { key: "self", deps: ["self"] },
  ]);
  assert.deepEqual(result.order, ["parent", "child", "descendant"]);
  assert.deepEqual(result.cyclic, new Set(["a", "b", "self"]));
});

test("dependencies include target chains and both objects' constrained ancestors", () => {
  const parents = new Map([["a", "groupA"], ["b", "groupB"], ["child", "a"]]);
  const parentOf = (key) => parents.get(key);
  const constrained = new Set(["a", "b", "groupA", "groupB"]);
  const dependencies = (a, b) => graph.constraintDependencies(a, b, parentOf, (key) => constrained.has(key));
  assert.deepEqual(dependencies("a", "b"), ["b", "groupA", "groupB"]);
  assert.ok(dependencies("a", "child").includes("a"));
  const { cyclic } = graph.orderConstraints([
    { key: "a", deps: dependencies("a", "b") },
    { key: "b", deps: dependencies("b", "a") },
  ]);
  assert.deepEqual(cyclic, new Set(["a", "b"]));
  assert.equal(graph.isAncestor("a", "child", parentOf), true);
  assert.equal(graph.isAncestor("child", "a", parentOf), false);
});

test("target options use group paths, disambiguate names and exclude the owner's subtree", () => {
  const object = (name, objects) => ({ properties: { name: { get: () => name } }, threeObj: {}, objects });
  const child = object("Text");
  const owner = object("Group", [child]);
  const sphere = object("Sphere");
  const duplicate = object("Sphere");
  const group = object("Group 1", [sphere, duplicate]);
  assert.deepEqual(listTargets({ objects: [owner, group] }, owner).map((entry) => entry.label), [
    "Group 1", "Group 1 / Sphere (1)", "Group 1 / Sphere (2)",
  ]);
  assert.ok(listTargets({ objects: [owner, group] }, child).some((entry) => entry.object === owner));
});
