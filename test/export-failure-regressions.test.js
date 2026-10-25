"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const { host } = require("./helpers/temporal-sampler-host.cjs");
function videoHost() {
  const PZ = { schedule: class {}, export: class {} };
  vm.runInNewContext(fs.readFileSync("plugins/core/video-frame-export.js", "utf8"),
    { PZ, setTimeout, clearTimeout, AbortController });
  PZ.videoFrameExportDiagnostics.timeoutMs = 1000;
  return PZ;
}
function video(broken = false) {
  const v = new EventTarget();
  Object.assign(v, { readyState: 2, duration: 10, seeking: false, src: "blob:private",
    error: broken ? { code: 3, message: "PIPELINE_ERROR_DISCONNECTED: blob:private" } : null });
  let time = 0;
  Object.defineProperty(v, "currentTime", { configurable: true, get: () => time, set(t) {
    time = t; queueMicrotask(() => v.dispatchEvent(new Event("seeked")));
  } });
  return v;
}
for (const stage of ["before", "prepare", "compose", "readback"]) {
  test(`lost export context rejects at ${stage} without counting a frame`, async () => {
    const PZ = videoHost(); let lost = stage === "before", disposed = 0;
    const canvas = new EventTarget();
    const exp = Object.assign(new PZ.export(), { frame: 12, frameAdvance: 1, framesRendered: 0, totalFrames: 1,
      params: { width: 1, height: 1 },
      sequence: { properties: { rate: { get: () => 30 } }, prepare: async () => { lost ||= stage === "prepare"; } },
      compositor: { renderSequence() { lost ||= stage === "compose"; }, unload() { disposed++; } },
      renderer: { domElement: canvas, dispose() { disposed++; }, context: {
        isContextLost: () => lost, readPixels() { lost ||= stage === "readback"; } } } });
    await assert.rejects(exp.renderVideoFrame(new Uint8Array(4)), /WebGL context lost.*output.*0.*project frame 12.*0\.4/);
    assert.equal(exp.framesRendered, 0); assert.equal(exp.frame, 12);
    assert.equal(exp.framePromise, null); assert.equal(exp.frameWaiting, -1);
    assert.equal(disposed, 2);
  });
}
for (const time of [0, 2]) test(`existing MediaError at ${time}s rejects with source-safe context`, async () => {
  const PZ = videoHost(); const s = new PZ.schedule(); s.el = video(true); s.texture = {};
  s.currentItem = { clip: { name: "Color clip" } };
  await assert.rejects(s.decodeFrame(time, { exportPolicy: { outputIndex: 7 } }), error => {
    assert.match(error.message, /Color clip.*media time.*output.*7.*metadata.*PIPELINE_ERROR_DISCONNECTED/);
    assert.doesNotMatch(error.message, /blob:private/); return true;
  });
  assert.notEqual(s.texture.needsUpdate, true);
});
test("concurrent decoder requests finish at their own requested time", async () => {
  const PZ = videoHost(), s = new PZ.schedule(); s.el = video(); s.texture = {};
  const seen = [];
  await Promise.all([1, 2].map(time => s.decodeFrame(time).then(() => seen.push(s.el.currentTime))));
  assert.deepEqual(seen, [1, 2]);
});
for (const failure of ["decode", "capture"]) test(`export propagates temporal ${failure} failures; preview falls back`, async () => {
  const make = () => {
    const h = host(false); h.sandbox.console = { error() {} };
    if (failure === "decode") h.PZ.schedule.prototype.decodeFrame = async () => { throw new Error("fixture decoder failure"); };
    else h.PZ.compositor.prototype.renderLayer = () => { throw new Error("fixture capture failure"); };
    return h;
  };
  const h = make();
  await assert.rejects(h.state.prepareFrameSamples(h.effect, 20,
    { sequence: h.sequence, frameSamplerRoot: h.root, exportPolicy: { outputIndex: 0 } }),
  /sample.*effect.*clip.*requested frame.*fixture/);
  const preview = make(); await preview.state.prepareFrameSamples(preview.effect, 20, { frameSamplerRoot: preview.root });
});
test("an unprepared fractional export sample never captures the live video texture", async () => {
  const h = host(false); h.effect._zoidiumFrameSampler.getRequest = () => ({ enabled: true, frames: [-1] });
  await h.state.prepareFrameSamples(h.effect, 20, { frameSamplerRoot: h.root });
  h.owner.update(20 + 0.5 / 16);
  h.state.contexts.push({ compositor: h.root, rootCompositor: h.root, outputFrame: 30,
    renderingSequence: true, exportPolicy: {} });
  try { assert.throws(() => h.state.resolveFrameSamples(h.effect), /exact.*sample.*prepared/); }
  finally { h.state.contexts.pop(); }
});

test("one decoder reset retries the exact time; an unhealthy GPU prevents a retry", async () => {
  for (const healthy of [true, false]) {
    const PZ = videoHost(), s = new PZ.schedule(); s.el = video(true); s.texture = {};
    s.currentItem = { media: { url: "blob:private" } };
    let loads = 0, checks = 0;
    s.el.removeAttribute = () => {};
    s.el.load = () => { loads++; s.el.error = null; };
    const context = { exportPolicy: { outputIndex: 3, check() {
      checks++; if (!healthy && checks > 1) throw new Error("WebGL context lost");
    } } };
    if (healthy) {
      await s.decodeFrame(2, context);
      assert.equal(s.__zoidiumVideoExportState.requestedTime, 2);
      assert.equal(loads, 2, "one decoder reset, with unload and reload");
    } else { await assert.rejects(s.decodeFrame(2, context), /WebGL context lost/); assert.equal(loads, 0); }
  }
});
test("a terminal decoder error stops after one reset", async () => {
  const PZ = videoHost(), s = new PZ.schedule(); s.el = video(true); s.texture = {};
  s.currentItem = { media: { url: "blob:private" } }; let loads = 0;
  s.el.load = () => { loads++; };
  await assert.rejects(s.decodeFrame(1, { exportPolicy: {} }), /PIPELINE_ERROR_DISCONNECTED/);
  assert.equal(loads, 2);
});
test("a loss event aborts an in-flight seek and removes listeners and callbacks", async () => {
  const PZ = videoHost(), exp = new PZ.export(); const canvas = new EventTarget();
  Object.assign(exp, { framesRendered: 0, frame: 12, sequence: {}, renderer: { domElement: canvas, context: { isContextLost: () => false } } });
  exp.checkExportContext();
  const s = new PZ.schedule(); s.el = video(); s.texture = {};
  let seekStarted;
  const seeking = new Promise(resolve => { seekStarted = resolve; });
  Object.defineProperty(s.el, "currentTime", { get: () => 0, set() { seekStarted(); } });
  let cancelled = 0;
  s.el.requestVideoFrameCallback = () => 1; s.el.cancelVideoFrameCallback = () => { cancelled++; };
  const pending = s.decodeFrame(2, exp);
  await seeking;
  canvas.dispatchEvent(new Event("webglcontextlost"));
  await assert.rejects(pending, /WebGL context lost/);
  assert.ok(cancelled >= 1);
  exp.unload();
});

test("16 CM3 shutter times retain exact generated video frames across a color boundary", async () => {
  const fixture = require("../tools/generate-export-color-fixture.js");
  const h = host(false);
  const frame = 18.4; // requested previous sample crosses video time 0.25s within this shutter.
  h.effect._zoidiumFrameSampler.getRequest = () => ({ enabled: true, frames: [-1] });
  h.sequence.properties.motionBlur = { get: () => 1 };
  h.sequence.properties.motionBlurSamples = { get: () => 16 };
  h.sequence.properties.motionBlurShutter = { get: () => 0.5 };
  h.PZ.schedule.prototype.decodeFrame = async function (time) {
    const index = Math.floor(time * fixture.rate + 1e-8);
    this.texture.frame = fixture.pixel(index, 0, 0).join(",");
  };
  const context = { sequence: h.sequence, compositor: h.root, frameSamplerRoot: h.root,
    exportPolicy: { check() {} } };
  const release = h.state.beginExportSamples(h.root);
  try {
    await h.state.prepareFrameSamples(h.effect, frame - 10, context);
    await h.state.prepareExportSamples(context, frame);
    for (let sample = 0; sample < 16; sample++) {
      const time = frame + sample / 16 * 0.5;
      h.owner.update(time - 10);
      h.state.contexts.push({ compositor: h.root, rootCompositor: h.root, outputFrame: frame,
        renderingSequence: true, exportPolicy: context.exportPolicy });
      try {
        const taps = h.state.resolveFrameSamples(h.effect);
        const expected = fixture.pixel(Math.floor((time - 1 - 10) / 30 * fixture.rate + 1e-8), 0, 0).join(",") + "100";
        assert.equal(taps[0].target.value, expected, `shutter sample ${sample}`);
      } finally { h.state.contexts.pop(); }
    }
    assert.equal(h.source.texture.frame, 99, "live output texture remains untouched");
  } finally { release(); h.root.unload(); }
});

test("generated H.264 fixture decodes to known moving color frames", t => {
  const { spawnSync } = require("node:child_process");
  const fixture = require("../tools/generate-export-color-fixture.js");
  const result = spawnSync("ffmpeg", ["-v", "error", "-threads", "1", "-i", "test/fixtures/moving-colors.mp4",
    "-f", "rawvideo", "-pix_fmt", "rgb24", "-threads", "1", "pipe:1"]);
  if (result.error?.code === "ENOENT") { t.skip("ffmpeg is required for the H.264 fixture check"); return; }
  assert.equal(result.status, 0, result.stderr?.toString());
  assert.equal(result.stdout.length, fixture.width * fixture.height * 3 * fixture.count);
  for (let frame = 0; frame < fixture.count; frame++) for (const [x, y] of [[0, 0], [frame + 1, 9]]) {
    const offset = ((frame * fixture.height + y) * fixture.width + x) * 3;
    fixture.pixel(frame, x, y).forEach((value, channel) =>
      assert.ok(Math.abs(result.stdout[offset + channel] - value) < 12, `frame ${frame} channel ${channel}`));
  }
});

test("export policy reaches nested effects through CM3 clip and effect-group preparation", async () => {
  const sandbox = { PZ: { clip: class {
    prepare(frame) { return this.object.prepare(frame - this.start); }
  }, effect: { group: class { async prepare(frame) { for (const effect of this.objects) await effect.prepare(frame); } } } } };
  vm.runInNewContext(fs.readFileSync("plugins/core/temporal-export.js", "utf8"), sandbox);
  sandbox.__zoidiumTemporalParts.exportPreparation.installPreparationPolicy();
  const policy = { exportPolicy: { check() {} } };
  const clip = new sandbox.PZ.clip(); clip.start = 10;
  const group = clip.object = new sandbox.PZ.effect.group();
  let observed;
  group.objects = [{ async prepare(frame, context) { observed = { frame, context }; throw new Error("nested effect failure"); } }];
  await assert.rejects(clip.prepare(12.25, policy), /nested effect failure/);
  assert.equal(observed.frame, 2.25); assert.equal(observed.context, policy);
  await assert.rejects(clip.prepare(12.25), /nested effect failure/);
  assert.equal(observed.context, undefined, "preview uses the native preparation policy");
});

test("context loss rejects a pending effect preparation promptly", async () => {
  const PZ = videoHost(), canvas = new EventTarget();
  let started;
  const preparing = new Promise(resolve => { started = resolve; });
  const exp = Object.assign(new PZ.export(), { frame: 12, frameAdvance: 1, framesRendered: 0, totalFrames: 1,
    sequence: { prepare() { started(); return new Promise(() => {}); } },
    compositor: { unload() {} }, renderer: { domElement: canvas, context: { isContextLost: () => false }, dispose() {} } });
  const pending = exp.renderVideoFrame();
  await preparing;
  canvas.dispatchEvent(new Event("webglcontextlost"));
  await assert.rejects(pending, /WebGL context lost.*output index 0.*project frame 12/);
  assert.equal(exp.framesRendered, 0); assert.equal(exp.framePromise, null);
  assert.equal(exp.__zoidiumExportDisposed, true);
});

test("seek completion accepts Chromium clock rounding while retaining the exact requested time", async () => {
  const PZ = videoHost(), s = new PZ.schedule(); s.el = video(); s.texture = {};
  let observed = 0;
  Object.defineProperty(s.el, "currentTime", { get: () => observed, set(time) {
    observed = Math.floor(time * 500000) / 500000;
    queueMicrotask(() => s.el.dispatchEvent(new Event("seeked")));
  } });
  await s.decodeFrame(7.525 / 30);
  assert.equal(s.__zoidiumVideoExportState.requestedTime, 7.525 / 30);
  assert.equal(observed, 0.250832);
  assert.equal(s.texture.needsUpdate, true);
});

for (const failure of ["update", "prepare"]) test(`procedural ${failure} failures reject export and retain preview fallback`, async () => {
  const h = host(false);
  h.owner.effects[0]._zoidiumTemporal = { getOperator: () => ({ kind: "time-offset", enabled: true, offsetFrames: 1 }) };
  h.ownerClip.parentProject = { sequence: h.sequence };
  h.ownerClip.update = () => {};
  h.ownerClip.prepare = async () => {};
  h.ownerClip[failure] = () => { throw new Error(`fixture procedural ${failure} failure`); };
  const schedule = new h.PZ.schedule(h.PZ.schedule.type.NONE);
  schedule.items = [{ start: 10, length: 100, clip: h.ownerClip }];
  await assert.rejects(schedule.prepare(30, { sequence: h.sequence, exportPolicy: {} }),
    new RegExp(`requested frame.*fixture procedural ${failure} failure`));
  await schedule.prepare(30, { sequence: h.sequence });
});

test("export rejects an incomplete required temporal sample set", async () => {
  const h = host(false);
  h.parts.capture.captureFrameSamplerInput = () => false;
  await assert.rejects(h.state.prepareFrameSamples(h.effect, 20, { frameSamplerRoot: h.root, exportPolicy: {} }),
    /sample.*effect.*clip.*requested frame.*Incomplete required sample set/);
  assert.equal(h.state.frameSamplerRuntimes.get(h.root).prepared.get(h.effect), undefined);
});

test("Camera+ with one shutter sample prepares only the output time", async () => {
  const h = host(false);
  h.sequence.videoTracks[0].track3d = true;
  Object.assign(h.sequence.properties, { motionBlur:{get:()=>0}, motionBlurSamples:{get:()=>16},
    motionBlurShutter:{get:()=>0.5}, motionBlurSensitivity:{get:()=>100}, motionBlurTrackFrame:{get:()=>0} });
  const context = { sequence:h.sequence, frameSamplerRoot:h.root, exportPolicy:{check(){}} };
  await h.state.prepareFrameSamples(h.effect, 20, context);
  const decoded = h.decoded.length;
  await h.state.prepareExportSamples(context, 30);
  assert.equal(h.decoded.length, decoded, "a disabled shutter never requests unused media times");
});

test("temporal export errors include the actual CM3 effect and clip property names", async () => {
  const h = host(false);
  h.effect.properties = { name: { get: () => "Echo fixture" } };
  h.ownerClip.properties.name = { get: () => "Moving colors" };
  h.PZ.schedule.prototype.decodeFrame = async () => { throw new Error("fixture decode failure"); };
  await assert.rejects(h.state.prepareFrameSamples(h.effect, 20, { frameSamplerRoot:h.root, exportPolicy:{} }),
    /effect "Echo fixture", clip "Moving colors", requested frame.*fixture decode failure/);
});
