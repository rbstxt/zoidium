"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { PATCH_MARKER, install } = require("../plugins/core/export-audio-trace");

function createGlobal(enabled) {
  const store = new Map();
  if (enabled) store.set("zoidium:export-audio-trace", "1");
  return {
    localStorage: { getItem: (key) => (store.has(key) ? store.get(key) : null) },
  };
}

function createPZ() {
  function Export() {}
  Export.prototype.getAudioSamples = async function getAudioSamples(num) {
    this.requested = (this.requested || []).concat(num);
    return { length: num };
  };

  const worker = {
    onmessage: async function onmessage() {
      worker.handled = (worker.handled || 0) + 1;
    },
  };

  const PZ = {
    export: { prototype: Export.prototype },
    av: {
      audioBuffer: null,
      bufferStartSample: 0,
      worker: null,
      encode() {
        PZ.av.worker = worker;
        return "encoded";
      },
    },
  };
  return { PZ, Export, worker };
}

test("the trace stays off unless it is explicitly enabled", () => {
  const scope = createGlobal(false);
  const { PZ, Export } = createPZ();
  const original = Export.prototype.getAudioSamples;

  assert.equal(install(PZ, scope), false);
  assert.equal(Export.prototype.getAudioSamples, original, "nothing was patched");
  assert.equal(scope.ZoidiumExportAudioTrace, undefined);
});

test("install is idempotent once enabled", () => {
  const scope = createGlobal(true);
  const { PZ } = createPZ();

  assert.equal(install(PZ, scope), true);
  assert.equal(install(PZ, scope), true);
  assert.ok(scope.ZoidiumExportAudioTrace);
});

test("segment tracing forwards the render result untouched", async () => {
  const scope = createGlobal(true);
  const { PZ, Export } = createPZ();
  install(PZ, scope);

  const instance = new Export();
  instance.sample = 400000;
  instance.totalSamples = 480000;
  const rendered = await instance.getAudioSamples(1600);

  assert.equal(rendered.length, 1600, "caller still receives the rendered buffer");
  const [entry] = scope.ZoidiumExportAudioTrace.trace.segments;
  assert.equal(entry.requested, 1600);
  assert.equal(entry.startSample, 400000);
  assert.equal(entry.remaining, 80000);
  assert.equal(entry.renderedSamples, 1600);
});

test("the worker feed wrapper records the refill state and forwards messages", async () => {
  const scope = createGlobal(true);
  const { PZ, worker } = createPZ();
  install(PZ, scope);

  assert.equal(PZ.av.encode(), "encoded", "encode result is preserved");
  assert.notEqual(worker[PATCH_MARKER], undefined, "the worker feed is wrapped");

  // A drained segment with fewer samples left than the frame needs: this is the
  // shape that makes the worker copy stale ring-buffer data.
  PZ.av.audioBuffer = { length: 1000 };
  PZ.av.bufferStartSample = 800;
  await worker.onmessage({ data: { type: "audio", num: 1600 } });

  const [entry] = scope.ZoidiumExportAudioTrace.trace.feed;
  assert.equal(entry.available, 200);
  assert.equal(entry.filled, 200);
  assert.equal(entry.short, true);
  assert.equal(entry.staleTailSamples, 1400);
  assert.equal(worker.handled, 1, "the original handler still ran");
});

test("a healthy feed is recorded as not short", async () => {
  const scope = createGlobal(true);
  const { PZ, worker } = createPZ();
  install(PZ, scope);
  PZ.av.encode();

  PZ.av.audioBuffer = { length: 40000 };
  PZ.av.bufferStartSample = 0;
  await worker.onmessage({ data: { type: "audio", num: 1600 } });

  const [entry] = scope.ZoidiumExportAudioTrace.trace.feed;
  assert.equal(entry.filled, 1600);
  assert.equal(entry.short, false);
  assert.equal(scope.ZoidiumExportAudioTrace.trace.shortFeeds.length, 0);
});

test("non-audio worker messages are ignored by the trace", async () => {
  const scope = createGlobal(true);
  const { PZ, worker } = createPZ();
  install(PZ, scope);
  PZ.av.encode();

  await worker.onmessage({ data: { type: "video" } });
  assert.equal(scope.ZoidiumExportAudioTrace.trace.feed.length, 0);
  assert.equal(worker.handled, 1);
});

test("the report names short feeds when they happened", async () => {
  const scope = createGlobal(true);
  const { PZ, worker } = createPZ();
  install(PZ, scope);
  PZ.av.encode();

  PZ.av.audioBuffer = { length: 900 };
  PZ.av.bufferStartSample = 500;
  await worker.onmessage({ data: { type: "audio", num: 1600 } });

  const report = scope.ZoidiumExportAudioTrace.report();
  assert.match(report, /SHORT FEEDS/);
  assert.match(report, /staleTailSamples/);
});
