"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const projective = require("../plugins/native-fx/smart-motion-blur/projective.js");

test("projective fit reads cost tiles directly without a reduction target", () => {
  const draws = [], targets = [];
  const gl = {
    pass: name => ({ name }),
    target: (width, height) => {
      const target = { width, height, texture: {} };
      targets.push(target);
      return target;
    },
    draw: (_renderer, pass, target, values) => draws.push({ name: pass.name, target, values }),
  };
  const solver = projective.create(gl);
  for (const size of [[112, 63], [1, 1], [128, 72]]) {
    targets.length = 0;
    solver.allocate();
    assert.equal(targets.length, 3);
    assert.ok(!targets.some(target => target.width === 3 && target.height === 2));
    for (let repeat = 0; repeat < 2; repeat++) {
      draws.length = 0;
      const moments = {}, images = [{}, {}, {}];
      const result = solver.apply({}, moments, images, size, [1920, 1080]);
      assert.equal(draws.length, 513);
      assert.equal(draws[0].name, "projective-fit");
      assert.equal(draws[0].values.uAxis, -1, "every render resets the coefficients");
      assert.equal(draws[0].values.uMoments, moments);
      let previous = draws[0].target.texture;
      for (let index = 1; index < draws.length; index += 2) {
        const cost = draws[index], fit = draws[index + 1];
        assert.equal(cost.name, "projective-cost");
        assert.equal(fit.name, "projective-fit");
        assert.equal(cost.values.uCurrent, images[0]);
        assert.equal(cost.values.uBefore, images[1]);
        assert.equal(cost.values.uAfter, images[2]);
        assert.equal(cost.values.uSize, size);
        assert.equal(cost.values.uHomography, previous);
        assert.equal(fit.values.uHomography, previous);
        assert.equal(fit.values.uCosts, cost.target.texture);
        assert.notEqual(fit.target.texture, previous);
        previous = fit.target.texture;
      }
      assert.equal(result, previous);
    }
  }
});
