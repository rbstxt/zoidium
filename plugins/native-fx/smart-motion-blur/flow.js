"use strict";
const math = require("./math.js");

function create(gl) {
  const pyramid = gl.pass("pyramid", {
    uImage: null,
    uScale: [1, 1],
    uSourceSize: [1, 1],
  });
  const seed = gl.pass("seed", {
    uCurrent: null,
    uOther: null,
    uFlow: null,
    uSize: [1, 1],
    uFlowSize: [1, 1],
    uCoarse: 1,
    uStep: 1,
  });
  const refine = gl.pass("refine", {
    uCurrent: null,
    uOther: null,
    uFlow: null,
    uWarp: null,
    uSize: [1, 1],
    uSmoothness: 0.5,
  });
  const constraints = gl.pass("constraints", {
    uCurrent: null,
    uOther: null,
    uFlow: null,
    uScore: null,
    uSize: [1, 1],
    uRadius: 0,
    uOutput: 0,
    uRawCurrent: null,
    uRawOther: null,
    uRawSize: [1, 1],
    uRawScale: [1, 1],
  });
  const propagate = gl.pass("propagate", {
    uCurrent: null,
    uOther: null,
    uFlow: null,
    uScore: null,
    uAnchors: null,
    uSize: [1, 1],
    uQuadrant: [1, 1],
    uRadius: 0,
    uRawCurrent: null,
    uRawSize: [1, 1],
    uRawScale: [1, 1],
  });
  const interpolate = gl.pass("interpolate", {
    uScore: null,
    uCurrent: null,
    uOther: null,
    uFlow: null,
    uSize: [1, 1],
    uNorthWest: null,
    uNorthEast: null,
    uSouthWest: null,
    uSouthEast: null,
  });
  let scores, anchors;
  const copy = gl.pass("copy", { uImage: null, uScale: [1, 1] });
  const upsample = gl.pass("upsample", { uFlow: null, uFlowSize: [1, 1] });
  const confidence = gl.pass("confidence", {
    uCurrent: null,
    uOther: null,
    uFlow: null,
    uReverse: null,
    uSize: [1, 1],
    uDelta: 1,
  });
  let images, scratch, results, confidences, sizes;
  const sources = [];
  function allocate(width, height) {
    sizes = math.pyramidSizes(width, height);
    images = Array.from({ length: 3 }, () =>
      sizes.map(([width, height]) => gl.target(width, height)),
    );
    scratch = sizes.map(([width, height]) => [
      gl.target(width, height, true),
      gl.target(width, height, true),
      gl.target(width, height, true),
    ]);
    results = Array.from({ length: 4 }, () => gl.target(...sizes[0], true));
    scores = [gl.target(...sizes[0])];
    anchors = Array.from({ length: 4 }, () => [
      gl.target(...sizes[0], false, true),
      gl.target(...sizes[0], false, true),
    ]);
    confidences = [gl.target(...sizes[0]), gl.target(...sizes[0])];
  }
  function buildPyramid(renderer, image, imageIndex, sourceSize, uvScale) {
    sources[imageIndex] = { image, sourceSize, uvScale };
    let input = image;
    let size = sourceSize;
    let scale = uvScale;
    for (let levelIndex = 0; levelIndex < sizes.length; levelIndex++) {
      gl.draw(renderer, pyramid, images[imageIndex][levelIndex], {
        uImage: input,
        uScale: scale,
        uSourceSize: size,
      });
      input = images[imageIndex][levelIndex].texture;
      size = sizes[levelIndex];
      scale = [1, 1];
    }
  }
  function solve(
    renderer,
    currentIndex,
    otherIndex,
    resultIndex,
    settings,
    project,
    delta,
  ) {
    let previous = null,
      previousSize = [1, 1];
    const limit =
      ((settings.maxDisplacement * settings.sensitivity) / 100) * delta;
    const reverse = resultIndex % 2 === 1;
    const warps = reverse ? 1 : 2;
    const iterations = reverse ? 2 : 4;
    // Finer Jacobi refinement can collapse a rotating flat region onto an
    // aperture solution. Both qualities use the stable quarter-resolution
    // initialization and full-source constraints. High raises shutter sampling.
    const finest = Math.min(1, sizes.length - 1);
    for (
      let levelIndex = sizes.length - 1;
      levelIndex >= finest;
      levelIndex--
    ) {
      const size = sizes[levelIndex],
        targets = scratch[levelIndex];
      gl.draw(renderer, seed, targets[0], {
        uCurrent: images[currentIndex][levelIndex].texture,
        uOther: images[otherIndex][levelIndex].texture,
        uFlow: previous,
        uSize: size,
        uFlowSize: previousSize,
        uCoarse: previous ? 0 : 1,
        uProject: project,
        uLimit: limit,
        uStep: 1,
      });
      let bufferIndex = 0;
      if (!previous) {
        for (let step = 0.5; step >= 1 / 64; step /= 2) {
          gl.draw(renderer, seed, targets[1 - bufferIndex], {
            uCurrent: images[currentIndex][levelIndex].texture,
            uOther: images[otherIndex][levelIndex].texture,
            uFlow: targets[bufferIndex].texture,
            uSize: size,
            uFlowSize: size,
            uCoarse: 0,
            uStep: step,
            uProject: project,
            uLimit: limit,
          });
          bufferIndex = 1 - bufferIndex;
        }
      }
      for (let warp = 0; warp < warps; warp++) {
        gl.draw(renderer, copy, targets[2], {
          uImage: targets[bufferIndex].texture,
        });
        for (let iteration = 0; iteration < iterations; iteration++) {
          gl.draw(renderer, refine, targets[1 - bufferIndex], {
            uCurrent: images[currentIndex][levelIndex].texture,
            uOther: images[otherIndex][levelIndex].texture,
            uFlow: targets[bufferIndex].texture,
            uWarp: targets[2].texture,
            uSize: size,
            uProject: project,
            uLimit: limit,
            uSmoothness: settings.smoothness / 100,
          });
          bufferIndex = 1 - bufferIndex;
        }
      }
      previous = targets[bufferIndex].texture;
      previousSize = size;
    }
    // Reverse fields only test forward/backward agreement. Dense source
    // constraints in both directions duplicate the most expensive work.
    if (reverse) {
      gl.draw(renderer, upsample, results[resultIndex], {
        uFlow: previous,
        uFlowSize: previousSize,
        uProject: project,
        uLimit: limit,
      });
      return results[resultIndex].texture;
    }
    const targets = scratch[0];
    const shared = {
      uCurrent: images[currentIndex][0].texture,
      uOther: images[otherIndex][0].texture,
      uSize: sizes[0],
      uProject: project,
      uLimit: limit,
    };
    gl.draw(renderer, constraints, targets[2], {
      ...shared,
      uRawCurrent: sources[currentIndex].image,
      uRawOther: sources[otherIndex].image,
      uRawSize: sources[currentIndex].sourceSize,
      uRawScale: sources[currentIndex].uvScale,
      uFlow: previous,
      uScore: null,
      uRadius: 0,
      uOutput: 0,
    });
    if (gl.packed) {
      gl.draw(renderer, constraints, scores[0], {
        ...shared,
        uRawCurrent: sources[currentIndex].image,
        uRawOther: sources[otherIndex].image,
        uRawSize: sources[currentIndex].sourceSize,
        uRawScale: sources[currentIndex].uvScale,
        uFlow: targets[2].texture,
        uScore: null,
        uRadius: 0,
        uOutput: 1,
      });
    }
    const directions = [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ];
    const anchorTextures = [];
    for (let direction = 0; direction < directions.length; direction++) {
      const pair = anchors[direction];
      const values = {
        ...shared,
        uRawCurrent: sources[currentIndex].image,
        uRawSize: sources[currentIndex].sourceSize,
        uRawScale: sources[currentIndex].uvScale,
        uFlow: targets[2].texture,
        uScore: scores[0].texture,
        uQuadrant: directions[direction],
      };
      gl.draw(renderer, propagate, pair[0], {
        ...values,
        uAnchors: null,
        uRadius: 0,
      });
      let index = 0;
      for (let radius = 1; radius <= 256; radius *= 2) {
        gl.draw(renderer, propagate, pair[1 - index], {
          ...values,
          uAnchors: pair[index].texture,
          uRadius: radius,
        });
        index = 1 - index;
      }
      anchorTextures.push(pair[index].texture);
    }
    gl.draw(renderer, interpolate, results[resultIndex], {
      ...shared,
      uFlow: targets[2].texture,
      uScore: scores[0].texture,
      uNorthWest: anchorTextures[0],
      uNorthEast: anchorTextures[1],
      uSouthWest: anchorTextures[2],
      uSouthEast: anchorTextures[3],
    });
    return results[resultIndex].texture;
  }
  function analyze(renderer, index, forward, reverse, project, delta) {
    gl.draw(renderer, confidence, confidences[index], {
      uCurrent: images[0][0].texture,
      uOther: images[index + 1][0].texture,
      uFlow: forward,
      uReverse: reverse,
      uSize: sizes[0],
      uProject: project,
      uDelta: delta,
    });
    return confidences[index];
  }
  return {
    allocate,
    buildPyramid,
    solve,
    analyze,
    get constraints() {
      return scratch[0][2].texture;
    },
    get anchors() {
      return anchors;
    },
    get size() {
      return sizes[0];
    },
    get guides() {
      const level = sizes.findIndex((size) => Math.max(...size) <= 128);
      return images.map(
        (levels) => levels[level < 0 ? levels.length - 1 : level].texture,
      );
    },
    get sources() {
      return sources;
    },
    get guideSize() {
      return (
        sizes.find((size) => Math.max(...size) <= 128) ||
        sizes[sizes.length - 1]
      );
    },
    get current() {
      return images[0][0].texture;
    },
  };
}
module.exports = { create };
