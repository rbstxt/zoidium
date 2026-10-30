"use strict";
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
  Layer.composite = class extends Layer {
    update(frame) { super.update(frame); for (const child of this.objects || []) child.update(frame); }
  };
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
    setSize(w, h) { this.readBuffer.setSize(w, h); this.writeBuffer.setSize(w, h); }
    clear() { this.screenBuffers[0].value = 0; }
    renderSequence(frame) { this.frames.push(frame); }
    unload() {}
    renderEffects(effects) { for (const effect of effects) this.readBuffer.value += effect.add || 0; }
    renderLayer(layer) {
      this.readBuffer.viewport.set(0, 0, 40, 20);
      this.readBuffer.value = layer instanceof Layer.adjustment ? this.screenBuffers[0].value : layer.objects?.[0]?.frame ?? layer.texture.frame;
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
    ui: { playback: class { updateSchedule() { this.nativeUpdates = (this.nativeUpdates || 0) + 1; } }, viewport: class { _render() { this.compositor.renderSequence(this.editor.playback.currentFrame); } } } }, THREE: { Texture, WebGLRenderTarget: Target, Color: class {} } };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  // The shared overlay scripts load before any plugin code runs, so the
  // temporal core sees the attached tables here too.
  for (const relative of [
    "zoidium/shared/random.js",
    "zoidium/shared/props.js",
    "zoidium/shared/color.js",
    "zoidium/shared/gl.js",
    "zoidium/shared/json.js",
    "zoidium/shared/windows.js",
    "zoidium/plugin-apis.js",
  ]) {
    vm.runInContext(fs.readFileSync(relative, "utf8"), sandbox, { filename: relative });
  }
  for (const relative of [
    "plugins/core/temporal-math.js",
    "plugins/core/temporal-layers.js",
    "plugins/core/temporal-capture.js",
    "plugins/core/temporal-sampler.js",
    "plugins/core/temporal-export.js",
    "plugins/core/temporal-render.js",
  ]) {
    vm.runInContext(fs.readFileSync(relative, "utf8"), sandbox, { filename: relative });
  }
  const state = sandbox.ZOIDIUM_TEMPORAL;
  const root = new Compositor({ setClearColor() {} }, 80, 40); root.sequence = sequence;
  root.renderSequence(30);
  const viewport = Object.create(sandbox.PZ.ui.viewport.prototype);
  viewport.compositor = root;
  viewport.editor = { playback: { currentFrame: 30 } };
  effect.prepare = (frame, context) => state.prepareFrameSamples(effect, frame, context);
  return { state, root, owner, source, ownerClip, effect, decoded, sequence, viewport, PZ: sandbox.PZ, sandbox,
    parts: sandbox.__zoidiumTemporalParts };
}

module.exports = { host };
