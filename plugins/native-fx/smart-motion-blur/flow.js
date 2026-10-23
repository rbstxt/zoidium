"use strict";
const math = require("./math.js");

function create(gl) {
  const pyramid = gl.pass("pyramid", { uImage: null, uScale: [1, 1], uSourceSize: [1, 1] });
  const seed = gl.pass("seed", { uCurrent: null, uOther: null, uFlow: null,
    uSize: [1, 1], uFlowSize: [1, 1], uCoarse: 1, uStep: 1 });
  const refine = gl.pass("refine", { uCurrent: null, uOther: null, uFlow: null, uWarp: null,
    uSize: [1, 1], uSmoothness: 0.5 });
  const propagate=gl.pass("propagate",{uCurrent:null,uOther:null,uFlow:null,uScore:null,uSize:[1,1],uRadius:0,uOutput:0});
  let scores;
  const copy = gl.pass("copy", { uImage: null, uScale: [1, 1] });
  const confidence = gl.pass("confidence", { uCurrent: null, uOther: null, uFlow: null,
    uReverse: null, uSize: [1, 1], uDelta: 1 });
  let images, scratch, results, confidences, sizes;
  function allocate(width, height) {
    sizes = math.pyramidSizes(width, height);
    images = Array.from({ length: 3 }, () => sizes.map(([w,h]) => gl.target(w,h)));
    scratch = sizes.map(([w,h]) => [gl.target(w,h,true),gl.target(w,h,true),gl.target(w,h,true)]);
    results = Array.from({ length: 4 }, () => gl.target(...sizes[0],true));
    scores=[gl.target(...sizes[0]),gl.target(...sizes[0])];
    confidences = [gl.target(...sizes[0]),gl.target(...sizes[0])];
  }
  function buildPyramid(renderer, image, index, sourceSize, uvScale) {
    let input = image;
    let size = sourceSize, scale = uvScale;
    for (let i = 0; i < sizes.length; i++) {
      gl.draw(renderer,pyramid,images[index][i],{ uImage: input, uScale: scale, uSourceSize: size });
      input = images[index][i].texture;
      size = sizes[i]; scale = [1,1];
    }
  }
  function solve(renderer, a, b, resultIndex, settings, project, delta) {
    let previous = null, previousSize = [1,1];
    const limit = settings.maxDisplacement * settings.sensitivity / 100 * delta;
    const warps = settings.quality ? 3 : 2, iterations = settings.quality ? 8 : 4;
    // Balanced keeps the half-resolution guide and constraints, but avoids
    // its most expensive patch-search and Jacobi passes.
    const finest=settings.quality?0:Math.min(1,sizes.length-1);
    for (let i = sizes.length-1; i >= finest; i--) {
      const size = sizes[i], targets = scratch[i];
      gl.draw(renderer,seed,targets[0], { uCurrent: images[a][i].texture, uOther: images[b][i].texture,
        uFlow: previous, uSize: size, uFlowSize: previousSize, uCoarse: previous ? 0 : 1,
        uProject: project, uLimit: limit, uStep: 1 });
      let index = 0;
      if(!previous) {
        for(let step=0.5;step>=1/64;step/=2) {
          gl.draw(renderer,seed,targets[1-index], {uCurrent:images[a][i].texture,uOther:images[b][i].texture,
            uFlow:targets[index].texture,uSize:size,uFlowSize:size,uCoarse:0,uStep:step,
            uProject:project,uLimit:limit});
          index=1-index;
        }
      }
      for (let warp = 0; warp < warps; warp++) {
        gl.draw(renderer,copy,targets[2],{ uImage: targets[index].texture });
        for (let j = 0; j < iterations; j++) {
          gl.draw(renderer,refine,targets[1-index], { uCurrent: images[a][i].texture,
            uOther: images[b][i].texture, uFlow: targets[index].texture, uWarp: targets[2].texture,
            uSize: size, uProject: project, uLimit: limit, uSmoothness: settings.smoothness / 100 });
          index = 1-index;
        }
      }
      previous = targets[index].texture;
      previousSize = size;
    }
    const targets=scratch[0];
    const shared={uCurrent:images[a][0].texture,uOther:images[b][0].texture,
      uSize:sizes[0],uProject:project,uLimit:limit};
    // Texture-supported corners constrain both components. Fixed jump steps
    // transport those constraints through flat regions of the same color.
    gl.draw(renderer,propagate,targets[2],{...shared,uFlow:previous,uScore:scores[0].texture,uRadius:0,uOutput:0});
    // Half-float fields carry reliability and distance in their spare BA
    // channels. Packed fields require a separate score target.
    if(gl.packed) gl.draw(renderer,propagate,scores[0],{...shared,uFlow:previous,uScore:null,uRadius:0,uOutput:1});
    let field=targets[2],scoreIndex=0;
    for(let radius=1;radius<=128;radius*=2) {
      const next=field===targets[0]?targets[1]:targets[0];
      const values={...shared,uFlow:field.texture,uScore:gl.packed?scores[scoreIndex].texture:field.texture,uRadius:radius};
      gl.draw(renderer,propagate,next,{...values,uOutput:0});
      if(gl.packed) gl.draw(renderer,propagate,scores[1-scoreIndex],{...values,uOutput:1});
      field=next;scoreIndex=1-scoreIndex;
    }
    gl.draw(renderer,copy,results[resultIndex],{uImage:field.texture});
    return results[resultIndex].texture;
  }
  function analyze(renderer, index, forward, reverse, project, delta) {
    gl.draw(renderer,confidence,confidences[index], { uCurrent: images[0][0].texture,
      uOther: images[index+1][0].texture, uFlow: forward, uReverse: reverse,
      uSize: sizes[0], uProject: project, uDelta: delta });
    return confidences[index];
  }
  return { allocate, buildPyramid, solve, analyze, get size() { return sizes[0]; },
    get current() { return images[0][0].texture; } };
}
module.exports = { create };
