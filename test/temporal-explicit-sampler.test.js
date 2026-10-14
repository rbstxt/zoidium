"use strict";

// The explicit per-tap frame sampler plan (Time Displacement slices, CC Wide
// Time steps) must flow through the core's prepare path on ordinary and on
// adjustment layers exactly like the legacy Echo plan. This mirrors the stub
// harness in test/temporal-render-sampler.test.js with a frames-style request.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");
const vm = require("node:vm");

function host({ adjustment, request }) {
  class Vector2 {
    set(x, y) { Object.assign(this, { x, y }); return this; }
  }
  class Vector4 {
    set(x, y, z, w) { Object.assign(this, { x, y, z, w }); return this; }
  }
  class Texture {}
  class Target {
    constructor(width, height) {
      Object.assign(this, { width, height, viewport: new Vector4().set(0, 0, width, height) });
      this.texture = new Texture();
      this.texture.target = this;
    }
    setSize(w, h) { this.width = w; this.height = h; }
    dispose() { this.disposed = true; }
  }
  class Layer {
    constructor() {
      this.effects = [];
      this.properties = { resolution: { get: () => [40, 20] } };
      this.texture = Object.assign(new Texture(), { frame: 99 });
    }
    tryGetParentOfType() { return this.clip; }
    getParentOfType() { return sequence; }
    update(f) { this.frame = f; for (const e of this.effects) e.update?.(f); }
  }
  Layer.adjustment = class extends Layer {};
  Layer.scene = class extends Layer {};
  Layer.composite = class extends Layer {};
  class Schedule {
    static type = { VIDEO: 0, NONE: 2 };
    constructor(type) { this.type = type; this.texture = new Texture(); this.items = []; }
    update() { this.currentItem = this.items[0]; }
    async decodeFrame(time) { this.texture.frame = time * 30; }
    prepare() {}
    unload() {}
  }
  class Compositor {
    constructor(renderer, w, h) {
      this.renderer = renderer;
      this.readBuffer = new Target(w, h);
      this.writeBuffer = new Target(w, h);
      this.screenBuffers = [new Target(w, h)];
      this.copyPass = {
        uniforms: { tDiffuse: {}, opacity: {}, uvScale: { value: new Vector2().set(1, 1) } },
        render: (_renderer, target) => {
          target.value = this.copyPass.uniforms.tDiffuse.value.target.value;
        },
      };
    }
    set sequence(value) { this._sequence = value; }
    clear() {}
    renderSequence() {}
    unload() {}
    renderEffects(effects) { for (const effect of effects) this.readBuffer.value += effect.add || 0; }
    renderLayer(layer) {
      this.readBuffer.value = layer instanceof Layer.adjustment ? this.screenBuffers[0].value : layer.texture.frame;
      this.renderEffects(layer.effects, 0.5, 0.5);
      this.screenBuffers[0].value = this.readBuffer.value;
    }
  }
  const source = new Layer();
  const owner = adjustment ? new Layer.adjustment() : source;
  const sourceClip = { start: 10, length: 100, object: source, properties: { time: { get: (f) => f / 30 } } };
  const ownerClip = adjustment ? { start: 5, length: 100, object: owner } : sourceClip;
  source.clip = sourceClip;
  owner.clip = ownerClip;
  const sequence = {
    properties: { rate: { get: () => 30 }, resolution: { get: () => [80, 40] } },
    videoTracks: (adjustment ? [sourceClip, ownerClip] : [ownerClip])
      .map((clip) => ({ enabled: true, getCurrentClip: () => clip, layer: clip.object })),
    update() {},
    toJSON() { return { source: "fixture" }; },
    videoSchedules: [],
  };
  const effect = {
    tryGetParentOfType: () => owner,
    update(f) { this._zoidiumFrameSamplerFrame = f; },
    _zoidiumFrameSampler: { getRequest: () => request },
  };
  owner.effects = [{ add: 100, update() {} }, effect, { add: 1000, update() {} }];
  const sandbox = {
    console,
    PZ: {
      layer: Layer,
      compositor: Compositor,
      schedule: Schedule,
      clip: class {},
      sequence: class {},
      ui: { viewport: class {} },
    },
    THREE: { Texture, WebGLRenderTarget: Target, Color: class {} },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  for (const relative of [
    "zoidium/shared/random.js",
    "zoidium/shared/props.js",
    "zoidium/shared/color.js",
    "zoidium/shared/gl.js",
    "zoidium/shared/json.js",
    "zoidium/shared/windows.js",
    "zoidium/plugin-apis.js",
    "plugins/core/temporal-math.js",
    "plugins/core/temporal-layers.js",
    "plugins/core/temporal-sampler.js",
    "plugins/core/temporal-render.js",
  ]) {
    vm.runInContext(fs.readFileSync(relative, "utf8"), sandbox, { filename: relative });
  }
  const state = sandbox.ZOIDIUM_TEMPORAL;
  const root = new Compositor({ setClearColor() {} }, 80, 40);
  root.sequence = sequence;
  root.renderSequence(20);
  effect.prepare = (frame, context) => state.prepareFrameSamples(effect, frame, context);
  return { state, root, owner, ownerClip, effect, sequence };
}

// A Time Displacement style request: 5 slices over +/-60 frames at 30 fps.
const displacementRequest = { enabled: true, frames: [-60, -30, 0, 30, 60] };
// A CC Wide Time style request: 2 backward + 3 forward single-frame steps.
const wideTimeRequest = { enabled: true, frames: [-2, -1, 1, 2, 3] };

for (const adjustment of [false, true]) {
  for (const [name, request] of [["displacement", displacementRequest], ["widetime", wideTimeRequest]]) {
    test(`${name} explicit taps prepare on ${adjustment ? "adjustment" : "ordinary"} layers`, async () => {
      const h = host({ adjustment, request });
      await h.state.prepareFrameSamples(h.effect, 20, { sequence: h.sequence });
      const prepared = h.state.frameSamplerRuntimes.get(h.root).prepared.get(h.effect);
      assert.ok(prepared, "taps prepared");
      const frames = prepared.samples.map((s) => s.frame);
      // Taps clamp to the clip's local bounds like the Echo plan, then map
      // back to project frames.
      const expected = request.frames.map((offset) => {
        const local = Math.min(100 - 1e-9, Math.max(0, 20 + offset));
        return h.ownerClip.start + local;
      });
      assert.deepEqual(Array.from(frames), expected);
      assert.deepEqual(
        Array.from(prepared.samples, (s) => s.index),
        request.frames.map((_, index) => index),
      );
      assert.ok(prepared.samples.every((s) => s.opacity === 1));
      assert.equal(h.owner.frame, 20, "owner restored to current local frame");
      h.root.unload();
    });
  }
}

test("explicit taps clamp to the clip bounds", async () => {
  const h = host({ adjustment: false, request: { enabled: true, frames: [-500, 0, 500] } });
  await h.state.prepareFrameSamples(h.effect, 20, { sequence: h.sequence });
  const prepared = h.state.frameSamplerRuntimes.get(h.root).prepared.get(h.effect);
  const frames = prepared.samples.map((s) => s.frame);
  // Clip starts at 10 with length 100: local taps clamp to [0, 100).
  assert.deepEqual(Array.from(frames), [10, 30, 10 + 100 - 1e-9]);
  h.root.unload();
});
