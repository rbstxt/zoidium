"use strict";
const projective = require("./projective.js");
function create(gl) {
  const homography = projective.create(gl);
  const acceptedBytes = new Uint8Array(8);
  const moments = gl.pass("moments", {
    uCurrent: null,
    uBefore: null,
    uAfter: null,
    uSize: [1, 1],
  });
  const translation = gl.pass("translation", {
    uCurrent: null,
    uBefore: null,
    uAfter: null,
    uPrevious: null,
    uNext: null,
  });
  const check = gl.pass(
    "global-check",
    {
      uCurrent: null,
      uBefore: null,
      uAfter: null,
      uMoments: null,
      uTranslation: null,
      uHomography: null,
      uHasHomography: 0,
      uScale: [1, 1],
    },
    null,
    ["global", "projective"],
  );
  const field = gl.pass(
    "global-field",
    {
      uMoments: null,
      uFlow: null,
      uOpposite: null,
      uAccepted: null,
      uDirection: 1,
      uTranslation: null,
      uHomography: null,
    },
    null,
    ["global", "projective"],
  );
  let statistics, accepted, fields, translations;
  function allocate(width, height) {
    homography.allocate();
    translations = gl.target(2, 1, true);
    statistics = gl.target(6, 3, false, true);
    accepted = gl.target(2, 1, false, true);
    fields = [gl.target(width, height, true), gl.target(width, height, true)];
  }
  function apply(renderer, images, size, raw, local, project, limit) {
    const sources = {
      uCurrent: images[0],
      uBefore: images[1],
      uAfter: images[2],
    };
    gl.draw(renderer, moments, statistics, { ...sources, uSize: size });
    gl.draw(renderer, translation, translations, {
      ...sources,
      uPrevious: local[0],
      uNext: local[1],
      uProject: project,
      uLimit: limit,
    });
    gl.draw(renderer, check, accepted, {
      uCurrent: raw[0].image,
      uBefore: raw[1].image,
      uAfter: raw[2].image,
      uScale: raw[0].uvScale,
      uMoments: statistics.texture,
      uTranslation: translations.texture,
      uProject: project,
      uHasHomography: 0,
    });
    renderer.readRenderTargetPixels(accepted, 0, 0, 2, 1, acceptedBytes);
    let proposal = null;
    if (
      (acceptedBytes[0] === 0 && acceptedBytes[3] > 0) ||
      (acceptedBytes[4] === 0 && acceptedBytes[7] > 0)
    ) {
      proposal = homography.apply(renderer, statistics.texture, images, size, project);
      gl.draw(renderer, check, accepted, {
        uHomography: proposal,
        uHasHomography: 1,
      });
    }
    for (let index = 0; index < 2; index++) {
      gl.draw(renderer, field, fields[index], {
        uTranslation: translations.texture,
        uMoments: statistics.texture,
        uAccepted: accepted.texture,
        uHomography: proposal,
        uFlow: local[index],
        uOpposite: local[1 - index],
        uDirection: index + 1,
        uProject: project,
        uLimit: limit,
      });
    }
    return fields.map((target) => target.texture);
  }
  return {
    allocate,
    apply,
    get statistics() {
      return statistics;
    },
    get accepted() {
      return accepted;
    },
  };
}
module.exports = { create };
