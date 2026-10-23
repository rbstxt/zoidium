"use strict";
function create(gl) {
  const moments = gl.pass("moments", {uCurrent: null, uBefore: null, uAfter: null, uSize: [1, 1]});
  const check = gl.pass("global-check", {
    uCurrent: null, uBefore: null, uAfter: null, uMoments: null,
  }, null, "global");
  const field = gl.pass("global-field", {
    uMoments: null, uFlow: null, uAccepted: null, uDirection: 1,
  }, null, "global");
  let statistics, accepted, fields;
  function allocate(width, height) {
    statistics = gl.target(6, 3, false, true);
    accepted = gl.target(2, 1, false, true);
    fields = [gl.target(width, height, true), gl.target(width, height, true)];
  }
  function apply(renderer, images, size, local, project, limit) {
    const sources = {uCurrent: images[0], uBefore: images[1], uAfter: images[2]};
    gl.draw(renderer, moments, statistics, {...sources, uSize: size});
    gl.draw(renderer, check, accepted, {...sources, uMoments: statistics.texture, uProject: project});
    for (let index = 0; index < 2; index++) {
      gl.draw(renderer, field, fields[index], {
        uMoments: statistics.texture, uAccepted: accepted.texture,
        uFlow: local[index], uDirection: index + 1, uProject: project, uLimit: limit,
      });
    }
    return fields.map(target => target.texture);
  }
  return { allocate, apply, get statistics() { return statistics; },
    get accepted() { return accepted; } };
}
module.exports = { create };
