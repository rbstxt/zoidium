"use strict";
require("./migrate-test-apis.js").ensureMainRealmApis();
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs");
const { create } = require("../plugins/magic-looks/looks-passes.js");
const Looks = {};
for (const file of ["looks-color.js", "looks-tools.js"]) {
  new Function("Looks", fs.readFileSync(require.resolve("../plugins/magic-looks/" + file), "utf8"))(Looks);
}
function harness() {
  const draws = [], targets = [], stages = new Map();
  let materialDisposals = 0, materials = 0;
  class Vector2 { constructor(x, y) { this.set(x, y); } set(x, y) { this.x = x; this.y = y; } }
  class ShaderMaterial { constructor(options) { materials++; Object.assign(this, options); } dispose() { materialDisposals++; } }
  class ShaderPass {
    constructor(material) { this.material = material; this.uniforms = material.uniforms; }
    render(renderer, output, input) {
      draws.push({ input, output, scale: [this.uniforms.uvScale.value.x, this.uniforms.uvScale.value.y],
        straightInput: this.uniforms.mlInputStraight.value, straightOutput: this.uniforms.mlOutputStraight.value });
    }
  }
  class WebGLRenderTarget {
    constructor(width, height, options) {
      this.setSize(width, height); this.texture = {}; this.options = options; this.disposals = 0; targets.push(this);
    }
    setSize(width, height) { this.width = width; this.height = height; }
    dispose() { this.disposals++; }
  }
  const THREE = { Vector2, ShaderPass, ShaderMaterial, WebGLRenderTarget, HalfFloatType: 42 };
  const effect = { properties: { enabled: { get: () => 1 } },
    pass: { uniforms: { uvScale: { value: new Vector2(.5, .5) } } },
    parentLayer: { properties: { resolution: { get: () => [48, 32] } } },
    looksInstances: { order: [{ id: "i1", tool: "contrast" }, { id: "i2", tool: "lens-distortion" }, { id: "i3", tool: "curves" }] },
  };
  const getAsset = (kind, path) => fs.readFileSync(require.resolve("../plugins/magic-looks/" + path.split("/").pop()), "utf8");
  const pipeline = create(effect, THREE, Looks.tools, getAsset, instance => {
    const stage = { active: true, disposals: 0, _looksActiveTools: {}, pass: { uniforms: {} },
      update(frame) { this._looksActiveTools[instance.tool] = this.active; this.frame = frame; },
      async prepare(frame) { this.prepared = frame; }, unload() { this.disposals++; } };
    stages.set(instance.id, stage); return stage;
  });
  return { effect, pipeline, targets, stages, draws, materials: () => materials, materialDisposals: () => materialDisposals };
}
test("multipass routing samples each previous output and converts alpha only at chain boundaries", async () => {
  const h = harness(), input = { width: 96, height: 64, texture: {} }, output = {};
  await h.pipeline.prepare(12); h.pipeline.update(12); h.pipeline.render({}, output, input);
  assert.equal(h.draws.length, 3);
  assert.equal(h.draws[0].input, input);
  assert.equal(h.draws[1].input, h.draws[0].output);
  assert.equal(h.draws[2].input, h.draws[1].output);
  assert.equal(h.draws[2].output, output);
  assert.deepEqual(h.draws.map(draw => draw.scale), [[.5, .5], [1, 1], [1, 1]]);
  assert.deepEqual(h.draws.map(draw => [draw.straightInput, draw.straightOutput]), [[0, 1], [1, 1], [1, 0]]);
  assert.ok(Array.from(h.stages.values()).every(stage => stage.prepared === 12 && stage.frame === 12));
  assert.equal(h.targets.length, 2);
  assert.ok(h.targets.every(target => target.width === 48 && target.height === 32 && target.options.type === 42));
  h.pipeline.update(50); h.pipeline.render({}, output, input);
  assert.equal(h.targets.length, 2, "frames reuse the existing targets");
  h.pipeline.render({}, output, { width: 48, height: 32, texture: {} });
  assert.ok(h.targets.every(target => target.width === 24 && target.height === 16));
  h.pipeline.dispose(); h.pipeline.dispose();
  assert.ok(h.targets.every(target => target.disposals === 1));
  assert.ok(Array.from(h.stages.values()).every(stage => stage.disposals === 1));
  assert.ok(h.materialDisposals() > 0);
});
test("neutral samples reuse compiled signatures and scratch storage", () => {
  const h = harness(), input = { width: 96, height: 64, texture: {} };
  h.pipeline.update(0); h.pipeline.render({}, {}, input);
  h.stages.get("i2").active = false; h.pipeline.update(1);
  h.draws.length = 0; h.pipeline.render({}, {}, input);
  assert.equal(h.draws.length, 1);
  assert.equal(h.draws[0].input, input);
  assert.ok(h.targets.every(target => target.disposals === 0));
  const materials = h.materials();
  for (let frame = 2; frame < 30; frame++) {
    h.stages.get("i2").active = frame % 2 === 0;
    h.pipeline.update(frame); h.pipeline.render({}, {}, input);
  }
  assert.equal(h.materials(), materials, "alternating samples allocate no materials after warmup");
  assert.equal(h.targets.length, 2);
  assert.equal(h.materialDisposals(), 0);
  h.pipeline.dispose();
  assert.equal(h.materialDisposals(), materials);
});

test("master disable skips stage updates and preparation, then evaluates the requested time on re-enable", async () => {
  const h = harness(); h.pipeline.update(1);
  await h.pipeline.prepare(1);
  h.effect.properties.enabled.get = () => 0;
  h.pipeline.update(40); await h.pipeline.prepare(40);
  assert.equal(h.effect.pass.enabled, false);
  assert.ok([...h.stages.values()].every(stage => stage.frame === 1 && stage.prepared === 1));
  h.effect.properties.enabled.get = () => 1;
  h.pipeline.update(40); await h.pipeline.prepare(40);
  assert.ok([...h.stages.values()].every(stage => stage.frame === 40 && stage.prepared === 40));
  h.pipeline.dispose();
});

test("signature cache is bounded and authored chain changes release it", () => {
  const h = harness();
  h.effect.looksInstances.order = Array.from({ length: 8 }, (_, i) => ({ id: "i" + (i + 1), tool: "contrast" }));
  h.pipeline.update(0);
  for (let mask = 1; mask < 256; mask++) {
    for (let i = 0; i < 8; i++) h.stages.get("i" + (i + 1)).active = !!(mask & (1 << i));
    h.pipeline.update(mask);
    assert.ok(h.materials() - h.materialDisposals() <= 128);
  }
  const oldStages = [...h.stages.values()], count = h.materials();
  h.effect.looksInstances.order.reverse(); h.pipeline.update(1);
  assert.equal(h.materialDisposals(), count);
  assert.ok(oldStages.every(stage => stage.disposals === 1));
  h.pipeline.dispose();
});
