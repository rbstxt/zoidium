"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const math = require("../plugins/native-fx/smart-motion-blur/math.js");

test("Smart Motion Blur has stable serialized properties and native identity", () => {
  assert.equal(math.ID, "smartmotionblur");
  const props = math.properties({ NUMBER: 42, OPTION: 43 });
  assert.deepEqual(Object.keys(props), [
    "amount",
    "sensitivity",
    "smoothness",
    "maxDisplacement",
    "analysis",
    "quality",
    "view",
  ]);
  assert.deepEqual(
    Object.values(props).map((property) => property.value),
    [0.5, 70, 50, 256, 0, 0, 0],
  );
  assert.ok(Object.values(props).every((property) => property.dynamic));
  assert.equal(props.analysis.items, "Both;Previous;Next");
  assert.equal(props.quality.items, "Balanced;High");
  assert.equal(props.view.items, "Result;Motion Vectors;Confidence");
  const manifest = JSON.parse(
    fs.readFileSync(path.join(__dirname, "../plugins/native-fx/manifest.json")),
  );
  assert.equal(
    manifest.nativeEffects.find((e) => e.id === math.ID).name,
    math.DISPLAY_NAME,
  );
});

test("shutter taps use project frames, centered midpoint quadrature and a single shutter span", () => {
  assert.deepEqual(math.offsets(0), [-1, 1]);
  assert.deepEqual(math.offsets(1), [-1]);
  assert.deepEqual(math.offsets(2), [1]);
  for (const amount of [0, 0.25, 0.5, 1]) {
    const times = math.shutterTimes(amount, 32);
    assert.ok(times.every((t) => Math.abs(t) <= amount / 2));
    assert.equal(times[0], -times.at(-1));
    assert.ok(Math.abs(times.reduce((a, b) => a + b, 0)) < 1e-12);
    assert.ok(Math.abs(times.at(-1) - times[0] + amount / 32 - amount) < 1e-12);
  }
});

test("adaptive sampling uses displacement, shutter and quality with fixed bounds", () => {
  assert.equal(math.sampleCount(0.5, 64, 0), 16);
  assert.equal(math.sampleCount(1, 256, 0), 32);
  assert.equal(math.sampleCount(1, 256, 1), 64);
  assert.equal(math.sampleCount(0.25, 1, 1), 8);
});

test("fixed point fields preserve exact zero and signed extremes", () => {
  assert.deepEqual(math.pack([0, 0]), [128, 0, 128, 0]);
  assert.deepEqual(math.unpack(math.pack([0, 0])), [0, 0]);
  for (
    let componentValue = -256;
    componentValue <= 256;
    componentValue += 0.137
  ) {
    const vector = [componentValue, -componentValue];
    const decoded = math.unpack(math.pack(vector));
    assert.ok(
      decoded.every(
        (value, i) => Math.abs(value - vector[i]) <= 256 / 65534 + 1e-12,
      ),
    );
  }
  assert.deepEqual(math.unpack(math.pack([-256, 256])), [-256, 256]);
});

test("duplicate boundary taps never create fictitious directions", () => {
  assert.deepEqual(math.neighbors([{ frame: 0 }, { frame: 1 }], 0), {
    previous: null,
    next: { frame: 1 },
  });
  assert.deepEqual(math.neighbors([{ frame: 9 }, { frame: 10 - 1e-9 }], 10), {
    previous: { frame: 9 },
    next: null,
  });
  assert.deepEqual(math.neighbors([{ frame: 7 }, { frame: 7 }], 7), {
    previous: null,
    next: null,
  });
  assert.deepEqual(math.neighbors([{ frame: 50 }, { frame: 52 }], 51), {
    previous: { frame: 50 },
    next: { frame: 52 },
  });
});

test("preview and export distances scale independently on both axes", () => {
  for (const processing of [
    [1920, 1080],
    [960, 540],
    [480, 270],
    [240, 135],
    [1000, 563],
  ]) {
    const ratio = math.scale(processing, [1920, 1080]);
    const value = [128, -32];
    const output = math.toProject(math.toProcessing(value, ratio), ratio);
    assert.ok(output.every((n, i) => Math.abs(n - value[i]) < 1e-12));
  }
  assert.equal(math.pyramidSizes(1920, 1080).length, 6);
  assert.deepEqual(math.pyramidSizes(1, 1), [[1, 1]]);
});

test("GL state is restored when an optical-flow pass throws", () => {
  const gl = require("../plugins/native-fx/smart-motion-blur/gl.js").create(
    {},
    {},
    () => "",
  );
  const state = { target: { name: "caller" }, color: { r: 0.2 }, alpha: 0.7 };
  const renderer = {
    autoClear: false,
    getRenderTarget() {
      return state.target;
    },
    getClearColor() {
      return { clone: () => state.color };
    },
    getClearAlpha() {
      return state.alpha;
    },
    setRenderTarget(value) {
      state.target = value;
    },
    setClearColor(color, alpha) {
      state.color = color;
      state.alpha = alpha;
    },
  };
  const target = state.target,
    color = state.color;
  assert.throws(
    () =>
      gl.preserve(renderer, () => {
        renderer.setRenderTarget({ name: "scratch" });
        throw new Error("pass failure");
      }),
    /pass failure/,
  );
  assert.equal(renderer.autoClear, false);
  assert.equal(state.target, target);
  assert.equal(state.color, color);
  assert.equal(state.alpha, 0.7);
});

test("half-float selection checks filtering, framebuffer completeness, and disposes its probe", () => {
  const disposed = [];
  const gl = require("../plugins/native-fx/smart-motion-blur/gl.js").create(
    { HalfFloatType: 1, RGBAFormat: 2, LinearFilter: 3 },
    {
      createRenderTarget() {
        return {
          dispose() {
            disposed.push(true);
          },
        };
      },
    },
    () => "",
  );
  const caller = {};
  let target = caller;
  const renderer = {
    extensions: { get: () => ({}) },
    getRenderTarget: () => target,
    setRenderTarget: (value) => {
      target = value;
    },
    getContext: () => ({
      FRAMEBUFFER: 1,
      FRAMEBUFFER_COMPLETE: 2,
      checkFramebufferStatus: () => 2,
    }),
  };
  assert.equal(gl.selectStorage(renderer, false), "half");
  assert.equal(target, caller);
  assert.equal(disposed.length, 1);
  assert.equal(gl.selectStorage(renderer, true), "rgba8");
  assert.equal(disposed.length, 1);
  renderer.getContext = () => ({
    FRAMEBUFFER: 1,
    FRAMEBUFFER_COMPLETE: 2,
    checkFramebufferStatus: () => 0,
  });
  assert.equal(gl.selectStorage(renderer, false), "rgba8");
  assert.equal(target, caller);
  assert.equal(disposed.length, 2);
});

test("native entry uses the bundle loader, project tap times, and exact active UV scale", () => {
  let spec, rendered;
  const getAsset = () => "bundled";
  const effect = {
    _zoidiumGetAsset: getAsset,
    _zoidiumFrameSamplerFrame: 7,
    parentProject: { sequence: {} },
    parentLayer: {
      tryGetParentOfType: () => ({ start: 40 }),
      properties: { resolution: { get: () => [1920, 1080] } },
    },
    properties: { load() {} },
  };
  const pipeline = {
    create() {
      return {
        render(...args) {
          rendered = args;
        },
        dispose() {},
      };
    },
  };
  const api = {
    gl: {},
    modules: {
      createRequire(resolver, options) {
        assert.equal(typeof resolver, "function");
        assert.equal(options.root, "./plugins/native-fx/smart-motion-blur/");
        return (name) => (name === "./math.js" ? math : pipeline);
      },
    },
    defineFrameSampler(value) {
      spec = value;
      Object.assign(this, value.lifecycle);
    },
  };
  const PZ = {
    clip: class {},
    property: { type: { NUMBER: 1, OPTION: 2 } },
    zoidium: {
      temporal: { resolveFrameSamples: () => [{ frame: 46 }, { frame: 48 }] },
    },
  };
  const THREE = {
    Vector2: class {
      constructor(horizontal, vertical) {
        this.x = horizontal;
        this.y = vertical;
      }
    },
  };
  const source = fs.readFileSync(
    path.join(__dirname, "../plugins/native-fx/effects/smartmotionblur.js"),
    "utf8",
  );
  new Function("PZ", "THREE", "ZoidiumPluginApis", source).call(
    effect,
    PZ,
    THREE,
    api,
  );
  effect.load({});
  effect.pass.uniforms.uvScale.value = { x: 0.5, y: 0.25 };
  effect.pass.render({}, {}, { width: 1024, height: 1024 });
  assert.equal(rendered[4], 47);
  assert.deepEqual(rendered[5], [1920, 1080]);
  assert.deepEqual(rendered[6], [0.5, 0.25]);
  assert.deepEqual(spec.getRequest(effect, 7).frames, [-1, 1]);
  assert.equal(/\bfetch\s*\(/.test(source), false);
});

test("flow scheduling preserves image identity, pyramid dimensions, and separate ping-pong targets", () => {
  const createFlow =
    require("../plugins/native-fx/smart-motion-blur/flow.js").create;
  for (const packed of [false, true]) {
    const draws = [];
    const gl = {
      packed,
      pass(name) {
        return { name };
      },
      target(width, height) {
        return { width, height, texture: { width, height, origin: null } };
      },
      draw(renderer, pass, output, uniforms) {
        for (const value of Object.values(uniforms)) {
          assert.notEqual(
            value,
            output.texture,
            "a pass cannot sample its own destination",
          );
        }
        if (pass.name === "pyramid")
          output.texture.origin = uniforms.uImage.origin;
        draws.push({ pass: pass.name, output, uniforms });
      },
    };
    const flow = createFlow(gl);
    flow.allocate(768, 512);
    const origins = ["current", "previous", "next"];
    for (let imageIndex = 0; imageIndex < origins.length; imageIndex++) {
      flow.buildPyramid(
        {},
        { origin: origins[imageIndex] },
        imageIndex,
        [768, 512],
        [1, 1],
      );
    }
    const levels = math.pyramidSizes(768, 512);
    const pyramidDraws = draws.filter((draw) => draw.pass === "pyramid");
    assert.equal(pyramidDraws.length, levels.length * origins.length);
    for (let imageIndex = 0; imageIndex < origins.length; imageIndex++) {
      for (let levelIndex = 0; levelIndex < levels.length; levelIndex++) {
        const draw = pyramidDraws[imageIndex * levels.length + levelIndex];
        assert.equal(draw.output.texture.origin, origins[imageIndex]);
        assert.deepEqual(
          [draw.output.width, draw.output.height],
          levels[levelIndex],
        );
      }
    }
    const output = flow.solve(
      {},
      0,
      2,
      0,
      {
        sensitivity: 100,
        maxDisplacement: 256,
        smoothness: 50,
        quality: 0,
      },
      [768, 512],
      1,
    );
    assert.deepEqual([output.width, output.height], levels[0]);
    for (const draw of draws.filter((draw) =>
      ["seed", "refine"].includes(draw.pass),
    )) {
      assert.equal(draw.uniforms.uCurrent.origin, "current");
      assert.equal(draw.uniforms.uOther.origin, "next");
      assert.deepEqual(
        [draw.uniforms.uCurrent.width, draw.uniforms.uCurrent.height],
        draw.uniforms.uSize,
      );
      assert.deepEqual(
        [draw.uniforms.uOther.width, draw.uniforms.uOther.height],
        draw.uniforms.uSize,
      );
    }
  }
});

test("shutter batches preserve every sample weight when the count is not divisible by four", () => {
  for (let count = 8; count <= 64; count++) {
    const batches = math.sampleBatches(count);
    const weights = [];
    for (const batch of batches) {
      assert.ok(batch.end > batch.start);
      for (let index = batch.start; index < batch.end; index++) {
        weights[index] = batch.weight / (batch.end - batch.start);
      }
    }
    assert.equal(weights.length, count);
    assert.ok(weights.every((weight) => Math.abs(weight - 1 / count) < 1e-15));
    assert.ok(
      Math.abs(batches.reduce((sum, batch) => sum + batch.weight, 0) - 1) <
        1e-15,
    );
  }
});

test("constraint stages preserve the seed and never read their own destination", () => {
  for (const packed of [false, true]) {
    for (const size of [
      [1, 1],
      [768, 512],
    ]) {
      const draws = [];
      const gl = {
        packed,
        pass: (name) => ({ name }),
        target: (width, height) => ({ width, height, texture: {} }),
        draw(renderer, pass, output, uniforms) {
          for (const value of Object.values(uniforms)) {
            assert.notEqual(value, output.texture);
          }
          draws.push({ name: pass.name, output, uniforms });
        },
      };
      const flow =
        require("../plugins/native-fx/smart-motion-blur/flow.js").create(gl);
      flow.allocate(...size);
      for (let index = 0; index < 3; index++)
        flow.buildPyramid({}, {}, index, size, [1, 1]);
      flow.solve(
        {},
        0,
        1,
        0,
        {
          sensitivity: 100,
          maxDisplacement: 256,
          smoothness: 50,
          quality: 0,
        },
        size,
        1,
      );
      const stages = draws.filter((draw) => draw.name === "constraints");
      assert.deepEqual(
        stages.slice(0, 34).map((draw) => draw.uniforms.uSearchStage),
        Array.from({ length: 34 }, (_, index) => index - 1),
      );
      const seed = stages[0].uniforms.uSeed;
      for (let index = 1; index <= 33; index++) {
        assert.equal(stages[index].uniforms.uSeed, seed);
        assert.equal(stages[index].uniforms.uState, stages[0].output.texture);
        if (index > 1)
          assert.equal(
            stages[index].uniforms.uFlow,
            stages[index - 1].output.texture,
          );
      }
      assert.equal(stages.length, packed ? 35 : 34);
    }
  }
});
