"use strict";
// Selection and activation rules: candidate cycling, marquee toggles and
// vertex-only deletion decisions. Pure logic; candidates arrive ordered
// front to back from projected picking, selection sets come from the
// shared controller, lock state from the host adapter.
const test = require("node:test"),
  assert = require("node:assert/strict");
const {
  HIT_RADIUS_PX,
  samePoint,
  createCycleState,
  chooseCandidate,
  resetCycle,
  startMarquee,
  applyMarquee,
  pointsInRect,
  canEditPath,
  deletionDecision,
} = require("../plugins/shape-plus/path-selection.js");

test("first click at a location activates the frontmost candidate", () => {
  const cycle = createCycleState();
  assert.equal(chooseCandidate(cycle, [10, 10], ["front", "middle", "back"]), "front");
});

test("no candidate under the point activates nothing", () => {
  const cycle = createCycleState();
  assert.equal(chooseCandidate(cycle, [10, 10], []), null);
});

test("repeated clicks at the same location cycle front to back", () => {
  const cycle = createCycleState();
  const ids = ["front", "middle", "back"];
  assert.equal(chooseCandidate(cycle, [10, 10], ids), "front");
  assert.equal(chooseCandidate(cycle, [11, 10], ids), "middle");
  assert.equal(chooseCandidate(cycle, [10, 11], ids), "back");
});

test("cycling wraps past the last candidate to the frontmost", () => {
  const cycle = createCycleState();
  const ids = ["front", "back"];
  chooseCandidate(cycle, [10, 10], ids);
  chooseCandidate(cycle, [10, 10], ids);
  assert.equal(chooseCandidate(cycle, [10, 10], ids), "front");
});

test("the cycle includes the already active path", () => {
  const cycle = createCycleState();
  const ids = ["front", "active", "back"];
  assert.equal(chooseCandidate(cycle, [10, 10], ids), "front");
  assert.equal(chooseCandidate(cycle, [10, 10], ids), "active");
  assert.equal(chooseCandidate(cycle, [10, 10], ids), "back");
});

test("movement beyond the hit radius restarts at the frontmost candidate", () => {
  const cycle = createCycleState();
  const ids = ["front", "middle", "back"];
  chooseCandidate(cycle, [10, 10], ids);
  chooseCandidate(cycle, [10, 10], ids);
  const far = [10 + HIT_RADIUS_PX + 1, 10];
  assert.ok(!samePoint([10, 10], far));
  assert.equal(chooseCandidate(cycle, far, ids), "front");
});

test("movement within the hit radius keeps cycling", () => {
  const cycle = createCycleState();
  const ids = ["front", "middle"];
  assert.equal(chooseCandidate(cycle, [10, 10], ids), "front");
  assert.ok(samePoint([10, 10], [10 + HIT_RADIUS_PX - 1, 10]));
  assert.equal(chooseCandidate(cycle, [10 + HIT_RADIUS_PX - 1, 10], ids), "middle");
});

test("a changed candidate set restarts at the frontmost candidate", () => {
  const cycle = createCycleState();
  chooseCandidate(cycle, [10, 10], ["front", "middle"]);
  chooseCandidate(cycle, [10, 10], ["front", "middle"]);
  assert.equal(chooseCandidate(cycle, [10, 10], ["other", "front"]), "other");
});

test("resetCycle restarts after a frame change or another selection", () => {
  const cycle = createCycleState();
  const ids = ["front", "middle"];
  chooseCandidate(cycle, [10, 10], ids);
  resetCycle(cycle);
  assert.equal(chooseCandidate(cycle, [10, 10], ids), "front");
});

test("a single candidate keeps activating it on repeated clicks", () => {
  const cycle = createCycleState();
  assert.equal(chooseCandidate(cycle, [5, 5], ["only"]), "only");
  assert.equal(chooseCandidate(cycle, [5, 5], ["only"]), "only");
});

test("a locked path still activates on click", () => {
  const cycle = createCycleState();
  assert.equal(canEditPath({ locked: true }), false);
  assert.equal(chooseCandidate(cycle, [10, 10], ["locked-front", "back"]), "locked-front");
});

test("pointsInRect collects keys inside a normalized drag rectangle", () => {
  const vertices = [
    { key: "a", point: [0, 0] },
    { key: "b", point: [10, 10] },
    { key: "c", point: [20, 20] },
  ];
  assert.deepEqual(
    pointsInRect(vertices, { start: [15, 15], end: [5, 5] }),
    ["b"],
  );
  assert.deepEqual(pointsInRect(vertices, { start: [0, 0], end: [20, 20] }), ["a", "b", "c"]);
  assert.deepEqual(pointsInRect(vertices, { start: [30, 30], end: [40, 40] }), []);
});

test("a plain marquee replaces the vertex selection", () => {
  const marquee = startMarquee(new Set(["kept"]));
  assert.deepEqual(
    [...applyMarquee(marquee, ["n1", "n2"], false)],
    ["n1", "n2"],
  );
});

test("a shift marquee toggles points against the gesture-start selection", () => {
  const marquee = startMarquee(new Set(["a", "b"]));
  const result = applyMarquee(marquee, ["b", "c"], true);
  assert.deepEqual([...result].sort(), ["a", "c"]);
});

test("shift marquee off the drag keeps the captured selection", () => {
  const marquee = startMarquee(new Set(["a"]));
  assert.deepEqual([...applyMarquee(marquee, [], true)], ["a"]);
});

test("the gesture-start capture is not mutated by the marquee", () => {
  const captured = new Set(["a"]);
  const marquee = startMarquee(captured);
  applyMarquee(marquee, ["b"], true);
  assert.deepEqual([...captured], ["a"]);
});

test("Delete removes vertices only while path editing owns focus", () => {
  assert.deepEqual(
    deletionDecision({ ownsFocus: true, vertexCount: 2, locked: false }),
    { action: "delete-vertices" },
  );
  assert.deepEqual(
    deletionDecision({ ownsFocus: false, vertexCount: 2, locked: false }),
    { action: "defer-to-panel" },
  );
  assert.deepEqual(
    deletionDecision({ ownsFocus: true, vertexCount: 0, locked: false }),
    { action: "defer-to-panel" },
  );
});

test("Delete on a locked path is blocked, never silent", () => {
  assert.deepEqual(
    deletionDecision({ ownsFocus: true, vertexCount: 2, locked: true }),
    { action: "blocked-locked", message: "Unlock the mask to delete vertices." },
  );
});
