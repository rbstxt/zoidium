"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");

function host(nativeExport, debugLog) {
  class Dispatcher {
    addEventListener(name, listener) { (this.listeners ||= {}); (this.listeners[name] ||= []).push(listener); }
    removeEventListener(name, listener) {
      const list = this.listeners?.[name] || [];
      if (list.includes(listener)) list.splice(list.indexOf(listener), 1);
    }
  }
  class Texture extends Dispatcher {}
  const onChanged = {
    watchers: [],
    watch(fn, now) { this.watchers.push(fn); if (now) fn(); },
    unwatch(fn) { const i = this.watchers.indexOf(fn); if (i >= 0) this.watchers.splice(i, 1); },
  };
  const sequence = { properties: { resolution: { onChanged }, rate: { get: () => 30 } } };
  const texture = new Texture();
  const log = [];
  function makeRenderer(name) {
    const listener = () => {};
    return {
      name, listener, context: { isContextLost: () => false }, domElement: new EventTarget(),
      render(shared) { shared.addEventListener("dispose", listener); },
      dispose() { log.push(name + ":dispose"); },
      forceContextLoss() { log.push(name + ":lost"); },
    };
  }
  const Native = nativeExport || function NativeExport(seq) {
    this.sequence = seq;
    this.renderer = makeRenderer("export");
    this.compositor = { unload() { log.push("compositor:unload"); } };
    seq.properties.resolution.onChanged.watch(() => {}, true);
  };
  const PZ = { schedule: class {}, export: Native };
  vm.runInNewContext(fs.readFileSync("plugins/core/video-frame-export.js", "utf8"), {
    PZ, setTimeout, clearTimeout, AbortController, ZOIDIUM_DEBUG_LOG: debugLog, THREE: { EventDispatcher: Dispatcher },
  });
  return { PZ, sequence, texture, log, makeRenderer, onChanged };
}

test("unloading an export releases its context and every reference to its renderer", () => {
  const { PZ, sequence, texture, log, makeRenderer, onChanged } = host();
  const viewport = makeRenderer("viewport");
  onChanged.watch(() => {});
  viewport.render(texture);
  const editorWatchers = onChanged.watchers.slice();
  for (let run = 0; run < 3; run++) {
    const exporter = new PZ.export(sequence);
    assert.equal(exporter.renderer.__zoidiumExportRenderer, true);
    assert.equal(viewport.__zoidiumExportRenderer, undefined);
    exporter.renderer.render(texture);
    assert.equal(texture.listeners.dispose.length, 2);
    assert.equal(onChanged.watchers.length, editorWatchers.length + 1);
    exporter.unload();
    exporter.unload();
    assert.deepEqual(texture.listeners.dispose, [viewport.listener]);
    assert.deepEqual(onChanged.watchers, editorWatchers);
  }
  assert.deepEqual(log.slice(0, 3), ["compositor:unload", "export:dispose", "export:lost"]);
  assert.equal(log.filter(entry => entry === "export:lost").length, 3);
  assert.equal(log.filter(entry => entry === "viewport:lost").length, 0);
});

test("a failing native unload still releases the context", () => {
  const { PZ, sequence, log } = host();
  const exporter = new PZ.export(sequence);
  exporter.compositor.unload = () => { throw new Error("fixture unload failure"); };
  assert.throws(() => exporter.unload(), /fixture unload failure/);
  assert.ok(log.includes("export:lost"));
});

test("an outer constructor that calls the export as a function is tracked", () => {
  const { PZ, sequence, onChanged, log } = host();
  const Inner = PZ.export;
  const Outer = function outerExport() { return Inner.apply(this, arguments); };
  Outer.prototype = Inner.prototype;
  const exporter = new Outer(sequence);
  assert.equal(onChanged.watchers.length, 1);
  exporter.unload();
  assert.equal(onChanged.watchers.length, 0);
  assert.ok(log.includes("export:lost"));
});

test("listeners of a renderer that was not created by an export stay attached", () => {
  const { PZ, sequence, texture, makeRenderer } = host();
  const viewport = makeRenderer("viewport");
  const exporter = new PZ.export(sequence);
  viewport.render(texture);
  exporter.unload();
  assert.deepEqual(texture.listeners.dispose, [viewport.listener]);
});

test("a frame still preparing at unload stops without touching the released compositor", async () => {
  const { PZ, sequence } = host();
  let finishPrepare, rendered = 0;
  const exporter = new PZ.export(sequence);
  Object.assign(exporter, { frame: 0, frameAdvance: 1, framesRendered: 0, totalFrames: 2, params: { width: 1, height: 1 } });
  sequence.prepare = () => new Promise(resolve => { finishPrepare = resolve; });
  exporter.compositor.renderSequence = () => { rendered++; };
  const schedule = { el: { pause() {}, removeAttribute() { throw new Error("cancellation must keep the decoder"); }, load() {} }, currentItem: {} };
  sequence.videoSchedules = [schedule];
  const pending = exporter.renderVideoFrame(new Uint8Array(4));
  await new Promise(resolve => setImmediate(resolve));
  exporter.unload();
  await assert.rejects(pending, error => error.name === "AbortError");
  finishPrepare();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(rendered, 0);
  assert.equal(exporter.framesRendered, 0);
  assert.ok(schedule.currentItem);
});

test("the native encoder never receives a frame or audio result after unload", async () => {
  function Native(seq) { this.sequence = seq; }
  let release;
  Native.prototype.getAudioSamples = () => new Promise(resolve => { release = resolve; });
  Native.prototype.unload = function () {};
  const { PZ, sequence } = host(Native);
  const exporter = new PZ.export(sequence);
  let settled = false;
  exporter.getAudioSamples(4).then(() => { settled = true; }, () => { settled = true; });
  exporter.unload();
  release(new Float32Array(4));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(settled, false);

  const live = new PZ.export(sequence);
  const audio = live.getAudioSamples(4);
  release("samples");
  assert.equal(await audio, "samples");
  // A real frame failure unloads the export too. It must still reach the encoder.
  live.renderVideoFrame = async function () { this.unload(); throw new Error("fixture frame failure"); };
  await assert.rejects(live.getVideoFrame(new Uint8Array(4)), /fixture frame failure/);
});


test("export records the size of float accumulation targets once", async () => {
  const events = [], { PZ, sequence } = host(undefined, { record: (type, detail) => events.push({ type, ...detail }) });
  const exporter = new PZ.export(sequence);
  Object.assign(exporter, { frame: 0, frameAdvance: 1, framesRendered: 0, totalFrames: 2 });
  sequence.prepare = async () => {};
  exporter.compositor.accumBuffers = Array.from({ length: 2 }, () => ({ width: 3840, height: 2160, texture: { type: undefined } }));
  exporter.compositor.renderSequence = () => {};
  await exporter.renderVideoFrame();
  await exporter.renderVideoFrame();
  assert.equal(events.length, 1);
  assert.equal(events[0].type, "export-gpu-target");
  assert.equal(events[0].estimatedBytes, 3840 * 2160 * 16 * 2);
  assert.equal(events[0].count, 2);
});


test("export records compositor target estimates when the target count grows", async () => {
  const events = [], { PZ, sequence } = host(undefined, { record: (type, detail) => events.push({ type, ...detail }) });
  const exporter = new PZ.export(sequence);
  Object.assign(exporter, { frame: 0, frameAdvance: 1, framesRendered: 0, totalFrames: 2 });
  sequence.prepare = async () => {};
  const makeTarget = () => ({ width: 3840, height: 2160 });
  Object.assign(exporter.compositor, { readBuffer: makeTarget(), writeBuffer: makeTarget(), screenBuffers: [makeTarget()] });
  exporter.compositor.renderSequence = () => {};
  await exporter.renderVideoFrame();
  exporter.compositor.screenBuffers.push(makeTarget());
  await exporter.renderVideoFrame();
  assert.deepEqual(events.map(event => event.count), [3, 4]);
  assert.equal(events[1].estimatedBytes, 3840 * 2160 * 4 * 4);
});
