"use strict";
const math = require("./math.js");
const utilities = require("./gl.js");
const solver = require("./flow.js");
const registration = require("./global.js");
const reconstruction = require("./reconstruction.js");

function create(THREE, api, getAsset) {
  const gl = utilities.create(THREE, api, getAsset);
  const global = registration.create(gl);
  const flow = solver.create(gl),
    blur = reconstruction.create(gl);
  const copy = gl.pass("copy", { uImage: null, uScale: [1, 1] });
  const difference = gl.pass("difference", {
    uSourceOnly: 0,
    uCurrent: null,
    uBefore: null,
    uAfter: null,
    uPreviousConfidence: null,
    uNextConfidence: null,
    uSourceSize: [1, 1],
    uActiveSize: [1, 1],
  });
  const reduce = gl.pass("reduce", {
    uImage: null,
    uSourceSize: [1, 1],
    uAverage: 0,
  });
  let signature = null,
    chain,
    first,
    storage,
    allocatedRenderer;
  const bytes = new Uint8Array(4);
  const diagnostics = {
    storage: null,
    maxSpeed: 0,
    sceneCut: false,
    static: false,
    samples: 0,
  };
  function allocate(renderer, input, uvScale, forcePacked) {
    const processing = [
      Math.max(1, Math.round(input.width * uvScale[0])),
      Math.max(1, Math.round(input.height * uvScale[1])),
    ];
    const key = JSON.stringify([
      input.width,
      input.height,
      ...processing,
      forcePacked,
    ]);
    if (key === signature && renderer === allocatedRenderer) return processing;
    gl.clearTargets();
    storage = gl.selectStorage(renderer, forcePacked);
    flow.allocate(...processing);
    blur.allocate(...processing);
    global.allocate(...flow.size);
    first = gl.target(
      Math.ceil(processing[0] / 2),
      Math.ceil(processing[1] / 2),
    );
    chain = [];
    let size = [first.width, first.height];
    while (size[0] > 1 || size[1] > 1) {
      size = size.map((dimension) => Math.ceil(dimension / 2));
      chain.push(gl.target(...size));
    }
    signature = key;
    allocatedRenderer = renderer;
    diagnostics.storage = storage;
    return processing;
  }
  function reduction(renderer, input, average) {
    let source = input;
    // Confidence is half resolution and fits the same first reduction target.
    const targets = chain;
    for (const target of targets) {
      if (source.width === 1 && source.height === 1) break;
      gl.draw(renderer, reduce, target, {
        uImage: source.texture,
        uSourceSize: [source.width, source.height],
        uAverage: average ? 1 : 0,
      });
      source = target;
    }
    renderer.readRenderTargetPixels(source, 0, 0, 1, 1, bytes);
    return Array.from(bytes);
  }
  function render(
    renderer,
    output,
    input,
    neighbors,
    currentFrame,
    project,
    uvScale,
    settings,
    forcePacked,
  ) {
    return gl.preserve(renderer, () => {
      const copyInput = () =>
        gl.draw(renderer, copy, output, {
          uImage: input.texture,
          uScale: uvScale,
        });
      const pair = math.neighbors(neighbors, currentFrame);
      diagnostics.sceneCut = false;
      diagnostics.static = false;
      diagnostics.maxSpeed = 0;
      diagnostics.samples = 0;
      diagnostics.readbacks = 0;
      diagnostics.fields = null;
      diagnostics.confidence = null;
      diagnostics.flowSize = null;
      diagnostics.reconstruction = null;
      if (
        !settings.amount ||
        !settings.sensitivity ||
        (!pair.previous && !pair.next)
      )
        return copyInput();
      const processing = allocate(renderer, input, uvScale, forcePacked);
      const available = [pair.previous, pair.next];
      // The alpha channel uses source pixels only. Run its unchanged exact
      // maximum reduction before building pyramids or solving either flow.
      gl.draw(renderer, difference, first, {
        uSourceOnly: 1,
        uCurrent: input.texture,
        uBefore: (pair.previous || pair.next).texture,
        uAfter: (pair.next || pair.previous).texture,
        uSourceSize: [input.width, input.height],
        uActiveSize: processing,
      });
      const sourceStatistics = reduction(renderer, first, true);
      diagnostics.readbacks = 1;
      diagnostics.static = sourceStatistics[3] === 0;
      if (diagnostics.static) return copyInput();
      flow.buildPyramid(
        renderer,
        input.texture,
        0,
        [input.width, input.height],
        uvScale,
      );
      let fields = [null, null];
      const reverseFields = [null, null],
        confidence = [null, null],
        deltas = [1, 1];
      for (let index = 0; index < 2; index++) {
        const tap = available[index];
        if (!tap) continue;
        const delta = Math.abs(tap.frame - currentFrame);
        deltas[index] = delta;
        flow.buildPyramid(
          renderer,
          tap.texture,
          index + 1,
          [input.width, input.height],
          uvScale,
        );
        fields[index] = flow.solve(
          renderer,
          0,
          index + 1,
          index * 2,
          settings,
          project,
          delta,
        );
        const reverse = flow.solve(
          renderer,
          index + 1,
          0,
          index * 2 + 1,
          settings,
          project,
          delta,
        );
        reverseFields[index] = reverse;
      }
      let registrationReadbacks = 0;
      if (fields[0] && fields[1]) {
        fields = global.apply(
          renderer,
          flow.guides,
          flow.guideSize,
          flow.sources,
          fields,
          project,
          (settings.maxDisplacement * settings.sensitivity) / 100,
        );
        registrationReadbacks = 1;
      }
      for (let index = 0; index < 2; index++) {
        if (!available[index]) continue;
        const conf = flow.analyze(
          renderer,
          index,
          fields[index],
          reverseFields[index],
          project,
          deltas[index],
        );
        confidence[index] = conf.texture;
      }
      // A missing clip-boundary direction mirrors the available velocity.
      if (!fields[0]) {
        fields[0] = fields[1];
        confidence[0] = confidence[1];
        deltas[0] = -deltas[1];
      }
      if (!fields[1]) {
        fields[1] = fields[0];
        confidence[1] = confidence[0];
        deltas[1] = -deltas[0];
      }
      gl.draw(renderer, difference, first, {
        uSourceOnly: 0,
        uCurrent: input.texture,
        uBefore: (pair.previous || pair.next).texture,
        uAfter: (pair.next || pair.previous).texture,
        uPreviousConfidence: confidence[0],
        uNextConfidence: confidence[1],
        uSourceSize: [input.width, input.height],
        uActiveSize: processing,
      });
      const statistics = reduction(renderer, first, true);
      diagnostics.readbacks = 2 + registrationReadbacks;
      diagnostics.static = statistics[3] === 0;
      // Consistency failures include occlusion and aperture ambiguity. Only a
      // large residual after compensation is evidence for a scene cut.
      diagnostics.sceneCut = statistics[0] / 255 > 0.35;
      if (diagnostics.static || diagnostics.sceneCut) return copyInput();
      diagnostics.maxSpeed = (statistics[2] / 255) * 256;
      diagnostics.samples = math.sampleCount(
        settings.amount,
        diagnostics.maxSpeed,
        settings.quality,
      );
      diagnostics.reconstruction = blur.render(
        renderer,
        output,
        input.texture,
        fields,
        confidence,
        deltas,
        flow.size,
        flow.current,
        processing,
        project,
        uvScale,
        {
          ...settings,
          registration:
            fields[0] && fields[1] && pair.previous && pair.next
              ? global.accepted.texture
              : null,
        },
        diagnostics.maxSpeed,
        [
          (pair.previous || pair.next).texture,
          (pair.next || pair.previous).texture,
        ],
      );
      // Exposed scratch handles support direct, CM3-free GPU accuracy tests.
      diagnostics.constraints = flow.constraints;
      diagnostics.registration = global;
      diagnostics.anchors = flow.anchors;
      diagnostics.fields = fields;
      diagnostics.flowSize = flow.size;
      diagnostics.confidence = confidence;
    });
  }
  return {
    render,
    diagnostics,
    dispose: () => {
      gl.dispose();
      signature = null;
      allocatedRenderer = null;
    },
  };
}
module.exports = { create };
