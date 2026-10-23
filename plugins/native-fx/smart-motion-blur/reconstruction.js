"use strict";
const math = require("./math.js");
function create(gl) {
  const tile = gl.pass("tile", {
    uImage: null,
    uBefore: null,
    uAfter: null,
    uScale: [1, 1],
    uFlow: null,
    uFlowSize: [1, 1],
    uProcessing: [1, 1],
    uDelta: 1,
    uSign: 1,
  });
  const neighbor = gl.pass("neighbor", {
    uFlow: null,
    uSize: [1, 1],
    uProcessing: [1, 1],
    uAmount: 0.5,
  });
  const reconstruct = gl.pass("reconstruct", {
    uImage: null,
    uBefore: null,
    uAfter: null,
    uPrevious: null,
    uNext: null,
    uPreviousMax: null,
    uNextMax: null,
    uPreviousConfidence: null,
    uNextConfidence: null,
    uGuide: null,
    uScale: [1, 1],
    uFlowSize: [1, 1],
    uProcessing: [1, 1],
    uTileSize: [1, 1],
    uDeltas: [1, 1],
    uAmount: 0.5,
    uSamples: 8,
    uView: 0,
  });
  let tiles, neighbors, size;
  function allocate(width, height) {
    size = [Math.ceil(width / 16), Math.ceil(height / 16)];
    tiles = [gl.target(...size, true), gl.target(...size, true)];
    neighbors = [gl.target(...size, true), gl.target(...size, true)];
  }
  function render(
    renderer,
    output,
    input,
    fields,
    confidence,
    deltas,
    flowSize,
    guide,
    processing,
    project,
    uvScale,
    settings,
    maxSpeed,
    sources,
  ) {
    for (let index = 0; index < 2; index++) {
      gl.draw(renderer, tile, tiles[index], {
        uImage: input,
        uBefore: sources[0],
        uAfter: sources[1],
        uScale: uvScale,
        uFlow: fields[index],
        uFlowSize: flowSize,
        uProcessing: processing,
        uProject: project,
        uDelta: deltas[index],
        uSign: index === 0 ? -1 : 1,
        uLimit: settings.maxDisplacement,
      });
      gl.draw(renderer, neighbor, neighbors[index], {
        uFlow: tiles[index].texture,
        uSize: size,
        uProcessing: processing,
        uProject: project,
        uAmount: settings.amount,
        uLimit: settings.maxDisplacement,
      });
    }
    gl.draw(renderer, reconstruct, output, {
      uImage: input,
      uBefore: sources[0],
      uAfter: sources[1],
      uPrevious: fields[0],
      uNext: fields[1],
      uPreviousMax: neighbors[0].texture,
      uNextMax: neighbors[1].texture,
      uPreviousConfidence: confidence[0],
      uNextConfidence: confidence[1],
      uGuide: guide,
      uScale: uvScale,
      uFlowSize: flowSize,
      uProcessing: processing,
      uProject: project,
      uDeltas: deltas,
      uAmount: settings.amount,
      uSamples: math.sampleCount(settings.amount, maxSpeed, settings.quality),
      uView: settings.view,
    });
  }
  return { allocate, render };
}
module.exports = { create };
