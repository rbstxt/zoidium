"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { host } = require("./helpers/temporal-sampler-host.cjs");

test("isolated preflight is awaited at the exact control clock before the synchronous getter", async () => {
  const h = host(false), calls = [];
  let ready = false, resume;
  h.effect._zoidiumFrameSampler = {
    async preflight(_effect, frame, context) {
      calls.push(["preflight", frame, context.frameSamplerDepth]);
      await new Promise(resolve => { resume = resolve; }); ready = true;
    },
    getRequest(_effect, frame) { assert.ok(ready); calls.push(["get", frame]); return null; },
  };
  const work = h.effect.prepare(20.125, { frameSamplerRoot: h.root });
  assert.deepEqual(calls, [["preflight", 20.125, 1]]);
  resume(); await work;
  assert.deepEqual(calls, [["preflight", 20.125, 1], ["get", 20.125]]);
});

test("a failed isolated preflight never calls the synchronous getter or decoder", async () => {
  const h = host(false);
  h.effect._zoidiumFrameSampler = {
    resourcePolicy: { check() {} },
    preflight() { throw new Error("LOCAL_DEPENDENCY_UNAVAILABLE: unavailable fixture"); },
    getRequest() { assert.fail("getter ran after failed preflight"); },
  };
  await assert.rejects(h.effect.prepare(20.5), /LOCAL_DEPENDENCY_UNAVAILABLE/);
  assert.equal(h.decoded.length, 0);
});

const E = require("../zoidium/community-effects");
const T = require("../zoidium/community-temporal");
const V = require("../zoidium/community-protocol");
const I = require("../zoidium/community-interpreter");
const Policy = require("../zoidium/community-resource-policy");
const declaration = require("../examples/community-filter/manifest.json").effects[0];
function temporalHost(adjustment = false) {
  const h = host(adjustment), e = h.effect;
  h.PZ.asset = { source: { FILE: 1 } };
  for (const layer of new Set([h.owner, h.source])) {
    layer.type = layer === h.owner && adjustment ? 1 : 0;
    layer.toJSON = () => ({ type: layer.type, effects: layer.effects });
  }
  for (const effect of h.owner.effects) if (effect !== e) {
    effect.type = 1; effect.pass = {}; effect.toJSON = () => ({ type: 1 });
  }
  h.sequence.videoSchedules[0].items[0].media = { source: 1, file: new Blob(["local fixture"]), url: "blob:local-video" };
  let prefixRevision = 0, computes = 0, compute;
  h.sequence.toJSON = () => ({ prefixRevision });
  const listeners = [];
  const project = { sequence: h.sequence, assets: { list: {} },
    ui: { onChanged: { watch: fn => listeners.push(fn) } },
    toJSON: () => ({ prefixRevision }) };
  h.sequence.parentProject = project;
  Object.assign(e, { parent: {}, parentProject: project, parentLayer: h.owner, type: declaration.id,
    properties: { "community-value-gain": { get: () => 1.5 } } });
  e.toJSON = () => ({ type: e.type });
  const instance = e._community = { declaration, generation: 1, frame: 0, receipt: null };
  e.update = frame => { instance.frame = frame; e._zoidiumFrameSamplerFrame = frame; };
  const cache = instance.temporal = T.install({ effect: e, instance, stamp: E.frameStamp, sameStamp: E.sameStamp,
    PZ: h.PZ, valid: () => e.parentProject === project && Boolean(e.parent),
    compute: async authority => {
      computes++;
      const result = compute ? await compute(authority) : (await I.evaluate(
        "function prepare(i){return {uniforms:{gain:i.properties.gain},temporal:{offsets:[-3,0],weights:[0.25,0.75]}}}",
        "prepareEffect", authority.input)).value;
      return V.result(result, declaration, "prepareEffect");
    } });
  const prepare = e.prepare;
  e.prepare = async (frame, context) => { try { await prepare(frame, context); } catch (error) { cache.clear(); throw error; } };
  function resolve(frame, scope, depth = 0) {
    h.owner.update(frame);
    h.state.contexts.push({ compositor: h.root, rootCompositor: h.root, outputFrame: frame + h.ownerClip.start,
      frameSamplerScope: scope, frameSamplerDepth: depth, resourcePolicy: cache.policy });
    try { return h.state.resolveFrameSamples(e); } finally { h.state.contexts.pop(); }
  }
  return { ...h, project, cache, resolve, computes: () => computes,
    setCompute: fn => { compute = fn; }, edit: () => { prefixRevision++; },
    history: () => listeners.forEach(fn => fn()),
    authority: (frame, scopeId = 0, depth = 1) => ({ frameSamplerRoot: h.root, controlFrame: frame,
      frameSamplerDepth: depth, scopeId, stageId: h.parts.layers.frameSamplerIdentity(e) }) };
}

test("guest fractional plans use isolated local decoders and GPU inputs on ordinary and adjustment layers", async () => {
  for (const adjustment of [false, true]) {
    const h = temporalHost(adjustment);
    await h.effect.prepare(20.125, { frameSamplerRoot: h.root });
    const taps = h.resolve(20.125);
    assert.equal(taps.length, 2);
    assert.deepEqual(Array.from(taps, s => s.frame), [h.ownerClip.start + 17.125, h.ownerClip.start + 20.125]);
    assert.equal(h.computes(), 1);
    assert.equal(h.cache.lookup(20.125, h.authority(20.125)).result.uniforms.gain, 1.5);
    assert.equal(h.cache.lookup(20.1250000001, h.authority(20.1250000001)), null);
    assert.equal(h.resolve(20.1250000001).length, 0, "nearby fractional requests have no previous-frame fallback");
    assert.ok(taps.every(sample => sample.texture === sample.target.texture));
  }
});

test("reversed seeks and repeated frames reuse only exact successful guest receipts and GPU captures", async () => {
  const h = temporalHost();
  for (const frame of [20.125, 19.75, 20.125]) {
    await h.effect.prepare(frame, { frameSamplerRoot: h.root });
    assert.equal(h.resolve(frame).length, 2);
  }
  assert.equal(h.computes(), 2);
  assert.equal(h.decoded.length, 4);
  h.edit();
  assert.equal(h.resolve(20.125).length, 0);
  await h.effect.prepare(20.125, { frameSamplerRoot: h.root });
  assert.equal(h.computes(), 3); assert.equal(h.decoded.length, 6);
  h.history();
  assert.equal(h.resolve(20.125).length, 0);
});

test("scope and nesting depth bind receipts and do not authorize synchronous recapture", async () => {
  const h = temporalHost(true), scope = { layer: h.owner, effect: {} };
  const context = { frameSamplerRoot: h.root, frameSamplerScope: scope, frameSamplerDepth: 1 };
  await h.effect.prepare(20.5, context);
  assert.equal(h.resolve(20.5, scope, 1).length, 2);
  assert.equal(h.resolve(20.5).length, 0);
  const scopeId = h.parts.layers.frameSamplerIdentity(scope.effect);
  assert.ok(h.cache.lookup(20.5, h.authority(20.5, scopeId, 2)));
  assert.equal(h.cache.lookup(20.5, h.authority(20.5, scopeId, 1)), null);
});

test("request reordering never publishes obsolete revisions or substitutes the last completed frame", async () => {
  const h = temporalHost();
  const resumes = new Map();
  h.setCompute(authority => new Promise(resolve => resumes.set(authority.input.frame,
    () => resolve({ uniforms: { gain: authority.input.frame } }))));
  const a = h.cache.preflight(h.effect, 1.25), b = h.cache.preflight(h.effect, 2.5);
  resumes.get(2.5)(); await b;
  assert.equal(h.cache.lookup(2.5).result.uniforms.gain, 2.5);
  assert.equal(h.cache.lookup(1.25), null);
  h.edit(); resumes.get(1.25)(); await a;
  assert.equal(h.cache.lookup(1.25), null);
  assert.equal(h.cache.lookup(2.5), null);
});

test("project, instance, asset identity, decoder revision, prefix edits and resize expire receipts", async () => {
  for (const change of [
    h => { h.effect.parentProject = { ...h.project }; },
    h => { h.effect._community.generation++; },
    h => { h.project.assets.list.media = { file: new Blob(["replacement"]), data: new Map() }; },
    h => { h.project.assets.list.media.data.get("image").zoidiumAssetRevision++; },
    h => h.edit(), h => { h.root.readBuffer.width++; }, h => { h.effect.parent = null; },
  ]) {
    const h = temporalHost();
    h.project.assets.list.media = { data: new Map([["image", { zoidiumAssetRevision: 0 }]]) };
    await h.cache.preflight(h.effect, 0.125, h.authority(0.125));
    assert.ok(h.cache.lookup(0.125, h.authority(0.125)));
    change(h);
    assert.equal(h.cache.lookup(0.125, h.authority(0.125)), null);
  }
});

test("pending duplicate frames share a job, failures clear prior successes, and failure results are never cached", async () => {
  for (const message of ["Community request timed out", "Community guest failed"]) {
    const h = temporalHost(); let resume;
    h.setCompute(() => new Promise(resolve => { resume = resolve; }));
    const a = h.cache.preflight(h.effect, 0.5), b = h.cache.preflight(h.effect, 0.5);
    assert.equal(h.computes(), 1); resume({ uniforms: { gain: 1.75 } }); await Promise.all([a, b]);
    const receipt = h.cache.lookup(0.5);
    assert.ok(Object.isFrozen(receipt.result.uniforms));
    h.setCompute(() => { throw new Error(message); });
    await assert.rejects(h.cache.preflight(h.effect, 1.25), new RegExp(message));
    assert.equal(h.cache.lookup(0.5), null); assert.equal(h.cache.lookup(1.25), null);
    assert.equal(h.effect._community.receipt, null);
    h.setCompute(() => ({ uniforms: { gain: 2 } }));
    await h.cache.preflight(h.effect, 1.25);
    assert.equal(h.computes(), 3);
  }
});

test("remote media is rejected before schedule construction, src assignment, or decoder calls", async () => {
  for (const adjustment of [false, true]) {
    const h = temporalHost(adjustment);
    h.sequence.videoSchedules[0].items[0].media = { source: 4, url: "https://sink.invalid/video.mp4" };
    let constructors = 0;
    h.PZ.schedule = class { constructor() { constructors++; assert.fail("remote schedule constructed"); } };
    await assert.rejects(h.effect.prepare(20.125, { frameSamplerRoot: h.root }), /LOCAL_DEPENDENCY_UNAVAILABLE/);
    assert.equal(constructors, 0); assert.equal(h.decoded.length, 0);
    assert.equal(h.effect._community.receipt, null);
  }
});

test("capture, cache reuse and decoder boundaries recheck the local-only policy", async () => {
  const h = temporalHost();
  await h.effect.prepare(20.125, { frameSamplerRoot: h.root });
  h.sequence.videoSchedules[0].items[0].media.url = "https://sink.invalid/range";
  await assert.rejects(h.parts.sampler.prepareLowerSchedules(h.sequence,
    { layer: h.owner, clip: h.ownerClip, trackIndex: 0 }, 30.125,
    { resourcePolicy: h.cache.policy }, h.parts.sampler.getFrameSamplerRuntime(h.state, h.root)), /LOCAL_DEPENDENCY_UNAVAILABLE/);
  const target = new h.sandbox.THREE.WebGLRenderTarget(80, 40);
  assert.throws(() => h.parts.capture.captureFrameSamplerInput(h.state, h.root,
    h.parts.sampler.getFrameSamplerRuntime(h.state, h.root),
    { layer: h.owner, clip: h.ownerClip, effect: h.effect, effectIndex: 1, trackIndex: 0 },
    30.125, 30.125, 1, target, [], { resourcePolicy: h.cache.policy }), /LOCAL_DEPENDENCY_UNAVAILABLE/);
  assert.equal(h.decoded.length, 2);
});

test("unsupported fonts, lazy compositions, shaders and expressions fail without invoking loaders", () => {
  const PZ = { layer: { adjustment: class {} }, asset: { source: { FILE: 1 } } };
  const policy = Policy.create({ PZ }); let loads = 0;
  const forbidden = () => { loads++; throw new Error("network operation"); };
  const base = () => ({ toJSON: () => ({ type: 4 }), effects: [], objects: [] });
  const cases = [
    () => ({ ...base(), objects: [{ toJSON: () => ({ type: 1 }), font: { getFont: forbidden, asset: { url: "https://sink.invalid/font" } } }] }),
    () => ({ ...base(), objects: [{ toJSON: () => ({ type: "zoidium:text-plus/text-plus" }), prepare: forbidden }] }),
    () => ({ ...base(), nestedTracks: forbidden }),
    () => ({ ...base(), vertShader: { data: { shader: null }, getShader: forbidden } }),
    () => ({ ...base(), effects: [{ toJSON: () => ({ type: 1, customProperties: [{ font: "https://sink.invalid/font" }] }), pass: {}, prepare: forbidden }] }),
    () => ({ ...base(), toJSON: () => ({ type: 4, properties: { expression: "fetch('https://sink.invalid')" } }) }),
    () => ({ ...base(), image: { data: { image: null }, getImage: forbidden } }),
  ];
  for (const make of cases) assert.throws(() => policy.assertLayer(make()), /LOCAL_DEPENDENCY_UNAVAILABLE/);
  assert.equal(loads, 0);
});

test("temporal offsets, weights and RGBA8 data are bounded before any host capture", () => {
  const good = { uniforms: {}, temporal: { offsets: [-120, 0.125, 120], weights: [0.25, 0.25, 0.5] } };
  V.result(good, declaration, "prepareEffect");
  for (const mutate of [
    r => { r.temporal.offsets[0] = -120.001; }, r => { r.temporal.offsets[0] = Infinity; },
    r => { r.temporal.offsets = Array(9).fill(0); r.temporal.weights = Array(9).fill(1 / 9); },
    r => { r.temporal.weights[0] = -1; }, r => { r.temporal.weights[0] = 0; },
    r => { r.temporal.url = "https://sink.invalid"; }, r => { r.temporal.offsets = []; },
    r => { r.textures = [{ id: "data", width: 1, height: 1, pixels: [0, 0, 0, 256] }]; },
    r => { r.textures = [{ id: "data", width: 1, height: 1, pixels: [0, 0, 0, 0], url: "https://sink.invalid" }]; },
  ]) { const value = structuredClone(good); mutate(value); assert.throws(() => V.result(value, declaration, "prepareEffect")); }
});

test("resident Composite and Precomp children prepare at exact mapped clocks without native content loaders", async () => {
  for (const precomp of [false, true]) {
    const h = temporalHost();
    const parent = new h.PZ.layer.composite();
    parent.type = 2; parent.clip = h.ownerClip; parent.objects = [h.owner];
    parent.toJSON = () => ({ type: 2, objects: [h.owner.toJSON()] });
    h.ownerClip.object = parent;
    h.sequence.videoTracks[0].clips = [h.ownerClip];
    const childClip = { start: 3.25, length: 100, object: h.owner };
    if (precomp) {
      parent.offset = 1.125;
      parent.nested = [{ clips: [childClip], enabled: true, getCurrentClip: () => childClip }];
      parent.nestedTracks = () => parent.nested;
      parent.setCompTime = () => {};
      h.owner.clip = childClip;
    }
    h.sequence.videoSchedules = [];
    const times = [];
    h.setCompute(authority => { times.push(authority.input.frame); return { uniforms: { gain: 1.5 } }; });
    const context = { frameSamplerRoot: h.root, resourcePolicy: h.cache.policy };
    await h.parts.capture.prepareChildren(parent, 20.125, context);
    assert.deepEqual(times, [precomp ? 18 : 20.125]);
    assert.equal(h.decoded.length, 0);
    assert.equal(h.effect._community.receipt.authority.input.frame, times[0]);
    if (precomp) {
      h.owner.effects.push({ toJSON: () => ({ type: "unsupported-font-effect" }), prepare() { assert.fail("unsupported prepare ran"); } });
      assert.throws(() => h.cache.policy.assertLayer(parent), /LOCAL_DEPENDENCY_UNAVAILABLE/);
    }
  }
});

test("an actual interpreter exception cannot leave a successful receipt or previous-frame plan", async () => {
  const h = temporalHost();
  await h.cache.preflight(h.effect, 0.125);
  h.setCompute(async authority => (await I.evaluate("function prepare(){throw new Error('VM failure')}", "prepareEffect", authority.input)).value);
  await assert.rejects(h.cache.preflight(h.effect, 0.25), /VM failure/);
  assert.equal(h.cache.lookup(0.125), null); assert.equal(h.cache.lookup(0.25), null);
});

const networkDescriptors = new Map();
let networkCalls = 0;
test.before(() => {
  for (const key of ["fetch", "XMLHttpRequest", "WebSocket", "FontFace", "Image"]) {
    networkDescriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true,
      value: function () { networkCalls++; throw new Error("Network sink reached"); } });
  }
});
test.after(() => {
  for (const [key, descriptor] of networkDescriptors) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
  }
  assert.equal(networkCalls, 0, "all local preparation, capture, media and font rejection paths use zero network APIs");
});
