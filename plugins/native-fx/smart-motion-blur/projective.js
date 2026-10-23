"use strict";
function create(gl) {
  const fit = gl.pass("projective-fit", {
    uHomography: null,
    uMoments: null,
    uCurrent: null,
    uBefore: null,
    uAfter: null,
    uSize: [1, 1],
    uAxis: -1,
    uRadius: 0,
  }, null, ["global", "projective"]);
  let targets;
  function allocate() {
    targets = [gl.target(8, 2, false, true), gl.target(8, 2, false, true)];
  }
  function apply(renderer, moments, images, size, project) {
    const shared = {
      uMoments: moments, uCurrent: images[0], uBefore: images[1], uAfter: images[2],
      uSize: size, uProject: project,
    };
    gl.draw(renderer, fit, targets[0], { ...shared, uAxis: -1 });
    let index = 0;
    for (const radius of [0.08, 0.04, 0.02, 0.01, 0.005, 0.0025, 0.00125, 0.000625]) {
      for (let iteration = 0; iteration < 4; iteration++) {
        for (const axis of [4, 5, 0, 3, 1, 2, 6, 7]) {
          gl.draw(renderer, fit, targets[1 - index], {
            ...shared, uHomography: targets[index].texture, uAxis: axis, uRadius: radius,
          });
          index = 1 - index;
        }
      }
    }
    return targets[index].texture;
  }
  return { allocate, apply };
}
module.exports = { create };
