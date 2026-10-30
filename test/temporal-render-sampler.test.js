"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");

const { host } = require("./helpers/temporal-sampler-host.cjs");

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
  h.parts.sampler.invalidateFrameSamplerInputs(active);
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
  assert.notEqual(next[0].target, old[3].target, "past taps remain available for short backward scrubs");
  assert.deepEqual(Array.from(next, sample => sample.target.value), [120, 119, 118, 117]);
  assert.equal(runtime.targets.size, 5, "one new pure input retained");
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

function temporal(kind, value) {
  return { update() {}, _zoidiumTemporal: { getOperator: () => ({ kind,
    ...(kind === "posterize-time" ? { fps: value } : { offsetFrames: value }) }) } };
}

test("legacy taps match 430a52c^ in ordinary and adjustment stacks, prepared and synchronous", async () => {
  const fixture = require("./fixtures/legacy-temporal-outputs.json");
  for (const sample of fixture.outputs) {
    const make = () => {
      const h = host(sample.adjustment);
      h.effect.zoidiumTemporalMode = "legacy";
      h.owner.effects = [...sample.operators.map(([kind, value]) => temporal(kind, value)), h.effect];
      h.effect._zoidiumFrameSampler.getRequest = () => ({ count: 4, offsetFrames: -3 });
      return h;
    };
    const h = make();
    await h.state.prepareFrameSamples(h.effect, sample.localFrame, {});
    const samples = h.state.frameSamplerRuntimes.get(h.root).prepared.get(h.effect).samples;
    assert.deepEqual(h.decoded, sample.decoded);
    assert.deepEqual(Array.from(samples, s => s.frame), sample.frames);
    assert.deepEqual(Array.from(samples, s => s.target.value), sample.values);
    h.root.unload();
    const s = make(), update = s.source.update;
    s.source.update = function (frame) { update.call(this, frame); this.texture.frame = this.frame; };
    s.owner.update(sample.localFrame);
    s.state.contexts.push({ compositor: s.root, rootCompositor: s.root, outputFrame: s.ownerClip.start + sample.localFrame });
    const sync = s.state.resolveFrameSamples(s.effect);
    s.state.contexts.pop();
    assert.deepEqual(Array.from(sync, tap => tap.frame), sample.syncFrames);
    assert.deepEqual(Array.from(sync, tap => tap.target.value), sample.syncValues);
    assert.equal(s.state.evaluatingLayers.has(s.owner), false);
    s.root.unload();
  }
});

test("sampler input revisions include the effective mode even when its own serialization is cut", async () => {
  for (const scoped of [false, true]) {
    const h = scoped ? scopedHost() : host(false);
    h.owner.effects[0] = temporal("posterize-time", 12);
    h.owner.effects[0].type = "posterizetime";
    const values = [];
    for (const mode of ["legacy", "current", "legacy"]) {
      h.effect.zoidiumTemporalMode = mode;
      await h.state.prepareFrameSamples(h.effect, 32.5, {});
      const runtime = h.state.frameSamplerRuntimes.get(h.root);
      const plan = runtime.prepared.get(h.effect);
      values.push(Array.from(plan.samples, tap => tap.target.value));
      assert.ok(plan.revision.includes('"' + mode + '"'));
      h.owner.update(32.5);
      h.state.contexts.push({ compositor: h.root, rootCompositor: h.root, outputFrame: 42.5 });
      assert.deepEqual(Array.from(h.state.resolveFrameSamples(h.effect), tap => tap.target.value), values.at(-1));
      h.state.contexts.pop();
    }
    assert.deepEqual(values, [[29.5, 26.5], [27.5, 25], [29.5, 26.5]]);
    h.root.unload();
  }
});

test("a quantizer before a sampler maps every prepared input tap", async () => {
  const h = host(false);
  h.owner.effects[0] = temporal("posterize-time", 12);
  h.effect._zoidiumFrameSampler.getRequest = () => ({ count: 4, offsetFrames: -3 });
  await h.state.prepareFrameSamples(h.effect, 32.5, {});
  assert.deepEqual(h.decoded, [27.5, 25, 22.5, 20]);
  const samples = h.state.frameSamplerRuntimes.get(h.root).prepared.get(h.effect).samples;
  assert.deepEqual(Array.from(samples, s => s.frame), [39.5, 36.5, 33.5, 30.5],
    "requested times stay distinct from mapped content times");
  assert.deepEqual(Array.from(samples, s => s.target.value), [27.5, 25, 22.5, 20]);
});

test("a quantizer after a sampler keeps the existing input clock", async () => {
  const h = host(false);
  h.owner.effects[2] = temporal("posterize-time", 12);
  await h.state.prepareFrameSamples(h.effect, 32.5, {});
  assert.deepEqual(h.decoded, [29.5, 26.5]);
});

test("adjustment prefix quantization uses project time and excludes the owner's scope from lower media", async () => {
  const h = host(true);
  h.owner.effects[0] = temporal("posterize-time", 12);
  h.effect._zoidiumFrameSampler.getRequest = () => ({ count: 4, offsetFrames: -3 });
  // Owner starts at 5, media at 10. Project 33 maps to project 32.5;
  // its taps map to project 27.5/25/22.5/20 exactly once.
  await h.state.prepareFrameSamples(h.effect, 28, {});
  assert.deepEqual(h.decoded, [17.5, 15, 12.5, 10]);
  assert.equal(h.owner.frame, 28);
  assert.equal(h.state.contexts.length, 0);
});

test("nested async preparation stops at the same depth limit as synchronous sampling", async () => {
  const h = host(false);
  await h.state.prepareFrameSamples(h.effect, 20, { frameSamplerDepth: 8 });
  assert.equal(h.decoded.length, 0);
  await h.state.prepareFrameSamples(h.effect, 20, { frameSamplerDepth: 7 });
  const runtime = h.state.frameSamplerRuntimes.get(h.root);
  assert.equal(runtime.prepared.get(h.effect).depth, 8);
  assert.ok(runtime.captures[7]);
  assert.equal(h.state.contexts.length, 0);
});

test("synchronous captures use the same prefix mapping as prepared captures", () => {
  const h = host(false);
  h.owner.effects[0] = temporal("posterize-time", 12);
  h.effect._zoidiumFrameSampler.getRequest = () => ({ count: 4, offsetFrames: -3 });
  const update = h.source.update;
  h.source.update = function (frame) { update.call(this, frame); this.texture.frame = this.frame; };
  h.owner.update(32.5);
  h.state.contexts.push({ compositor: h.root, rootCompositor: h.root, outputFrame: 42.5 });
  const samples = h.state.resolveFrameSamples(h.effect);
  h.state.contexts.pop();
  assert.deepEqual(Array.from(samples, s => s.target.value), [27.5, 25, 22.5, 20]);
  assert.equal(h.owner.frame, 32.5);
  assert.equal(h.state.evaluatingLayers.has(h.owner), false);
});

test("input caches distinguish nested depth and enclosing adjustment scope", async () => {
  const h = host(false);
  h.owner.effects[0]._zoidiumFrameSampler = {};
  await h.state.prepareFrameSamples(h.effect, 20, {});
  const runtime = h.state.frameSamplerRuntimes.get(h.root);
  const target = runtime.prepared.get(h.effect).samples[0].target;
  await h.state.prepareFrameSamples(h.effect, 20, { frameSamplerDepth: 1 });
  assert.notEqual(runtime.prepared.get(h.effect).samples[0].target, target);
  const nested = runtime.prepared.get(h.effect).samples[0].target;
  await h.state.prepareFrameSamples(h.effect, 20, {
    frameSamplerDepth: 1, frameSamplerScope: { effect: {}, layer: {}, trackIndex: 1 },
  });
  assert.notEqual(runtime.prepared.get(h.effect).samples[0].target.inputStamp, target.inputStamp);
  assert.equal(h.decoded.length, 6, "neither another depth nor another scope reuses an input");
  assert.notEqual(runtime.prepared.get(h.effect).samples[0].target, nested, "each scope retains its own pure input");
});


test("interleaved Echo taps survive until their next playback phase", async () => {
  const h = host(false);
  h.effect._zoidiumFrameSampler.getRequest = () => ({ count: 4, offsetFrames: -3 });
  for (let frame = 20; frame < 40; frame++) {
    await h.state.prepareFrameSamples(h.effect, frame, {});
  }
  // Initial twelve source times cover all three phases, then one new time
  // per output frame. Previously each output recaptured all four taps.
  assert.equal(h.decoded.length, 29);
  const runtime = h.state.frameSamplerRuntimes.get(h.root);
  assert.ok(runtime.targets.size <= 64);
  const before = h.decoded.length;
  await h.state.prepareFrameSamples(h.effect, 35, {});
  assert.equal(h.decoded.length, before, "short backward seek uses the same immutable inputs");
});

test("capture performs one layer evaluation per missing tap and one restoration per batch", async () => {
  for (const adjustment of [false, true]) {
    const h = host(adjustment);
    const calls = [];
    const original = h.owner.update;
    h.owner.update = function (frame) { calls.push(frame); return original.call(this, frame); };
    await h.state.prepareFrameSamples(h.effect, 20, {});
    assert.deepEqual(calls, [17, 14, 20]);
    assert.equal(h.owner.frame, 20);
  }
});

test("reuse targets have both a byte cap and a slot cap", async () => {
  const h = host(false);
  h.ownerClip.length = 1000;
  h.root.readBuffer.width = 1920;
  h.root.readBuffer.height = 1080;
  h.effect._zoidiumFrameSampler.getRequest = () => ({ count: 16, offsetFrames: -4 });
  for (let frame = 20; frame < 150; frame++) await h.state.prepareFrameSamples(h.effect, frame, {});
  const runtime = h.state.frameSamplerRuntimes.get(h.root);
  assert.ok(runtime.targetBytes <= 256 * 1024 * 1024);
  assert.equal(runtime.targets.size, 32);
  assert.equal(runtime.targetBytes, 32 * 1920 * 1080 * 4);
  assert.ok([...runtime.inputCache.get(h.effect).values()].reduce((n, cache) => n + cache.size, 0) <= 48,
    "overwritten memo entries are pruned");
  h.root.unload();
  assert.equal(runtime.targets.size, 0);
});

test("an edit expires memoized inputs without reallocating; a resize releases the pool", async () => {
  const h = host(false);
  let revision = 0;
  h.sequence.toJSON = () => ({ revision });
  await h.state.prepareFrameSamples(h.effect, 20, {});
  const runtime = h.state.frameSamplerRuntimes.get(h.root);
  const old = [...runtime.targets];
  const stamps = old.map(target => target.inputStamp);
  const decoded = h.decoded.length;
  revision++;
  await h.state.prepareFrameSamples(h.effect, 20, {});
  assert.ok(old.every(target => !target.disposed), "an edit keeps the allocated targets");
  assert.ok(old.every((target, index) => target.inputStamp !== stamps[index]), "every old input expired");
  assert.ok(h.decoded.length > decoded, "the edited frame is captured again");
  assert.ok([...runtime.targets].every(target => old.includes(target)), "no new allocation for the same plan");
  const resized = [...runtime.targets];
  h.root.readBuffer.width = 160;
  await h.state.prepareFrameSamples(h.effect, 22, {});
  assert.ok(resized.every(target => target.disposed));
  assert.ok(runtime.targets.size > 0);
  assert.ok([...runtime.targets].every(target => target.width === 160));
});

test("effect unload and project replacement release sampler targets", async () => {
  const h = host(false);
  let unloaded = false;
  h.effect.unload = () => { unloaded = true; };
  h.owner.update(20);
  await h.state.prepareFrameSamples(h.effect, 20, {});
  let runtime = h.state.frameSamplerRuntimes.get(h.root);
  const old = [...runtime.targets];
  h.effect.unload();
  assert.ok(unloaded);
  assert.ok(old.every(target => target.disposed));
  assert.equal(runtime.targetBytes, 0);
  assert.equal(runtime.schedules.size, 0);
  await h.state.prepareFrameSamples(h.effect, 21, {});
  runtime = h.state.frameSamplerRuntimes.get(h.root);
  const next = [...runtime.targets];
  h.root.sequence = { videoTracks: [] };
  h.root.renderSequence(0);
  assert.ok(next.every(target => target.disposed));
  assert.equal(runtime.disposed, true);
});


test("asset replacement and track toggles invalidate cached inputs", async () => {
  const h = host(false);
  h.sequence.parentProject = { assets: { list: { video: { url: "first", sha256: "a" } } } };
  await h.state.prepareFrameSamples(h.effect, 20, {});
  const runtime = h.state.frameSamplerRuntimes.get(h.root);
  for (const change of [
    () => { h.sequence.parentProject.assets.list.video.url = "second"; },
    () => { h.sequence.videoTracks.push({ enabled: false }); },
  ]) {
    const decoded = h.decoded.length;
    const stamps = [...runtime.targets].map(target => target.inputStamp);
    change();
    await h.state.prepareFrameSamples(h.effect, 20, {});
    assert.ok(stamps.every(stamp => ![...runtime.targets].some(target => target.inputStamp === stamp)));
    assert.ok(h.decoded.length > decoded, "the changed input is captured again");
  }
});


test("viewport preparation settles source content before caching taps", async () => {
  for (const adjustment of [false, true]) {
    const h = host(adjustment);
    let settle;
    let prepared = false;
    const loading = new Promise(resolve => { settle = resolve; });
    h.source.objects = [{ loading, prepare() { prepared = true; } }];
    const frames = h.root.frames.length;
    h.viewport._render();
    await new Promise(setImmediate);
    assert.equal(h.decoded.length, 0, "pending content never enters the tap cache");
    assert.equal(h.root.frames.length, frames);
    settle();
    await new Promise(setImmediate);
    assert.equal(prepared, true);
    assert.ok(h.decoded.length > 0);
    assert.equal(h.root.frames.at(-1), 30);
  }
});


test("render consumes the prepared plan directly, or resolves another resident nested plan", async () => {
  const h = host(false);
  await h.state.prepareFrameSamples(h.effect, 20, {});
  const runtime = h.state.frameSamplerRuntimes.get(h.root);
  const prepared = runtime.prepared.get(h.effect);
  h.owner.update(20);
  h.state.contexts.push({ compositor: h.root, rootCompositor: h.root, outputFrame: 30 });
  assert.equal(h.state.resolveFrameSamples(h.effect), prepared.samples);
  h.state.contexts.pop();
  await h.state.prepareFrameSamples(h.effect, 21, {});
  h.owner.update(20);
  h.state.contexts.push({ compositor: h.root, rootCompositor: h.root, outputFrame: 30 });
  const resident = h.state.resolveFrameSamples(h.effect);
  assert.deepEqual(Array.from(resident, s => s.target), Array.from(prepared.samples, s => s.target));
  h.state.contexts.pop();
  assert.equal(h.decoded.length, 4, "resolving an earlier plan never seeks media");
});


test("removing a detached owning clip still releases its sampler runtime", async () => {
  const h = host(false);
  h.effect.unload = () => {};
  h.owner.update(20);
  await h.state.prepareFrameSamples(h.effect, 20, {});
  const runtime = h.state.frameSamplerRuntimes.get(h.root);
  const targets = [...runtime.targets];
  h.owner.getParentOfType = () => null;
  h.effect.unload();
  assert.ok(targets.every(target => target.disposed));
  assert.equal(runtime.targetBytes, 0);
  assert.equal(runtime.schedules.size, 0);
  assert.equal(runtime.disposed, true);
});


test("sampler-free input prefixes reuse the same pixels across nesting depths", async () => {
  const h = host(false);
  await h.state.prepareFrameSamples(h.effect, 20, {});
  const runtime = h.state.frameSamplerRuntimes.get(h.root);
  const targets = runtime.prepared.get(h.effect).samples.map(s => s.target);
  await h.state.prepareFrameSamples(h.effect, 20, { frameSamplerDepth: 1 });
  assert.equal(h.decoded.length, 2);
  assert.deepEqual(Array.from(runtime.prepared.get(h.effect).samples, s => s.target), Array.from(targets));
});


test("global target eviction transfers expired slots and preserves reserved inputs", async () => {
  const h = host(false);
  await h.state.prepareFrameSamples(h.effect, 20, {});
  const runtime = h.state.frameSamplerRuntimes.get(h.root);
  const sampler = h.parts.sampler;
  sampler.clearFrameSamplerTargets(runtime);
  const targets = Array.from({ length: 32 }, (_, i) => {
    const target = sampler.getFrameSamplerTarget(runtime, h.effect, 1, i, 1920, 1080);
    target.inputUsed = i + 1;
    return target;
  });
  const batch = new Set([targets[1]]);
  runtime.reservations.add(batch);
  runtime.publishedReservations.set(h.effect, new Set([targets[0]]));
  const other = {};
  const selected = sampler.selectFrameSamplerTarget(runtime, other, 1, new Set(), 1920, 1080);
  assert.equal(selected, targets[2]);
  assert.equal(runtime.targets.size, 32);
  assert.equal(runtime.records.get(h.effect)[0].targets.length, 31);
  assert.equal(runtime.records.get(other)[0].targets[0], selected);
  assert.equal(runtime.targetBytes, 32 * 1920 * 1080 * 4);
  h.root.renderSequence(30);
  assert.equal(runtime.publishedReservations.size, 0, "published plans unpin after the main draw");
});

test("small targets stop growing at 128 slots per input pool", async () => {
  const h = host(false);
  await h.state.prepareFrameSamples(h.effect, 20, {});
  const runtime = h.state.frameSamplerRuntimes.get(h.root);
  const sampler = h.parts.sampler;
  sampler.clearFrameSamplerTargets(runtime);
  for (let i = 0; i < 200; i++) {
    const target = sampler.selectFrameSamplerTarget(runtime, h.effect, 1, new Set(), 80, 40);
    target.inputUsed = i + 1;
  }
  assert.equal(runtime.targets.size, 128);
  assert.equal(runtime.targetBytes, 128 * 80 * 40 * 4);
});


test("steady playback recycles its tap window before filling the byte budget", async () => {
  const h = host(false);
  h.ownerClip.length = 1000;
  h.effect._zoidiumFrameSampler.getRequest = () => ({ count: 4, offsetFrames: -3 });
  for (let frame = 20; frame < 100; frame++) {
    await h.state.prepareFrameSamples(h.effect, frame, {});
    h.root.renderSequence(frame + h.ownerClip.start);
  }
  const runtime = h.state.frameSamplerRuntimes.get(h.root);
  assert.equal(runtime.targets.size, 17, "span 9 + four taps + four scrub slots");
  assert.equal(h.decoded.length, 89, "only one new source time per output after interleaving warms");
});


test("compositor resize releases targets immediately and discards pending old-size previews", async () => {
  const h = host(false);
  await h.state.prepareFrameSamples(h.effect, 20, {});
  const runtime = h.state.frameSamplerRuntimes.get(h.root);
  const old = [...runtime.targets];
  h.root.setSize(160, 40);
  assert.ok(old.every(target => target.disposed));
  assert.equal(runtime.targetBytes, 0);
  assert.equal(runtime.targets.size, 0);
  let settle;
  h.source.objects = [{ prepare: () => new Promise(resolve => { settle = resolve; }) }];
  const frames = h.root.frames.length;
  h.viewport._render();
  await new Promise(setImmediate);
  h.root.setSize(240, 40);
  settle();
  await new Promise(setImmediate);
  assert.equal(h.root.frames.length, frames, "do not publish a preview whose key changed during preparation");
  assert.equal(runtime.previewPending, false);
});


test("project resolution edits release the pool even when viewport dimensions stay fixed", async () => {
  const h = host(false);
  const watchers = [];
  h.sequence.properties.resolution.onChanged = {
    watch(fn) { watchers.push(fn); },
    unwatch(fn) { watchers.splice(watchers.indexOf(fn), 1); },
  };
  await h.state.prepareFrameSamples(h.effect, 20, {});
  const runtime = h.state.frameSamplerRuntimes.get(h.root);
  const old = [...runtime.targets];
  assert.equal(watchers.length, 1);
  watchers[0]();
  assert.ok(old.every(target => target.disposed));
  assert.equal(runtime.targetBytes, 0);
  h.root.unload();
  assert.equal(watchers.length, 0);
});


test("an intervening layer update cannot replace a tap's prepared effect uniforms", async () => {
  const h = host(false);
  h.owner.effects[0].update = function (frame) { this.add = frame; };
  h.owner.effects[0].prepare = async frame => { if (frame < 20) h.owner.update(99); };
  await h.state.prepareFrameSamples(h.effect, 20, {});
  const runtime = h.state.frameSamplerRuntimes.get(h.root);
  assert.deepEqual(Array.from(runtime.prepared.get(h.effect).samples, s => s.target.value), [34, 28]);
  assert.equal(h.owner.frame, 20);
});


test("single-tap playback reuses one target instead of allocating an interleaving window", async () => {
  const h = host(false);
  h.effect._zoidiumFrameSampler.getRequest = () => ({ count: 1, offsetFrames: -1 });
  for (let frame = 20; frame < 40; frame++) {
    await h.state.prepareFrameSamples(h.effect, frame, {});
    h.root.renderSequence(frame + h.ownerClip.start);
  }
  const runtime = h.state.frameSamplerRuntimes.get(h.root);
  assert.equal(runtime.targets.size, 1);
  assert.equal(h.decoded.length, 20);
  assert.equal(runtime.prepared.get(h.effect).samples[0].target.value, 138);
});

function scopedHost() {
  const h = host(false);
  h.owner.effects.forEach((effect, i) => { effect.type = ["exposure", "echo", "negative"][i]; });
  h.owner.toJSON = function () { return { type: 0, properties: { tint: this.tint || 0 }, effects: this.effects }; };
  h.ownerClip.toJSON = function () { return { start: this.start, length: this.length, object: this.object }; };
  h.sequence.videoTracks[0].clips = [h.ownerClip];
  return h;
}

test("scoped inputs survive own, later and unrelated edits without allocating targets", async () => {
  const h = scopedHost();
  await h.state.prepareFrameSamples(h.effect, 20, {});
  const runtime = h.state.frameSamplerRuntimes.get(h.root);
  const original = runtime.prepared.get(h.effect).samples.map(sample => sample.target);
  const decodes = h.decoded.length;
  for (let i = 0; i < 40; i++) {
    h.effect.decay = i;
    h.owner.effects[2].amount = i;
    h.sequence.toJSON = () => ({ unrelated: i });
    await h.state.prepareFrameSamples(h.effect, 20, {});
    assert.equal(h.decoded.length, decodes);
    assert.deepEqual(Array.from(runtime.targets), Array.from(original));
  }
  h.owner.effects[0].add++;
  await h.state.prepareFrameSamples(h.effect, 20, {});
  assert.equal(h.decoded.length, decodes + 2, "prefix edit recaptures inputs");
  assert.deepEqual(Array.from(runtime.targets), Array.from(original), "expired slots refill in place");
});

test("undo and redo can reuse retained content without an unbounded revision map", async () => {
  const h = scopedHost();
  h.effect._zoidiumFrameSampler.getRequest = () => ({ count: 2, offsetFrames: -1 });
  for (let frame = 20; frame < 27; frame++) await h.state.prepareFrameSamples(h.effect, frame, {});
  const runtime = h.state.frameSamplerRuntimes.get(h.root);
  const size = runtime.targets.size;
  h.owner.tint = 1;
  await h.state.prepareFrameSamples(h.effect, 26, {});
  const afterEdit = h.decoded.length;
  h.owner.tint = 0;
  await h.state.prepareFrameSamples(h.effect, 26, {});
  assert.equal(h.decoded.length, afterEdit, "undo reuses the previous revision's still-resident times");
  h.owner.tint = 1;
  await h.state.prepareFrameSamples(h.effect, 26, {});
  assert.equal(h.decoded.length, afterEdit, "redo reuses the edited revision");
  for (let i = 2; i < 100; i++) {
    h.owner.tint = i;
    await h.state.prepareFrameSamples(h.effect, 26, {});
    assert.equal(runtime.targets.size, size, "edit loop never reallocates targets");
    const revisions = runtime.inputCache.get(h.effect);
    assert.ok([...revisions.values()].reduce((n, cache) => n + cache.size, 0) <= size,
      "overwrites unlink their old key immediately");
    assert.ok([...revisions.values()].every(cache => cache.size > 0), "no empty revision history is retained");
  }
});

test("the debug oracle recaptures inputs each prepare and preserves prepared output plans", async () => {
  const h = scopedHost();
  await h.state.prepareFrameSamples(h.effect, 20, {});
  const runtime = h.state.frameSamplerRuntimes.get(h.root);
  const cached = runtime.prepared.get(h.effect).samples.map(s => s.target.value);
  h.PZ.zoidium.debugDisableFrameSamplerInputReuse = true;
  for (let i = 0; i < 20; i++) {
    const decodes = h.decoded.length;
    await h.state.prepareFrameSamples(h.effect, 20, {});
    assert.equal(h.decoded.length, decodes + 2);
    const prepared = runtime.prepared.get(h.effect);
    assert.deepEqual(Array.from(prepared.samples, s => s.target.value), Array.from(cached));
    h.owner.update(20);
    h.state.contexts.push({ compositor: h.root, rootCompositor: h.root, outputFrame: 30 });
    assert.equal(h.state.resolveFrameSamples(h.effect), prepared.samples);
    h.state.contexts.pop();
  }
  await h.state.prepareFrameSamples(h.effect, 21, {});
  h.owner.update(20);
  const decoded = h.decoded.length;
  h.state.contexts.push({ compositor: h.root, rootCompositor: h.root, outputFrame: 30 });
  const resident = h.state.resolveFrameSamples(h.effect);
  h.state.contexts.pop();
  assert.deepEqual(Array.from(resident, s => s.target.value), Array.from(cached));
  assert.equal(h.decoded.length, decoded, "reclaiming duplicate oracle slots keeps the newest resident entry");
});

test("plugin state changes release the complete runtime and remove its listener", async () => {
  const h = scopedHost(), listeners = new Map();
  h.sandbox.document = {
    addEventListener: (name, fn) => listeners.set(name, fn),
    removeEventListener: (name, fn) => { if (listeners.get(name) === fn) listeners.delete(name); },
  };
  await h.state.prepareFrameSamples(h.effect, 20, {});
  const runtime = h.state.frameSamplerRuntimes.get(h.root);
  const targets = [...runtime.targets];
  const schedules = [...runtime.schedules.values()];
  listeners.get("zoidium:plugin-state-change")();
  assert.ok(targets.every(target => target.disposed));
  assert.ok(schedules.every(schedule => schedule.disposed));
  assert.equal(runtime.targetBytes, 0);
  assert.equal(runtime.disposed, true);
  assert.equal(listeners.size, 0);
  const decoded = h.decoded.length;
  await h.state.prepareFrameSamples(h.effect, 20, {});
  assert.equal(h.decoded.length, decoded + 2, "the next prepare works without an intervening render");
  h.root.unload();
  assert.equal(listeners.size, 0);
});

test("an input edit during async decoding never publishes captures under the old content key", async () => {
  const h = scopedHost();
  const decode = h.PZ.schedule.prototype.decodeFrame;
  let resume;
  h.PZ.schedule.prototype.decodeFrame = async function (time) {
    await new Promise(resolve => { resume = resolve; });
    return decode.call(this, time);
  };
  const pending = h.state.prepareFrameSamples(h.effect, 20, {});
  await new Promise(setImmediate);
  h.owner.effects[0].add = 101;
  h.PZ.schedule.prototype.decodeFrame = decode;
  resume();
  await pending;
  const runtime = h.state.frameSamplerRuntimes.get(h.root);
  assert.equal(runtime.prepared.get(h.effect), undefined);
  assert.equal(runtime.targets.size, 0, "changed inputs were rejected before allocating or memoizing");
  await h.state.prepareFrameSamples(h.effect, 20, {});
  assert.deepEqual(Array.from(runtime.prepared.get(h.effect).samples, s => s.target.value), [118, 115]);
});

test("editing a sampler to request novel source times reuses its existing slots", async () => {
  const h = scopedHost();
  h.effect.properties = { shift: 0 };
  h.effect._zoidiumFrameSampler.getRequest = () => ({ frames: [
    -3 + h.effect.properties.shift / 10, -6 + h.effect.properties.shift / 10,
  ] });
  await h.state.prepareFrameSamples(h.effect, 20, {});
  const runtime = h.state.frameSamplerRuntimes.get(h.root);
  // Own-parameter edits keep earlier captures valid, so novel source times may
  // grow the effect's retained window to about its capacity (2 taps + 3-frame
  // span + 4 scrub slots), then recycle those slots without allocating.
  const sizes = [];
  for (let i = 1; i <= 20; i++) {
    h.effect.properties.shift = i;
    await h.state.prepareFrameSamples(h.effect, 20, {});
    sizes.push(runtime.targets.size);
  }
  assert.ok(Math.max(...sizes) <= 10, "the retained window stays near its capacity, far below 128 slots");
  const settled = [...runtime.targets];
  for (let i = 21; i <= 30; i++) {
    h.effect.properties.shift = i;
    await h.state.prepareFrameSamples(h.effect, 20, {});
    assert.equal(runtime.targets.size, settled.length, "a full window recycles its own slots");
    assert.ok([...runtime.targets].every(target => settled.includes(target)));
  }
});

for (const adjustment of [false, true]) {
  test(`mixed sampler maps Composite descendants once per prepared tap, adjustment=${adjustment}`, async () => {
    const h = host(adjustment);
    Object.setPrototypeOf(h.source, h.PZ.layer.composite.prototype);
    const child = new h.PZ.layer.scene();
    child.clip = h.source.clip;
    h.source.objects = [child];
    const updates = [];
    const update = child.update;
    child.update = function (frame) { updates.push(frame); return update.call(this, frame); };
    h.sequence.videoTracks.forEach(track => { track.clips = [track.layer.clip]; });
    h.sequence.videoSchedules = [];
    h.source.effects.unshift(temporal("time-offset", 5));
    // The owner clock includes its own operators before preparing taps.
    await h.state.prepareFrameSamples(h.effect, adjustment ? 20 : 25, {});
    const samples = h.state.frameSamplerRuntimes.get(h.root).prepared.get(h.effect).samples;
    const expected = adjustment ? [17, 14] : [22, 19];
    assert.deepEqual(updates, expected, "one concrete content evaluation per input");
    assert.deepEqual(Array.from(samples, tap => tap.target.value), expected.map(f => f + 100));
    assert.equal(h.state.contexts.length, 0);
    assert.equal(h.state.evaluatingLayers.has(h.owner), false);
  });
}

test("a sampler inside a Precomp-style clip is found and captures its child clock", async () => {
  const h = host(false);
  const child = new h.PZ.layer.scene();
  child.effects = [h.effect];
  child.clip = { start: 3, length: 100, object: child };
  child.toJSON = () => ({ type: 4, effects: child.effects, objects: [] });
  const baseUpdate = child.update;
  child.update = function (frame) { baseUpdate.call(this, frame); this.texture.frame = frame; };
  h.effect.tryGetParentOfType = () => child;
  Object.setPrototypeOf(h.owner, h.PZ.layer.composite.prototype);
  h.owner.effects = [temporal("time-offset", 5)];
  h.owner.objects = [child];
  h.owner.nestedTracks = () => [{ clips: [child.clip] }];
  h.sequence.videoTracks[0].clips = [h.ownerClip];
  h.sequence.videoSchedules = [];
  await h.state.prepareFrameSamples(h.effect, 20, {});
  const samples = h.state.frameSamplerRuntimes.get(h.root).prepared.get(h.effect).samples;
  assert.deepEqual(Array.from(samples, tap => tap.frame), [20, 17]);
  assert.deepEqual(Array.from(samples, tap => tap.target.value), [17, 14]);
  assert.equal(h.state.contexts.length, 0);
});

test("quantized taps share one input evaluation while retaining their requested frames and weights", async () => {
  const h = host(false);
  Object.setPrototypeOf(h.source, h.PZ.layer.composite.prototype);
  const child = new h.PZ.layer.scene();
  child.clip = h.source.clip;
  h.source.objects = [child];
  h.source.effects = [temporal("posterize-time", 5), h.effect];
  h.sequence.videoTracks[0].clips = [h.ownerClip];
  h.sequence.videoSchedules = [];
  const frames = [];
  const update = child.update;
  child.update = function (frame) { frames.push(frame); update.call(this, frame); };
  h.effect._zoidiumFrameSampler.getRequest = () => ({ count: 2, offsetFrames: -1, decay: 0.5 });
  await h.state.prepareFrameSamples(h.effect, 20, {});
  const runtime = h.state.frameSamplerRuntimes.get(h.root);
  const samples = runtime.prepared.get(h.effect).samples;
  assert.deepEqual(frames, [18]);
  assert.deepEqual(Array.from(samples, s => s.frame), [29, 28]);
  assert.deepEqual(Array.from(samples, s => s.opacity), [1, 0.5]);
  assert.equal(samples[0].target, samples[1].target);
  await h.state.prepareFrameSamples(h.effect, 21, {});
  assert.deepEqual(frames, [18], "neighbouring quantized requests reuse that same input");
});

test("Composite inputs containing another sampler retain the recursion depth in their cache key", () => {
  const h = host(false);
  Object.setPrototypeOf(h.source, h.PZ.layer.composite.prototype);
  const child = new h.PZ.layer.scene();
  child.effects = [{ _zoidiumFrameSampler: {} }];
  h.source.objects = [child];
  assert.equal(h.parts.sampler.frameSamplerCacheDepth({ layer: h.source, effectIndex: 1 }, 3), 3);
  child.effects = [];
  assert.equal(h.parts.sampler.frameSamplerCacheDepth({ layer: h.source, effectIndex: 1 }, 3), 1);
});

for (const suffix of [false, true]) {
  test(`Adjustment offsets map sampler taps once on either side, suffix=${suffix}`, async () => {
    const h = host(true);
    const offset = temporal("time-offset", 5);
    h.owner.effects = suffix ? [h.effect, offset] : [offset, h.effect];
    await h.state.prepareFrameSamples(h.effect, 20, {});
    const samples = h.state.frameSamplerRuntimes.get(h.root).prepared.get(h.effect).samples;
    assert.deepEqual(Array.from(samples, tap => tap.frame), [27, 24]);
    assert.deepEqual(Array.from(samples, tap => tap.target.value), [17, 14]);
    assert.equal(h.owner.frame, 20);
  });
}

test("viewport prepares a nested Precomp sampler and its resources at the mapped child clock", async () => {
  const h = host(false);
  const child = new h.PZ.layer.scene();
  child.clip = { start: 3, length: 100, object: child };
  child.pass = { camera: {} };
  child.effects = [h.effect];
  const resources = [], prepared = [], updates = [];
  child.objects = [{ prepare: async frame => resources.push(frame) }];
  child.toJSON = () => ({ type: 4, effects: child.effects });
  const originalUpdate = child.update;
  child.update = function (frame) { updates.push(frame); originalUpdate.call(this, frame); };
  h.effect.tryGetParentOfType = () => child;
  h.effect.prepare = async (frame, context) => {
    prepared.push(frame);
    await h.state.prepareFrameSamples(h.effect, frame, context);
  };
  Object.setPrototypeOf(h.owner, h.PZ.layer.composite.prototype);
  h.owner.effects = [temporal("time-offset", 5)];
  h.owner.objects = [child];
  h.owner.offset = 7;
  h.owner.setCompTime = () => {};
  h.owner.nestedTracks = () => [{ clips: [child.clip], getCurrentClip: () => child.clip }];
  h.sequence.videoTracks[0].clips = [h.ownerClip];
  h.sequence.videoSchedules = [];
  h.viewport._render();
  await new Promise(setImmediate);
  assert.deepEqual(resources, [29], "project 30 minus outer start 10, plus 5 + 7, minus child start 3");
  assert.deepEqual(prepared, [29]);
  assert.deepEqual(updates, [26, 23], "only sampler inputs evaluate content during preparation");
  assert.equal(h.root.frames.at(-1), 30);
  assert.equal(h.state.frameSamplerRuntimes.get(h.root).previewPending, false);
});

test("a clock-only video preview waits for its private decoder before drawing", async () => {
  const h = host(false);
  delete h.effect._zoidiumFrameSampler;
  h.effect._zoidiumTemporal = { getOperator: () =>
    ({ kind: "time-offset", enabled: true, offsetFrames: 5 }) };
  const liveTexture = h.source.texture;
  const frames = h.root.frames.length;
  h.viewport._render();
  assert.equal(h.root.frames.length, frames, "an unfinished seek never reaches the compositor");
  await new Promise(setImmediate);
  assert.equal(h.root.frames.at(-1), 30);
  assert.equal(h.source.texture, liveTexture);
  assert.equal(liveTexture.frame, 99, "the playback element is never sought for preview");
  const decodes = h.decoded.length;
  h.viewport._render();
  await new Promise(setImmediate);
  assert.equal(h.decoded.length, decodes, "unchanged redraw reuses the exact input");
});
