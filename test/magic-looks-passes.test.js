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
  let materialDisposals = 0;
  class Vector2 { constructor(x, y) { this.set(x, y); } set(x, y) { this.x = x; this.y = y; } }
  class ShaderMaterial { constructor(options) { Object.assign(this, options); } dispose() { materialDisposals++; } }
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
  return { effect, pipeline, targets, stages, draws, materialDisposals: () => materialDisposals };
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
test("disabling a spatial stage allows fusion and releases unneeded target storage", () => {
  const h = harness(), input = { width: 96, height: 64, texture: {} };
  h.pipeline.update(0); h.pipeline.render({}, {}, input);
  h.stages.get("i2").active = false; h.pipeline.update(1);
  h.draws.length = 0; h.pipeline.render({}, {}, input);
  assert.equal(h.draws.length, 1);
  assert.equal(h.draws[0].input, input);
  assert.ok(h.targets.every(target => target.disposals === 1));
  h.pipeline.dispose();
});
