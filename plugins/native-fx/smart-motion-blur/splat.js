"use strict";
const math = require("./math.js");

function create(gl) {
  const THREE = gl.THREE;
  const warp = gl.pass(
    "splat",
    {
      uImage: null,
      uFlow: null,
      uFlowSize: [1, 1],
      uScale: [1, 1],
      uBefore: null,
      uAfter: null,
      uProcessing: [1, 1],
      uTime: 0,
      uDelta: 1,
      uTear: 16,
    },
    ["splat-flow", "splat-vertex"],
  );
  const base = gl.pass("background", {
    uImage: null,
    uOther: null,
    uFlow: null,
    uFlowSize: [1, 1],
    uScale: [1, 1],
    uRegistered: null,
    uDirection: 0,
    uTime: 0,
    uDelta: 1,
  });
  const accumulate = gl.pass("accumulate", {
    uImage: null,
    uPrevious: null,
    uWeight: 1,
  });
  const combine = gl.pass("combine", {
    uFirst: null,
    uSecond: null,
    uThird: null,
    uFourth: null,
    uFirstWeight: 0.25,
    uSecondWeight: 0.25,
    uThirdWeight: 0.25,
    uFourthWeight: 0.25,
    uImage: null,
    uBefore: null,
    uAfter: null,
    uScale: [1, 1],
    uProcessing: [1, 1],
  });
  // ShaderPass is also the owner of the replacement grid geometry.
  warp.material.side = THREE.DoubleSide;
  warp.material.blending = THREE.CustomBlending;
  warp.material.blendSrc = THREE.OneFactor;
  warp.material.blendDst = THREE.OneMinusSrcAlphaFactor;
  warp.material.blendEquation = THREE.AddEquation;
  warp.material.transparent = true;
  // Faster sheets occlude slower sheets when the warped mesh overlaps.
  // Empty fragments never write depth.
  warp.material.depthTest = true;
  warp.material.depthWrite = true;
  let sample, batches, dimensions, meshKey;

  function allocate(width, height) {
    dimensions = [width, height];
    sample = gl.target(width, height, false, false, true);
    batches = Array.from({ length: 4 }, () => [
      gl.target(width, height, true, false),
      gl.target(width, height, true, false),
    ]);
  }
  function mesh(step) {
    const key = [...dimensions, step].join(":");
    if (key === meshKey) return;
    const [width, height] = dimensions;
    const columns = Math.ceil(width / step),
      rows = Math.ceil(height / step);
    const vertices = columns * rows * 6;
    const positions = new Float32Array(vertices * 3);
    const first = new Float32Array(vertices * 2),
      second = new Float32Array(vertices * 2);
    let vertex = 0;
    function triangle(points) {
      for (let index = 0; index < 3; index++) {
        positions.set([...points[index], 0], vertex * 3);
        first.set(points[(index + 1) % 3], vertex * 2);
        second.set(points[(index + 2) % 3], vertex * 2);
        vertex++;
      }
    }
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < columns; x++) {
        const left = x / columns,
          right = (x + 1) / columns;
        const bottom = y / rows,
          top = (y + 1) / rows;
        triangle([
          [left, bottom],
          [right, bottom],
          [right, top],
        ]);
        triangle([
          [left, bottom],
          [right, top],
          [left, top],
        ]);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.addAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.addAttribute("otherA", new THREE.BufferAttribute(first, 2));
    geometry.addAttribute("otherB", new THREE.BufferAttribute(second, 2));
    warp.quad.geometry.dispose();
    warp.quad.geometry = geometry;
    warp.quad.frustumCulled = false;
    meshKey = key;
  }
  function render(
    renderer,
    output,
    input,
    fields,
    deltas,
    flowSize,
    processing,
    project,
    uvScale,
    settings,
    maxSpeed,
    sources,
  ) {
    mesh(settings.quality ? 2 : 4);
    const count = math.sampleCount(settings.amount, maxSpeed, settings.quality);
    const times = math.shutterTimes(settings.amount, count);
    const partition = math.sampleBatches(count);
    const previousAutoClear = renderer.autoClear;
    try {
      for (let batch = 0; batch < 4; batch++) {
        let previous = null;
        const { start, end } = partition[batch];
        for (let index = start; index < end; index++) {
          const time = times[index],
            direction = time < 0 ? 0 : 1;
          renderer.autoClear = true;
          gl.draw(renderer, base, sample, {
            uImage: input,
            uOther: sources[direction],
            uFlow: fields[direction],
            uFlowSize: flowSize,
            uProject: project,
            uScale: uvScale,
            uRegistered: settings.registration,
            uDirection: direction,
            uTime: Math.abs(time),
            uDelta: deltas[direction],
          });
          renderer.autoClear = false;
          const values = {
            uImage: input,
            uFlow: fields[direction],
            uBefore: sources[0],
            uAfter: sources[1],
            uFlowSize: flowSize,
            uProcessing: processing,
            uProject: project,
            uScale: uvScale,
            uTime: Math.abs(time),
            uDelta: deltas[direction],
          };
          for (const [key, value] of Object.entries(values)) {
            if (Array.isArray(value)) warp.uniforms[key].value.set(...value);
            else warp.uniforms[key].value = value;
          }
          // ShaderPass forces clear=true, so render the grid scene directly.
          renderer.render(warp.scene, warp.camera, sample, false);
          const target = batches[batch][(index - start) % 2];
          gl.draw(renderer, accumulate, target, {
            uImage: sample.texture,
            uPrevious: previous,
            uWeight: 1 / (index - start + 1),
          });
          previous = target.texture;
        }
      }
      renderer.autoClear = true;
      gl.draw(renderer, combine, output, {
        uFirst: batches[0][(partition[0].end - partition[0].start - 1) % 2].texture,
        uSecond: batches[1][(partition[1].end - partition[1].start - 1) % 2].texture,
        uThird: batches[2][(partition[2].end - partition[2].start - 1) % 2].texture,
        uFourth: batches[3][(partition[3].end - partition[3].start - 1) % 2].texture,
        uImage: input,
        uBefore: sources[0],
        uAfter: sources[1],
        uScale: uvScale,
        uProcessing: processing,
        ...Object.fromEntries(
          ["First", "Second", "Third", "Fourth"].map((name, index) => [
            "u" + name + "Weight",
            partition[index].weight,
          ]),
        ),
      });
    } finally {
      renderer.autoClear = previousAutoClear;
    }
  }
  return { allocate, render };
}
module.exports = { create };
