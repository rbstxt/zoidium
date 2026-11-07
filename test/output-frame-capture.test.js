"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { harness, flush } = require("./helpers/output-frame-harness.js");

async function prepared() {
  const h = harness({ manualChecks: true });
  await h.warm();
  h.check(); await flush();
  assert.equal(h.api.debug.entries, 1);
  h.viewport.editor.playback.speed = 1;
  return h;
}
async function checked(h) { h.clock.now += 101; h.check(); await flush(); }

test("a capture stays private until its deferred check and duplicate draws do not copy again", async () => {
  const h = await prepared();
  h.api.capturePreview(h.viewport, 1);
  assert.equal(h.api.debug.entries, 1);
  assert.equal(h.api.debug.pendingFrames, 1);
  const copies = h.counts.copies, checks = h.counts.checks, hits = h.api.debug.hits;
  h.viewport.editor.playback.currentFrame = 1;
  h.viewport._render(); h.viewport._render();
  assert.equal(h.counts.copies, copies);
  assert.equal(h.counts.checks, checks, "the render path never calls getError");
  assert.equal(h.api.debug.hits, hits);
  await checked(h);
  h.viewport._render();
  assert.equal(h.api.debug.hits, hits + 1);
  assert.equal(h.api.debug.pendingFrames, 0);
  h.api.dispose();
});

for (const stage of ["before capture", "during copy", "after copy"]) {
  for (const error of [1282, 1285]) test(stage + " GL error rejects the entire unchecked batch: " + error, async () => {
    const h = await prepared(), gl = h.viewport.renderer.context;
    const ceiling = h.api.debug.effectiveLimit;
    if (stage === "before capture") gl.error = error;
    h.api.capturePreview(h.viewport, 1);
    if (stage === "during copy") gl.copyError = error;
    h.api.capturePreview(h.viewport, 2);
    h.api.capturePreview(h.viewport, 3);
    if (stage === "after copy") gl.error = error;
    const copies = h.counts.copies;
    await checked(h);
    assert.equal(h.api.debug.pendingFrames, 0);
    assert.equal(h.api.debug.captureDiscards, 3);
    assert.equal(h.api.debug.entries, error === gl.OUT_OF_MEMORY ? 0 : 1);
    assert.equal(h.api.debug.effectiveLimit, error === gl.OUT_OF_MEMORY ? 57 : ceiling);
    for (const frame of [1, 2, 3]) {
      h.viewport.editor.playback.currentFrame = frame;
      const hits = h.api.debug.hits;
      h.viewport._render();
      assert.equal(h.api.debug.hits, hits, "failed pixels never replay");
    }
    assert.equal(h.counts.copies >= copies, true);
    h.api.dispose();
  });
}

for (const stage of ["allocation", "bind", "upload", "copy"]) {
  test(stage + " exception rejects earlier pending frames and checks OOM later", async () => {
    const h = await prepared(), gl = h.viewport.renderer.context, renderer = h.viewport.renderer;
    h.api.capturePreview(h.viewport, 1);
    const fail = () => { gl.error = gl.OUT_OF_MEMORY; throw new Error("Injected allocation failure"); };
    if (stage === "allocation") h.window.THREE.WebGLRenderTarget = class { constructor() { fail(); } };
    if (stage === "bind") renderer.setRenderTarget = target => { if (target) fail(); };
    if (stage === "upload") renderer.setTexture2D = fail;
    if (stage === "copy") gl.copyTexSubImage2D = fail;
    const checks = h.counts.checks;
    h.api.capturePreview(h.viewport, 2); await flush();
    assert.equal(h.counts.checks, checks, "exception handling does not force a synchronous GPU check");
    assert.equal(h.api.debug.pendingFrames, 0);
    await checked(h);
    assert.equal(h.api.debug.effectiveLimit, 57);
    assert.equal(h.api.debug.entries, 0);
    assert.equal(h.notices.length, 1);
    h.api.dispose();
  });
}

for (const stage of ["before capture", "allocation", "bind", "upload", "copy", "pending", "check"]) {
  test("context loss at " + stage + " never publishes or deletes dead textures", async () => {
    const h = await prepared(), gl = h.viewport.renderer.context, renderer = h.viewport.renderer;
    const disposed = h.counts.disposed;
    if (stage === "before capture") gl.lost = true;
    if (stage === "allocation") {
      const Target = h.window.THREE.WebGLRenderTarget;
      h.window.THREE.WebGLRenderTarget = class extends Target { constructor(...args) { super(...args); gl.lost = true; } };
    }
    if (stage === "bind") renderer.setRenderTarget = target => { if (target) gl.lost = true; };
    if (stage === "upload") renderer.setTexture2D = () => { gl.lost = true; };
    if (stage === "copy") gl.copyTexSubImage2D = () => { gl.lost = true; };
    h.api.capturePreview(h.viewport, 1);
    if (stage === "pending") gl.lost = true;
    if (stage === "check") gl.getError = () => { gl.lost = true; return 37442; };
    await checked(h);
    assert.equal(h.api.debug.entries, 0);
    assert.equal(h.api.debug.pendingFrames, 0);
    assert.equal(h.counts.disposed, disposed);
    assert.equal(h.api.debug.contextLosses, 1);
    h.canvasEvents.get("webglcontextlost")();
    assert.equal(h.api.debug.contextLosses, 1);
    h.api.dispose();
  });
}

for (const [name, invalidate] of [
  ["project replacement", h => { h.viewport.editor.project = new h.PZ.project(); h.viewport.editor.onProjectChanged.update(); }],
  ["unannounced project replacement", h => { h.viewport.editor.project = new h.PZ.project(); }],
  ["cache clear", h => h.api.clear()],
  ["cache resize", h => h.api.setSizeMiB(1)],
  ["resolution", h => h.project.sequence.properties.resolution.onChanged.update()],
  ["plugin change", h => h.docEvents.get("zoidium:plugin-state-change")()],
  ["edit signal", h => h.events.get("input")({ type: "input" })],
  ["release", h => h.api.release(h.viewport)],
  ["dispose", h => h.api.dispose()],
]) test(name + " while verification is pending cannot publish a stale frame", async () => {
  const h = await prepared();
  h.api.capturePreview(h.viewport, 1);
  invalidate(h);
  await checked(h);
  assert.equal(h.api.debug.pendingFrames, 0);
  assert.equal(h.api.debug.stores, 1);
  assert.equal(h.counts.disposed >= 1, true);
  h.api.dispose();
});

test("an error after invalidation still lowers the session ceiling before later publication", async () => {
  const h = await prepared(), gl = h.viewport.renderer.context;
  h.api.capturePreview(h.viewport, 1);
  h.api.clear();
  gl.error = gl.OUT_OF_MEMORY;
  await checked(h);
  assert.equal(h.api.debug.effectiveLimit, 0);
  h.api.setSizeMiB(16384);
  assert.equal(h.api.debug.effectiveLimit, 0);
  h.api.dispose();
});

test("four unchecked frames stop further copies until checks catch up", async () => {
  const h = await prepared();
  for (let frame = 1; frame <= 20; frame++) h.api.capturePreview(h.viewport, frame);
  assert.equal(h.api.debug.pendingFrames, 4);
  assert.equal(h.api.debug.pendingBytes, 256);
  assert.equal(h.counts.copies, 5);
  assert.equal(h.checks.size, 1);
  await checked(h);
  assert.equal(h.api.debug.entries, 5);
  h.api.dispose();
});

test("unchecked bytes are bounded and share the cache memory budget", async () => {
  const h = await prepared(), gl = h.viewport.renderer.context;
  gl.drawingBufferWidth = 4096; gl.drawingBufferHeight = 2048;
  h.api.setSizeMiB(80);
  // Capture through the queue directly because resizing deliberately resets readiness.
  const Queue = h.window.ZoidiumOutputFrameCapture.CaptureQueue;
  const { FrameStore } = require("../plugins/core/output-frame-store.js");
  const store = new FrameStore(80 * 1048576);
  const q = new Queue({ store, available: () => true, failed() {}, quiet: () => true,
    host: h.window, THREE: h.window.THREE });
  const controller = h.viewport.__zoidiumOutputFrames;
  const pending = [];
  for (let i = 0; i < 8; i++) pending.push(q.capture(controller, i, () => 0));
  assert.equal(q.pending.size, 2);
  assert.equal(q.bytes, 64 * 1048576);
  assert.equal(q.bytes + store.bytes <= store.effectiveLimit, true);
  q.check();
  for (const entry of await Promise.all(pending)) entry?.dispose();
  q.dispose(); h.api.dispose();
});

test("deferred verification waits during gestures and native history operations", async () => {
  const h = await prepared();
  h.api.capturePreview(h.viewport, 1);
  const checks = h.counts.checks;
  h.events.get("pointerdown")({ type: "pointerdown" });
  h.clock.now += 5000; h.check();
  assert.equal(h.counts.checks, checks, "a held pointer keeps verification out of the gesture");
  h.events.get("pointerup")({ type: "pointerup" });
  h.check();
  assert.equal(h.counts.checks, checks);
  h.history.operation = [];
  h.clock.now += 5000; h.check();
  assert.equal(h.counts.checks, checks);
  h.history.operation = null;
  await checked(h);
  assert.equal(h.api.debug.entries, 1, "input invalidated the private capture");
  assert.equal(h.api.debug.pendingFrames, 0);
  h.api.dispose();
});

test("an unrelated error cannot hide OOM behind it", async () => {
  const h = await prepared(), gl = h.viewport.renderer.context;
  h.api.capturePreview(h.viewport, 1);
  const errors = [1282, gl.OUT_OF_MEMORY, gl.NO_ERROR];
  gl.getError = () => errors.shift();
  await checked(h);
  assert.equal(h.api.debug.effectiveLimit, 57);
  assert.equal(h.api.debug.entries, 0);
  h.api.dispose();
});

test("export compositors never enter the preview capture queue", async () => {
  const h = await prepared();
  const checks = h.counts.checks, copies = h.counts.copies;
  const compositor = new h.Compositor(h.viewport.renderer);
  for (let frame = 0; frame < 5; frame++) compositor.renderSequence(frame);
  assert.equal(h.counts.checks, checks);
  assert.equal(h.counts.copies, copies);
  assert.equal(h.api.debug.pendingFrames, 0);
  h.api.dispose();
});

test("replacement after a clean check but before its promise callback still rejects the frame", async () => {
  const h = await prepared();
  h.api.capturePreview(h.viewport, 1);
  h.check();
  h.viewport.editor.project = new h.PZ.project();
  h.viewport.editor.onProjectChanged.update();
  await flush();
  assert.equal(h.api.debug.stores, 1);
  assert.equal(h.api.debug.entries, 0);
  h.api.dispose();
});

test("the task timer verifies later and cancels its scheduled check on disposal", async () => {
  const h = await prepared();
  const { CaptureQueue } = require("../plugins/core/output-frame-capture.js");
  const { FrameStore } = require("../plugins/core/output-frame-store.js");
  const tasks = new Map(); let id = 0;
  const host = { setTimeout(fn, delay) { assert.equal(delay, 16); tasks.set(++id, fn); return id; },
    clearTimeout(key) { tasks.delete(key); } };
  const q = new CaptureQueue({ store: new FrameStore(1024), available: () => true, failed() {}, quiet: () => true,
    host, THREE: h.window.THREE });
  const checks = h.counts.checks;
  const promise = q.capture(h.viewport.__zoidiumOutputFrames, 1, () => 0);
  assert.equal(h.counts.checks, checks);
  assert.equal(tasks.size, 1);
  q.dispose();
  assert.equal(await promise, null);
  assert.equal(tasks.size, 0);
  h.api.dispose();
});

test("a cancelled promise cannot remove a newer pending capture for the same frame", async () => {
  const h = await prepared();
  h.api.capturePreview(h.viewport, 1);
  h.api.clear();
  const controller = h.viewport.__zoidiumOutputFrames;
  // Complete the new revision synchronously to exercise both promise callbacks
  // in one turn, before the cancelled request can remove the newer token.
  controller.key = controller.full;
  controller.settled = controller.key;
  h.api.capturePreview(h.viewport, 1);
  await flush();
  assert.equal(controller.pendingFrames.size, 1);
  assert.equal(h.api.debug.pendingFrames, 1);
  await checked(h);
  assert.equal(controller.pendingFrames.size, 0);
  assert.equal(h.api.debug.entries, 1);
  h.viewport.editor.playback.currentFrame = 1;
  const hits = h.api.debug.hits;
  h.viewport._render();
  assert.equal(h.api.debug.hits, hits + 1);
  h.api.dispose();
});

test("releasing a lost context before its pending check does not count the same loss twice", async () => {
  const h = await prepared(), gl = h.viewport.renderer.context;
  h.api.capturePreview(h.viewport, 1);
  gl.lost = true;
  h.canvasEvents.get("webglcontextlost")();
  assert.equal(h.api.debug.contextLosses, 1);
  h.api.release(h.viewport);
  await checked(h);
  assert.equal(h.api.debug.contextLosses, 1);
  assert.equal(h.api.debug.effectiveLimit, 32);
  h.api.dispose();
});
