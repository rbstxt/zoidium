"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const flow = require("../plugins/native-fx/smart-motion-blur/flow.js");
const math = require("../plugins/native-fx/smart-motion-blur/math.js");

test("refinement keeps each warp immutable without copying its texels", () => {
  for (const packed of [false, true]) {
    let draws = [];
    const gl = {
      packed,
      pass: name => ({ name }),
      target: (width, height) => ({ width, height, texture: {} }),
      draw: (_renderer, pass, target, values) => {
        for (const value of Object.values(values)) assert.notEqual(value, target.texture);
        draws.push({ name: pass.name, target, values });
      },
    };
    const solver = flow.create(gl);
    // Returning to the first dimensions must not reuse a previous warp.
    for (const size of [[224, 126], [1790, 1006], [1, 1], [224, 126]]) {
      solver.allocate(...size);
      for (let index = 0; index < 3; index++) solver.buildPyramid({}, {}, index, size, [1, 1]);
      for (const resultIndex of [0, 1, 2, 3, 0]) {
        draws = [];
        solver.solve({}, 0, 1, resultIndex,
          { maxDisplacement: 256, sensitivity: 70, smoothness: 50 }, [1920, 1080], 1);
        const iterations = resultIndex % 2 ? 2 : 4;
        const warps = resultIndex % 2 ? 1 : 2;
        const levels = Math.max(1, math.pyramidSizes(...size).length - 1);
        const refined = draws.filter(draw => draw.name === "refine");
        assert.equal(refined.length, levels * warps * iterations);
        assert.equal(draws.filter(draw => draw.name === "copy").length, resultIndex % 2 ? 0 : 1,
          "only the forward constraint capture still needs a copy");
        let previous;
        for (let index = 0; index < draws.length; index++) {
          const draw = draws[index];
          if (draw.name === "seed") previous = draw.target.texture;
          if (draw.name !== "refine") continue;
          const group = draws.slice(index, index + iterations);
          const warp = previous;
          for (const step of group) {
            assert.equal(step.name, "refine");
            assert.equal(step.values.uWarp, warp);
            assert.equal(step.values.uFlow, previous);
            assert.notEqual(step.target.texture, warp, "the warp stays unchanged during all iterations");
            previous = step.target.texture;
          }
          index += iterations - 1;
        }
      }
    }
  }
});
