"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createIoSerializer, createWebLockRunner } = require("../plugins/core/io-serialization");

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 10));
  await new Promise((resolve) => setImmediate(resolve));
}

function videoBlob() {
  return new Blob([new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 1])]);
}

function archiveBlob() {
  return new Blob([new Uint8Array([0x1f, 0x8b, 8])]);
}

function watchResult(promise) {
  const result = { state: "pending" };
  promise.then(
    () => { result.state = "fulfilled"; },
    () => { result.state = "rejected"; },
  );
  return result;
}

test("Cancel prevents every encode queued behind an archive from starting", { timeout: 2000 }, async () => {
  const gate = deferred();
  const events = [];
  const io = createIoSerializer({
    deleteOutFile: () => { events.push("cleanup"); },
  });
  const tar = io.wrapTar(async () => {
    events.push("archive starts");
    await gate.promise;
    events.push("archive finishes");
    return archiveBlob();
  });
  const encode = io.wrapEncode(() => {
    events.push("native encode starts");
    return videoBlob();
  });
  const stop = io.wrapStop(() => events.push("native stop"));
  const cleanup = io.wrapCleanUp(() => {});
  const saving = tar();
  await flush();
  const results = [watchResult(encode()), watchResult(encode())];
  await flush();
  stop();
  const cleaning = cleanup();
  await flush();
  assert.equal(io.state().running, "archive");
  assert.deepEqual(events, ["archive starts", "native stop"]);

  gate.resolve();
  await saving;
  await cleaning;
  await flush();
  assert.deepEqual(events, ["archive starts", "native stop", "archive finishes", "cleanup"]);
  assert.deepEqual(results.map((result) => result.state), ["pending", "pending"]);
  assert.deepEqual(io.state(), { queued: 0, running: null, completed: 2, coordination: "page-only" });

  // A fresh export after Cancel must still work.
  const output = await encode();
  assert.deepEqual(await output.arrayBuffer(), await videoBlob().arrayBuffer());
});

test("Cancel during quota releases the slot and blocks the late native encode", { timeout: 2000 }, async () => {
  const quota = deferred();
  const events = [];
  const io = createIoSerializer({
    ensureQuota: () => { events.push("quota requested"); return quota.promise; },
    deleteOutFile: () => { events.push("cleanup"); },
  });
  const encode = io.wrapEncode(() => {
    events.push("native encode starts");
    return videoBlob();
  });
  const stop = io.wrapStop(() => events.push("native stop"));
  const result = watchResult(encode());
  await flush();
  stop();
  await io.wrapCleanUp(() => {})();
  assert.deepEqual(events, ["quota requested", "native stop", "cleanup"]);
  quota.resolve();
  await flush();
  assert.deepEqual(events, ["quota requested", "native stop", "cleanup"]);
  assert.equal(result.state, "pending");
  assert.equal(io.state().completed, 1);
  assert.equal(io.state().running, null);
});

test("Cancel before the queue starts prevents a same-turn quota grant from encoding", { timeout: 2000 }, async () => {
  let calls = 0;
  const io = createIoSerializer();
  const encode = io.wrapEncode(() => { calls += 1; return videoBlob(); });
  const result = watchResult(encode());
  io.wrapStop(() => {})();
  await io.enqueue("barrier", () => {});
  await flush();
  assert.equal(calls, 0);
  assert.equal(result.state, "pending");
  assert.equal(io.state().running, null);
});

test("Cancel and quota resolution in the same turn cannot start the native encoder", { timeout: 2000 }, async () => {
  const quota = deferred();
  const io = createIoSerializer({ ensureQuota: () => quota.promise });
  let calls = 0;
  const result = watchResult(io.wrapEncode(() => { calls += 1; return videoBlob(); })());
  await flush();
  quota.resolve();
  io.wrapStop(() => {})();
  await io.enqueue("barrier", () => {});
  await flush();
  assert.equal(calls, 0);
  assert.equal(result.state, "pending");
});

test("Cancel while waiting for the origin lock prevents quota and native work", { timeout: 2000 }, async () => {
  const gate = deferred();
  const events = [];
  const io = createIoSerializer({
    runExclusive: createWebLockRunner({
      request: async (_name, _options, task) => {
        await gate.promise;
        return task();
      },
    }),
    ensureQuota: () => events.push("quota requested"),
  });
  const result = watchResult(io.wrapEncode(() => {
    events.push("native encode starts");
    return videoBlob();
  })());
  await flush();
  io.wrapStop(() => {})();
  gate.resolve();
  await io.enqueue("barrier", () => {});
  await flush();
  assert.deepEqual(events, []);
  assert.equal(result.state, "pending");
  assert.equal(io.state().running, null);
});

test("quota errors still reject an uncancelled encode and release its slot", { timeout: 2000 }, async () => {
  const failure = new Error("Quota denied");
  const io = createIoSerializer({ ensureQuota: () => Promise.reject(failure) });
  let calls = 0;
  const encode = io.wrapEncode(() => { calls += 1; return videoBlob(); });
  await assert.rejects(encode(), (error) => error === failure);
  await io.enqueue("barrier", () => {});
  assert.equal(calls, 0);
  assert.equal(io.state().running, null);
});

test("normal queued exports preserve receiver, arguments, quota, and output bytes", { timeout: 2000 }, async () => {
  const quotaRequests = [];
  const io = createIoSerializer({ ensureQuota: (bytes) => quotaRequests.push(bytes) });
  const receiver = {};
  const params = { width: 640, height: 360, rate: 30, length: 30 };
  const calls = [];
  const encode = io.wrapEncode(function (frames, options) {
    assert.equal(this, receiver);
    assert.equal(options, params);
    calls.push(frames);
    return videoBlob();
  });
  const outputs = await Promise.all([encode.call(receiver, "first", params), encode.call(receiver, "second", params)]);
  assert.deepEqual(calls, ["first", "second"]);
  assert.equal(quotaRequests.length, 2);
  for (const output of outputs) {
    assert.deepEqual(await output.arrayBuffer(), await videoBlob().arrayBuffer());
  }
  assert.equal(io.state().completed, 2);
});

test("native completion stop preserves its result and the next queued encode", { timeout: 2000 }, async () => {
  const io = createIoSerializer();
  const events = [];
  const stop = io.wrapStop(() => events.push("native stop"));
  const encode = io.wrapEncode(() => new Promise((resolve) => {
    setImmediate(() => {
      stop();
      resolve(videoBlob());
    });
  }));
  const outputs = await Promise.all([encode(), encode()]);
  await flush();
  assert.deepEqual(events, ["native stop", "native stop"]);
  for (const output of outputs) {
    assert.deepEqual(await output.arrayBuffer(), await videoBlob().arrayBuffer());
  }
  assert.equal(io.state().completed, 2);
});

test("Cancel of a running native encoder also cancels queued requests and releases cleanup", { timeout: 2000 }, async () => {
  const io = createIoSerializer({ deleteOutFile: () => {} });
  let calls = 0;
  const encode = io.wrapEncode(() => {
    calls += 1;
    return new Promise(() => {});
  });
  const results = [watchResult(encode())];
  await flush();
  results.push(watchResult(encode()));
  io.wrapStop(() => {})();
  await io.wrapCleanUp(() => {})();
  await flush();
  assert.equal(calls, 1);
  assert.deepEqual(results.map((result) => result.state), ["pending", "pending"]);
  assert.equal(io.state().running, null);
});
