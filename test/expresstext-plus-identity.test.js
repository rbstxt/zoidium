"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { fixture } = require("./helpers/expresstext-host.cjs");
const expected = require("./fixtures/expresstext-30fps.json");

// Static Plain, animated Noise, and the time Formula use the same controls
// as the existing effector and determinism fixtures. All geometry is synthetic.
const cases = [
  [],
  [["Plain", { plainPosition: [12, -4, 2], plainRotation: [0, 0, 0.3] }]],
  [["Random", { randomMode: 2, randomAnimationSpeed: 50, randomSeed: 7 }]],
  [["Formula", { formulaExpression: "60*t + 30*sin(u*360)", formulaPosition: [1, 0, 0] }]],
  [["Shake", { shakePosition: [2, 5, 1], shakeFrequency: 1.25 }]],
];
function capture() {
  return cases.map(sections => {
    const h = fixture();
    try {
      for (const [name, values] of sections) h.section(name, values);
      const text = h.text();
      text.properties.position.set([4, 3, 2], 0);
      return [0, 13, 30].map(frame => {
        h.container.update(frame);
        h.project.threeObj.updateMatrixWorld(true);
        const split = h.T.getSplitState(text);
        return [split.renderRoot, ...split.entries.map(entry => entry.anchor)].map(node =>
          Array.from(node.matrixWorld.elements));
      });
    } finally { h.close(); }
  });
}
test("unaffected 30 fps fixtures retain their pre-fix world transforms", () => {
  assert.deepEqual(capture(), expected);
});
