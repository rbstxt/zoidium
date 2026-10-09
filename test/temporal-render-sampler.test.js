"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");

function host(adjustment) {
  class Vector4 { set(x, y, z, w) { Object.assign(this, { x, y, z, w }); return this; } }
  class Vector2 { set(x, y) { this.x = x; this.y = y; return this; } }
  class Texture {}
  class Target {
    constructor(width, height) {
      Object.assign(this, { width, height, viewport: new Vector4().set(0, 0, width, height) });
      this.texture = new Texture(); this.texture.target = this;
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
    async decodeFrame(time) { this.texture.frame = time * 30; decoded.push(time * 30); }
    prepare() {}
    unload() { this.disposed = true; }
  }
  class Compositor {
    constructor(renderer, w, h) {
      this.renderer = renderer;
      this.frames = [];
      this.readBuffer = new Target(w, h); this.writeBuffer = new Target(w, h);
      this.screenBuffers = [new Target(w, h)];
      this.copyPass = {
        uniforms: { tDiffuse: {}, opacity: {}, uvScale: { value: new Vector2().set(1, 1) } },
        render: (_renderer, target) => {
          target.value = this.copyPass.uniforms.tDiffuse.value.target.value;
          target.scale = [this.copyPass.uniforms.uvScale.value.x, this.copyPass.uniforms.uvScale.value.y];
        },
      };
    }
    set sequence(value) { this._sequence = value; }
    clear() { this.screenBuffers[0].value = 0; }
    renderSequence(frame) { this.frames.push(frame); }
    unload() {}
    renderEffects(effects) { for (const effect of effects) this.readBuffer.value += effect.add || 0; }
    renderLayer(layer) {
      this.readBuffer.viewport.set(0, 0, 40, 20);
      this.readBuffer.value = layer instanceof Layer.adjustment ? this.screenBuffers[0].value : layer.texture.frame;
      this.renderEffects(layer.effects, 0.5, 0.5);
      this.screenBuffers[0].value = this.readBuffer.value;
    }
  }
  const decoded = [];
  const source = new Layer();
  const owner = adjustment ? new Layer.adjustment() : source;
  const sourceClip = { start: 10, length: 100, object: source, properties: { time: { get: f => f / 30 } } };
  const ownerClip = adjustment ? { start: 5, length: 100, object: owner } : sourceClip;
  source.clip = sourceClip; owner.clip = ownerClip;
  const sequence = {
    properties: { rate: { get: () => 30 }, resolution: { get: () => [80, 40] } },
    videoTracks: (adjustment ? [sourceClip, ownerClip] : [ownerClip])
      .map(clip => ({ enabled: true, getCurrentClip: () => clip, layer: clip.object })),
    update() {},
    toJSON() { return { source: "fixture" }; },
    videoSchedules: [{ type: 0, items: [{ start: 10, length: 100, clip: sourceClip, media: { url: "video" } }] }],
  };
  const effect = {
    tryGetParentOfType: () => owner,
    update(f) { this._zoidiumFrameSamplerFrame = f; },
    _zoidiumFrameSampler: { getRequest: () => ({ count: 2, offsetFrames: -3, startOpacity: 1, decay: 1 }) },
  };
  owner.effects = [{ add: 100, update() {} }, effect, { add: 1000, update() {} }];
  const sandbox = { console, PZ: { layer: Layer, compositor: Compositor, schedule: Schedule, clip: class {}, sequence: class {},
    ui: { viewport: class { _render() { this.compositor.renderSequence(this.editor.playback.currentFrame); } } } }, THREE: { Texture, WebGLRenderTarget: Target, Color: class {} } };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync("plugins/core/temporal-render.js", "utf8"), sandbox);
  const state = sandbox.ZOIDIUM_TEMPORAL;
  const root = new Compositor({ setClearColor() {} }, 80, 40); root.sequence = sequence;
  root.renderSequence(30);
  const viewport = Object.create(sandbox.PZ.ui.viewport.prototype);
  viewport.compositor = root;
  viewport.editor = { playback: { currentFrame: 30 } };
  effect.prepare = (frame, context) => state.prepareFrameSamples(effect, frame, context);
  return { state, root, owner, source, ownerClip, effect, decoded, sequence, viewport };
}

for (const adjustment of [false, true]) {
  test(`sampler captures ${adjustment ? "lower composite" : "ordinary content"} at the requested clip-local time with only the prefix`, async () => {
    const h = host(adjustment);
    const liveTexture = h.source.texture;
    await h.state.prepareFrameSamples(h.effect, 20, { sequence: h.sequence });
    const prepared = h.state.frameSamplerRuntimes.get(h.root).prepared.get(h.effect);
    const frames = prepared.samples.map(s => s.frame);
    assert.deepEqual(Array.from(frames), [h.ownerClip.start + 17, h.ownerClip.start + 14]);
    assert.deepEqual(Array.from(prepared.samples, s => s.target.value), Array.from(frames, f => f - 10 + 100));
    assert.deepEqual(Array.from(prepared.samples[0].target.scale), [0.5, 0.5]);
    assert.equal(h.source.texture, liveTexture, "live decoder texture restored");
    assert.equal(liveTexture.frame, 99, "live media was never sought");
    assert.equal(h.owner.frame, 20, "owner restored to current local frame");
    h.root.unload();
    assert.ok(prepared.samples.every(s => s.target.disposed));
  });
}

test("clamped duplicate taps reuse one capture without changing their weights", async () => {
  const h = host(false);
  await h.state.prepareFrameSamples(h.effect, 1, { sequence: h.sequence });
  const samples = h.state.frameSamplerRuntimes.get(h.root).prepared.get(h.effect).samples;
  assert.equal(samples.length, 2);
  assert.equal(samples[0].target, samples[1].target);
  assert.equal(h.decoded.length, 1);
  assert.deepEqual(Array.from(samples, s => s.index), [1, 2]);
});

test("a nested batch reuses fixed anchors and invalidates them when project inputs change", async () => {
  const h = host(false);
  let revision = 0;
  h.sequence.toJSON = () => ({ revision });
  h.effect._zoidiumFrameSampler.getRequest = (_effect, frame) =>
    ({ count: 1, offsetFrames: 10 - frame, startOpacity: 1, decay: 1 });
  const runtime = h.state.frameSamplerRuntimes.get(h.root);
  // A runtime is normally created by the viewport before preparation starts.
  await h.state.prepareFrameSamples(h.effect, 20, { sequence: h.sequence });
  const active = runtime || h.state.frameSamplerRuntimes.get(h.root);
  active.previewPending = true;
  active.inputCacheKey = null;
  h.decoded.length = 0;
  await h.state.prepareFrameSamples(h.effect, 20, { sequence: h.sequence });
  const anchor = active.prepared.get(h.effect).samples[0].target;
  await h.state.prepareFrameSamples(h.effect, 21, { sequence: h.sequence });
  assert.equal(active.prepared.get(h.effect).samples[0].target, anchor);
  assert.equal(h.decoded.length, 1);
  revision += 1;
  await h.state.prepareFrameSamples(h.effect, 22, { sequence: h.sequence });
  assert.equal(h.decoded.length, 2, "an edited input invalidates the batch cache");
});

test("preview displays a completed sampled frame even after playback advances and reuses unchanged redraws", async () => {
  const h = host(false);
  h.viewport._render();
  h.viewport.editor.playback.currentFrame = 31;
  await new Promise(setImmediate);
  assert.equal(h.root.frames.at(-1), 30, "completed frame shown without waiting for a stationary playhead");
  h.viewport._render();
  await new Promise(setImmediate);
  assert.equal(h.root.frames.at(-1), 31);
  const decodes = h.decoded.length;
  h.viewport._render();
  await new Promise(setImmediate);
  assert.equal(h.decoded.length, decodes, "an unchanged paused redraw never resamples media");
});

test("neighbouring output frames reuse past taps without overwriting a reused sample", async () => {
  const h = host(false);
  h.effect._zoidiumFrameSampler.getRequest = () =>
    ({ count: 4, offsetFrames: -1, startOpacity: 1, decay: 1 });
  await h.state.prepareFrameSamples(h.effect, 20, { sequence: h.sequence });
  assert.equal(h.decoded.length, 4);
  const runtime = h.state.frameSamplerRuntimes.get(h.root);
  const old = runtime.prepared.get(h.effect).samples;
  await h.state.prepareFrameSamples(h.effect, 21, { sequence: h.sequence });
  const next = runtime.prepared.get(h.effect).samples;
  assert.equal(h.decoded.length, 5, "only the new source frame is decoded");
  assert.equal(next[1].target, old[0].target);
  assert.equal(next[2].target, old[1].target);
  assert.equal(next[3].target, old[2].target);
  assert.equal(next[0].target, old[3].target, "the expired tap's slot is recycled");
  assert.deepEqual(Array.from(next, sample => sample.target.value), [120, 119, 118, 117]);
  assert.equal(runtime.targets.size, 4, "history acceleration uses bounded memory");
});

test("a cached preview waits while another frame is being prepared", async () => {
  const h = host(false);
  h.viewport._render();
  await new Promise(setImmediate);
  const runtime = h.state.frameSamplerRuntimes.get(h.root);
  const count = h.root.frames.length;
  runtime.previewPending = true;
  h.viewport._render();
  assert.equal(h.root.frames.length, count, "do not draw temporarily sampled uniforms or textures");
  runtime.previewPending = false;
  h.viewport._render();
  assert.equal(h.root.frames.length, count + 1);
});

test("external preparation invalidates the preview's decoded-media binding", async () => {
  const h = host(false);
  h.viewport._render();
  await new Promise(setImmediate);
  const runtime = h.state.frameSamplerRuntimes.get(h.root);
  assert.ok(runtime.previewKey);
  await h.state.prepareFrameSamples(h.effect, 40, { frameSamplerRoot: h.root });
  assert.equal(runtime.previewKey, null);
  h.viewport._render();
  await new Promise(setImmediate);
  assert.ok(runtime.previewKey);
  assert.equal(h.root.frames.at(-1), 30);
});

test("ordinary sampler media uses a temporal source clock exactly once", async () => {
  const h = host(false);
  h.owner.effects[0]._zoidiumTemporal = {
    getOperator: () => ({ kind: "time-offset", enabled: true, offsetFrames: 5 }),
  };
  h.viewport._render();
  await new Promise(setImmediate);
  const prepared = h.state.frameSamplerRuntimes.get(h.root).prepared.get(h.effect);
  // Output local 20 maps to local 25. Taps are local 22 and 19; the media
  // preparation and owning-layer capture must not apply the offset again.
  assert.deepEqual(Array.from(prepared.samples, sample => sample.frame), [32, 29]);
  assert.deepEqual(h.decoded.slice(0, 2), [22, 19]);
  assert.deepEqual(Array.from(prepared.samples, sample => sample.target.value), [122, 119]);
});
