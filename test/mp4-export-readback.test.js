"use strict";

// The finished MP4 is read back out of the origin-private file system before it
// becomes a download. Chromium reports every read error there as
// "TypeError: Failed to fetch", which tells the user nothing, so the read uses a
// fresh snapshot per attempt, falls back to the temporary file as the download,
// and explains itself when both fail.

const assert = require("node:assert/strict");
const test = require("node:test");

const { createStorage } = require("../plugins/mp4-export/stream-target.js");
const { createJob } = require("../plugins/mp4-export/render.js");

const READBACK_MESSAGE = "MP4 was encoded, but the browser could not read the finished file from " +
  "temporary storage. Free some disk space and try again, or use MKV/WebM.";
const MEMORY_MESSAGE = "MP4 ran out of memory or temporary storage. Reduce the output size or " +
  "close other projects and try again.";

const params = { width: 640, height: 360, rate: 30, quality: 2, bitrateScale: 1, start: 0, length: 1 };
const profiles = Array.from({ length: 5 }, () => ({ bitrate: 1 }));
const FAST = [0, 0, 0, 0];
const FAILED_TO_FETCH = () => new TypeError("Failed to fetch");
let instances = 0;

function supports(predicate) {
  return { async isConfigSupported(config) { return { supported: predicate(config), config }; } };
}

function writeAt(bytes, position, data) {
  const end = position + data.byteLength;
  const next = new Uint8Array(Math.max(bytes.byteLength, end));
  next.set(bytes.subarray(0, position));
  next.set(data, position);
  if (bytes.byteLength > end) next.set(bytes.subarray(end), end);
  return next;
}

// A small origin-private file system: one root directory, named files, and
// handles that snapshot their bytes on getFile() the way the browser does.
function fakeOpfs(options = {}) {
  const instance = ++instances;
  const state = {
    entries: new Map(),
    created: [],
    removed: [],
    getFileCalls: 0,
    copies: 0,
    writes: 0,
    closes: 0,
    names: 0,
    copyError: options.copyError || (() => null),
    getFileError: options.getFileError || null,
    snapshot: options.snapshot || ((bytes) => bytes),
  };

  function handle(name) {
    return {
      async createWritable() {
        let bytes = state.entries.get(name) || new Uint8Array(0);
        return {
          async write(init) {
            state.writes += 1;
            bytes = writeAt(bytes, init.position, init.data);
          },
          async close() {
            state.closes += 1;
            state.entries.set(name, bytes);
          },
          async abort() {},
        };
      },
      async getFile() {
        state.getFileCalls += 1;
        if (state.getFileError) throw state.getFileError;
        const bytes = state.entries.get(name);
        if (!bytes) throw new TypeError("The temporary file is gone.");
        // The wrapper copies in Node, so a later removal cannot change it; the
        // snapshot hook models a truncated or changed file instead.
        return new File([state.snapshot(bytes)], name);
      },
    };
  }

  const directory = {
    async getFileHandle(name, init) {
      if (!state.entries.has(name)) {
        if (!init || !init.create) throw new DOMException(name, "NotFoundError");
        state.entries.set(name, new Uint8Array(0));
      }
      state.created.push(name);
      return handle(name);
    },
    async removeEntry(name) {
      state.removed.push(name);
      if (!state.entries.delete(name)) throw new DOMException(name, "NotFoundError");
    },
  };

  class FakeResponse {
    constructor(body, init) {
      this.body = body;
      this.type = (init && init.headers && init.headers["Content-Type"]) || "";
    }
    async blob() {
      state.copies += 1;
      const error = state.copyError(state.copies);
      if (error) throw error;
      const chunks = [];
      const reader = this.body.getReader();
      for (;;) {
        const result = await reader.read();
        if (result.done) break;
        chunks.push(result.value);
      }
      return new Blob(chunks, { type: this.type });
    }
  }

  const listeners = new Map();
  const scope = {
    navigator: { storage: { async getDirectory() { return directory; } } },
    crypto: { randomUUID: () => "uuid-" + instance + "-" + (++state.names) },
    Response: FakeResponse,
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(listener);
    },
  };

  function dispatch(type) {
    for (const listener of listeners.get(type) || []) listener({ type });
  }

  return { state, scope, dispatch };
}

function captureWarnings() {
  const warnings = [];
  const original = console.warn;
  console.warn = (...args) => { warnings.push(args.join(" ")); };
  return { warnings, restore() { console.warn = original; } };
}

async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 5));
}

async function fill(storage, bytes) {
  const writer = storage.target.stream.getWriter();
  await writer.write({ position: 0, data: Uint8Array.from(bytes) });
  await writer.close();
}

function fakeBunny() {
  return {
    StreamTarget: class { constructor(stream) { this.stream = stream; } },
    Output: class {
      constructor(options) { this.target = options.target; this.state = "pending"; }
      addVideoTrack() {}
      addAudioTrack() {}
      async start() { this.state = "started"; }
      async finalize() {
        const writer = this.target.stream.getWriter();
        await writer.write({ position: 0, data: Uint8Array.of(7) });
        await writer.close();
        this.state = "finalized";
      }
      async cancel() { this.state = "canceled"; }
    },
    Mp4OutputFormat: class {}, Quality: class {},
    CanvasSource: class { async add() {} },
  };
}

function jobExporter() {
  return {
    params,
    sequence: { properties: { rate: { get: () => 30 } } },
    renderer: { domElement: { width: 640, height: 360 } },
    framesRendered: 0,
    async renderVideoFrame() { this.framesRendered += 1; },
  };
}

function jobScope(opfs) {
  return Object.assign({ VideoEncoder: supports(() => true) }, opfs.scope);
}

test("a readable finished file is copied once and the temporary entry is removed", async () => {
  const opfs = fakeOpfs();
  const storage = await createStorage(opfs.scope, fakeBunny(), { delays: FAST });
  await fill(storage, [1, 2, 3, 4]);
  const { warnings, restore } = captureWarnings();
  let blob;
  try {
    blob = await storage.finish();
  } finally {
    restore();
  }
  assert.equal(blob.type, "video/mp4");
  assert.deepEqual([...new Uint8Array(await blob.arrayBuffer())], [1, 2, 3, 4]);
  assert.equal(opfs.state.getFileCalls, 1, "one snapshot");
  assert.equal(opfs.state.copies, 1, "one copy");
  assert.deepEqual(warnings, []);
  await storage.dispose();
  assert.deepEqual(opfs.state.removed, [opfs.state.created[0]]);
  assert.equal(opfs.state.entries.size, 0);
});

test("a failed copy retries with a fresh snapshot and reports one warning per attempt", async () => {
  const opfs = fakeOpfs({ copyError: (attempt) => (attempt === 1 ? FAILED_TO_FETCH() : null) });
  const storage = await createStorage(opfs.scope, fakeBunny(), { delays: FAST });
  await fill(storage, [5, 6, 7]);
  const { warnings, restore } = captureWarnings();
  let blob;
  try {
    blob = await storage.finish();
  } finally {
    restore();
  }
  assert.deepEqual([...new Uint8Array(await blob.arrayBuffer())], [5, 6, 7]);
  assert.equal(opfs.state.getFileCalls, 2, "every attempt takes a new snapshot");
  assert.equal(opfs.state.copies, 2);
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0],
    "[Zoidium] MP4 output read-back failed (attempt 1): TypeError: Failed to fetch");
  await storage.dispose();
  assert.equal(opfs.state.entries.size, 0, "a copied file is still removed");
});

test("an unreadable copy falls back to the temporary file and keeps it for the download", async () => {
  const opfs = fakeOpfs({ copyError: () => FAILED_TO_FETCH() });
  const storage = await createStorage(opfs.scope, fakeBunny(), { delays: FAST });
  await fill(storage, [9, 8, 7, 6]);
  const { warnings, restore } = captureWarnings();
  let blob;
  try {
    blob = await storage.finish();
  } finally {
    restore();
  }
  assert.equal(warnings.length, 4, "each failed attempt is reported once");
  assert.equal(blob.type, "video/mp4", "the download keeps an MP4 type");
  assert.deepEqual([...new Uint8Array(await blob.arrayBuffer())], [9, 8, 7, 6]);
  assert.equal(opfs.state.copies, 4);
  assert.equal(opfs.state.getFileCalls, 5, "four attempts and one fresh file for the fallback");

  const [retained] = opfs.state.created;
  await storage.dispose();
  assert.deepEqual(opfs.state.removed, [], "the entry must stay readable for the download");
  assert.equal(opfs.state.entries.size, 1);

  // Another tab exports into its own entry while this page starts a new one.
  opfs.state.entries.set("zoidium-mp4-other-tab", Uint8Array.of(1));
  const next = await createStorage(opfs.scope, fakeBunny(), { delays: FAST });
  assert.deepEqual(opfs.state.removed, [retained], "only the entry this page kept is removed");
  assert.equal(opfs.state.entries.has(retained), false);
  assert.equal(opfs.state.entries.has("zoidium-mp4-other-tab"), true, "another tab is untouched");
  await next.dispose();
  assert.equal(opfs.state.entries.has("zoidium-mp4-other-tab"), true);
});

test("leaving the page removes a temporary file this page kept", async () => {
  const opfs = fakeOpfs({ copyError: () => FAILED_TO_FETCH() });
  const storage = await createStorage(opfs.scope, fakeBunny(), { delays: FAST });
  await fill(storage, [4, 4]);
  const { warnings, restore } = captureWarnings();
  try {
    await storage.finish();
  } finally {
    restore();
  }
  await storage.dispose();
  assert.equal(opfs.state.entries.size, 1);
  opfs.dispatch("pagehide");
  await flush();
  assert.deepEqual(opfs.state.removed, [opfs.state.created[0]]);
  assert.equal(opfs.state.entries.size, 0);
  assert.ok(warnings.every((warning) => /MP4 output read-back failed/.test(warning)));
});

test("a wrong-sized temporary file is never offered as a download", async () => {
  const opfs = fakeOpfs({
    copyError: () => FAILED_TO_FETCH(),
    snapshot: (bytes) => bytes.subarray(0, bytes.byteLength - 1),
  });
  const storage = await createStorage(opfs.scope, fakeBunny(), { delays: FAST });
  await fill(storage, [1, 2, 3, 4]);
  const { restore } = captureWarnings();
  let error;
  try {
    await storage.finish();
  } catch (rejected) {
    error = rejected;
  } finally {
    restore();
  }
  assert.equal(error.message, READBACK_MESSAGE);
  assert.equal(error.cause && error.cause.name, "TypeError");
  assert.equal(error.cause && error.cause.message, "Failed to fetch");
  await storage.dispose();
  assert.equal(opfs.state.entries.size, 0, "an unusable entry is removed");
});

test("an unreadable snapshot reports the last error and removes the entry", async () => {
  const broken = new DOMException("The file could not be opened.", "NotReadableError");
  const opfs = fakeOpfs({ getFileError: broken });
  const storage = await createStorage(opfs.scope, fakeBunny(), { delays: FAST });
  await fill(storage, [1]);
  const { warnings, restore } = captureWarnings();
  let error;
  try {
    await storage.finish();
  } catch (rejected) {
    error = rejected;
  } finally {
    restore();
  }
  assert.equal(error.message, READBACK_MESSAGE);
  assert.equal(error.cause, broken, "the last read error is retained as the cause");
  assert.equal(warnings.length, 4, "a failed snapshot is a failed attempt");
  assert.match(warnings[0], /attempt 1\): NotReadableError: The file could not be opened\./);
  await storage.dispose();
  assert.equal(opfs.state.entries.size, 0);
});

test("a cancelled export stops retrying the read-back", async () => {
  const controller = new AbortController();
  const opfs = fakeOpfs({
    copyError: () => {
      controller.abort();
      return FAILED_TO_FETCH();
    },
  });
  const storage = await createStorage(opfs.scope, fakeBunny(),
    { signal: controller.signal, delays: [0, 250, 1000, 3000] });
  await fill(storage, [1, 2]);
  const { warnings, restore } = captureWarnings();
  let error;
  try {
    await storage.finish();
  } catch (rejected) {
    error = rejected;
  } finally {
    restore();
  }
  assert.equal(error.name, "AbortError");
  assert.equal(opfs.state.getFileCalls, 1, "the retry schedule stops at the abort");
  assert.equal(opfs.state.copies, 1);
  assert.deepEqual(warnings, [], "a cancellation is not a read-back failure");
  await storage.dispose();
});

test("a quota error during the read-back keeps the memory message", async () => {
  const quota = Object.assign(new Error("The quota has been exceeded."), { name: "QuotaExceededError" });
  const opfs = fakeOpfs({ copyError: () => quota });
  const exporter = jobExporter();
  await assert.rejects(createJob(jobScope(opfs), { av: { profiles } }, exporter, fakeBunny).run(), (error) => {
    assert.equal(error.message, MEMORY_MESSAGE);
    return true;
  });
  assert.equal(opfs.state.copies, 1, "a quota error is not retried");
  assert.equal(opfs.state.entries.size, 0, "the temporary entry is still cleaned up");
});

test("an unreadable finished MP4 never reaches the page as Failed to fetch", async () => {
  // The copy fails every time and the temporary file is incomplete, so the
  // export cannot succeed. That is the one path the user must read as text.
  const opfs = fakeOpfs({
    copyError: () => FAILED_TO_FETCH(),
    snapshot: (bytes) => bytes.subarray(0, bytes.byteLength - 1),
  });
  const exporter = jobExporter();
  let error;
  try {
    await createJob(jobScope(opfs), { av: { profiles } }, exporter, fakeBunny).run();
  } catch (rejected) {
    error = rejected;
  }
  assert.ok(error, "the job must reject");
  assert.equal(error.message, READBACK_MESSAGE);
  assert.doesNotMatch(error.message, /Failed to fetch/);
  assert.equal(error.cause && error.cause.name, "TypeError");
  assert.equal(exporter.framesRendered, 1, "the frames were encoded before the read failed");
  assert.equal(opfs.state.entries.size, 0, "the unusable temporary file is removed");
});

test("a readable export through the job still yields the copied video", async () => {
  const opfs = fakeOpfs({ copyError: (attempt) => (attempt === 1 ? FAILED_TO_FETCH() : null) });
  const exporter = jobExporter();
  const blob = await createJob(jobScope(opfs), { av: { profiles } }, exporter, fakeBunny).run();
  assert.equal(blob.type, "video/mp4");
  assert.deepEqual([...new Uint8Array(await blob.arrayBuffer())], [7]);
  assert.equal(opfs.state.copies, 2);
  assert.equal(opfs.state.entries.size, 0);
});

test("a complete export whose copy keeps failing still downloads through the job", async () => {
  const opfs = fakeOpfs({ copyError: () => FAILED_TO_FETCH() });
  const exporter = jobExporter();
  const blob = await createJob(jobScope(opfs), { av: { profiles } }, exporter, fakeBunny).run();
  assert.equal(blob.type, "video/mp4");
  assert.deepEqual([...new Uint8Array(await blob.arrayBuffer())], [7]);
  assert.equal(opfs.state.copies, 4, "every scheduled copy was tried");
  assert.equal(opfs.state.entries.size, 1, "the job's cleanup keeps the file the download reads");
});
