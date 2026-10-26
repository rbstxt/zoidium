"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const flow = require("../plugins/native-fx/smart-motion-blur/flow.js");
const math = require("../plugins/native-fx/smart-motion-blur/math.js");

function probe() {
  const draws = [];
  const gl = {
    packed: false,
    pass: name => ({ name }),
    target: (width, height) => ({ width, height, texture: {} }),
    draw: (_renderer, pass, target, values) => draws.push({ name: pass.name, target, values }),
  };
  const solver = flow.create(gl);
  function render(width, height) {
    draws.length = 0;
    solver.allocate(width, height);
    for (let index = 0; index < 2; index++) {
      solver.buildPyramid({}, {}, index, [width, height], [1, 1]);
    }
    solver.solve({}, 0, 1, 0,
      { maxDisplacement: 256, sensitivity: 70, smoothness: 50 }, [1920, 1080], 1);
    return draws.filter(draw => draw.name === "propagate");
  }
  return { render };
}

test("propagation omits radii that cannot reach another pixel", () => {
  const p = probe();
  for (const [width, height] of [[224, 126], [1790, 1006], [1, 1], [2, 1024], [513, 1]]) {
    const size = math.pyramidSizes(width, height)[0];
    const expected = [0];
    for (let radius = 1; radius <= 256 && radius < Math.max(...size); radius *= 2) expected.push(radius);
    const draws = p.render(width, height);
    for (let direction = 0; direction < 4; direction++) {
      assert.deepEqual(draws.slice(direction * expected.length, (direction + 1) * expected.length)
        .map(draw => draw.values.uRadius), expected);
    }
    assert.equal(draws.length, expected.length * 4);
  }
});

test("propagation uses the final written anchor after size changes", () => {
  const p = probe();
  for (const size of [[224, 126], [1790, 1006], [8, 8], [224, 126]]) {
    const draws = p.render(...size);
    const perDirection = draws.length / 4;
    for (let direction = 0; direction < 4; direction++) {
      const group = draws.slice(direction * perDirection, (direction + 1) * perDirection);
      for (let index = 1; index < group.length; index++) {
        assert.equal(group[index].values.uAnchors, group[index - 1].target.texture);
      }
    }
  }
});
