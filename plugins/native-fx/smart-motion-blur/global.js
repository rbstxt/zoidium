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
  }, null, ["statistics"]);
  const translationCost = gl.pass("translation-cost", {
    uCurrent: null, uBefore: null, uAfter: null, uPrevious: null, uNext: null,
    uTranslation: null, uStep: -1,
  }, null, ["statistics"]);
  const translation = gl.pass("translation", {
    uPrevious: null, uNext: null, uTranslation: null, uCosts: null, uStep: -1,
  }, null, ["statistics"]);
  const cost = gl.pass("global-cost", {
    uCurrent: null, uBefore: null, uAfter: null, uMoments: null,
    uTranslation: null, uHomography: null, uHasHomography: 0, uScale: [1, 1],
  }, null, ["global", "projective", "statistics"]);
  const check = gl.pass("global-check", {
    uMoments: null, uChecks: null, uHasHomography: 0,
  }, null, ["global", "statistics"]);
  const reduce = gl.pass("statistics-reduce", {
    uTiles: null, uGroups: [1, 1], uNormalization: 1,
  }, null, ["statistics"]);
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
  let statistics, momentTiles, checks, checkTiles, accepted, fields, translations, translationCosts;
  let projectiveTriggered = false;
  function allocate(width, height) {
    homography.allocate();
    translations = [gl.target(2, 1, true), gl.target(2, 1, true)];
    translationCosts = gl.target(65, 2, false, true);
    momentTiles = gl.target(48, 24, false, true);
    checkTiles = gl.target(56, 16, false, true);
    checks = gl.target(7, 2, false, true);
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
    projectiveTriggered = false;
    gl.draw(renderer, moments, momentTiles, { ...sources, uSize: size });
    gl.draw(renderer, reduce, statistics, {
      uTiles: momentTiles.texture, uGroups: [6, 3],
      uNormalization: 16384 / (size[0] * size[1]),
    });
    let translationIndex = 0;
    for (const step of [-1, 2, 1, 0.5, 0.25, 0.125]) {
      const shared = {
        uPrevious: local[0], uNext: local[1],
        uTranslation: translations[translationIndex].texture,
        uStep: step, uProject: project, uLimit: limit,
      };
      gl.draw(renderer, translationCost, translationCosts, { ...sources, ...shared });
      gl.draw(renderer, translation, translations[1 - translationIndex], {
        ...shared, uCosts: translationCosts.texture,
      });
      translationIndex = 1 - translationIndex;
    }
    const translated = translations[translationIndex].texture;
    function validate(proposal) {
      gl.draw(renderer, cost, checkTiles, {
        uCurrent: raw[0].image, uBefore: raw[1].image, uAfter: raw[2].image,
        uScale: raw[0].uvScale, uMoments: statistics.texture,
        uTranslation: translated, uProject: project,
        uHomography: proposal, uHasHomography: proposal ? 1 : 0,
      });
      gl.draw(renderer, reduce, checks, {
        uTiles: checkTiles.texture, uGroups: [7, 2], uNormalization: 1,
      });
      gl.draw(renderer, check, accepted, {
        uChecks: checks.texture, uMoments: statistics.texture, uProject: project,
        uHasHomography: proposal ? 1 : 0,
      });
    }
    validate(null);
    renderer.readRenderTargetPixels(accepted, 0, 0, 2, 1, acceptedBytes);
    let proposal = null;
    if (
      (acceptedBytes[0] === 0 && acceptedBytes[3] > 0) ||
      (acceptedBytes[4] === 0 && acceptedBytes[7] > 0)
    ) {
      projectiveTriggered = true;
      proposal = homography.apply(renderer, statistics.texture, images, size, project);
      validate(proposal);
    }
    for (let index = 0; index < 2; index++) {
      gl.draw(renderer, field, fields[index], {
        uTranslation: translated,
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
    get projectiveTriggered() {
      return projectiveTriggered;
    },
    get statistics() {
      return statistics;
    },
    get accepted() {
      return accepted;
    },
  };
}
module.exports = { create };
