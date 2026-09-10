"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createIoSerializer, install } = require("../plugins/core/io-serialization");

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function flush(rounds = 10) {
  let chain = Promise.resolve();
  for (let i = 0; i < rounds; i += 1) {
    chain = chain.then(() => new Promise((resolve) => setImmediate(resolve)));
  }
  return chain;
}

test("a save waits while a render holds the shared workspace", async () => {
  const waits = [];
  const io = createIoSerializer({
    notifyWaiter: (kind, snapshot) => waits.push({ kind, snapshot }),
  });
  const order = [];
  const renderGate = deferred();
  const encode = io.wrapEncode(() => {
    order.push("encode-start");
    return renderGate.promise.then(() => order.push("encode-end"));
  });
  const tar = io.wrapTar(() => {
    order.push("tar-run");
    return "tar-blob";
  });

  const encodeResult = encode();
  await flush();
  const tarResult = tar();
  await flush();
  assert.deepEqual(order, ["encode-start"]);
  assert.equal(waits.length, 1);
  assert.equal(waits[0].kind, "tar");
  assert.equal(waits[0].snapshot.running, "encode");

  renderGate.resolve();
  assert.equal(await tarResult, "tar-blob");
  await encodeResult;
  assert.deepEqual(order, ["encode-start", "encode-end", "tar-run"]);
});

test("stopping a cancelled render releases the next operation", async () => {
  const io = createIoSerializer({});
  const order = [];
  const encode = io.wrapEncode(() => {
    order.push("encode-start");
    return new Promise(() => {});
  });
  const stop = io.wrapStop(() => {
    order.push("stop-run");
  });
  const tar = io.wrapTar(() => {
    order.push("tar-run");
    return "saved";
  });

  encode().catch(() => {});
  await flush();
  const tarResult = tar();
  await flush();
  assert.deepEqual(order, ["encode-start"]);

  stop();
  assert.equal(await tarResult, "saved");
  assert.deepEqual(order, ["encode-start", "stop-run", "tar-run"]);
  assert.equal(io.state().running, null);
});

test("stop never releases a save or cleanup holder", async () => {
  const order = [];
  const io = createIoSerializer({
    deleteOutFile: () => {
      order.push("cleanup-run");
      return Promise.resolve();
    },
  });
  const tarGate = deferred();
  const tar = io.wrapTar(() => {
    order.push("tar-run");
    return tarGate.promise;
  });
  const stop = io.wrapStop(() => {});
  const cleanup = io.wrapCleanUp(() => {});

  tar();
  await flush();
  const cleanupResult = cleanup();
  await flush();
  stop();
  await flush();
  assert.deepEqual(order, ["tar-run"]);

  tarGate.resolve();
  await cleanupResult;
  assert.deepEqual(order, ["tar-run", "cleanup-run"]);
});

test("cleanup waits for the render before deleting the workspace", async () => {
  const order = [];
  const io = createIoSerializer({
    deleteOutFile: () => {
      order.push("delete-out");
      return Promise.resolve();
    },
  });
  const renderGate = deferred();
  const encode = io.wrapEncode(() => {
    order.push("encode-start");
    return renderGate.promise;
  });
  const cleanUp = io.wrapCleanUp(() => {});

  encode().catch(() => {});
  await flush();
  const cleanupResult = cleanUp();
  await flush();
  assert.deepEqual(order, ["encode-start"]);

  renderGate.resolve();
  await cleanupResult;
  assert.deepEqual(order, ["encode-start", "delete-out"]);
});

test("a failed operation still hands the workspace to the next one", async () => {
  const io = createIoSerializer({});
  const tar = io.wrapTar(() => Promise.reject(new Error("tar failed")));
  const second = io.wrapTar(() => "recovered");

  await assert.rejects(tar(), /tar failed/);
  assert.equal(await second(), "recovered");
});

test("install wraps the render and save entry points exactly once", () => {
  const calls = [];
  const PZ = {};
  const av = {
    encode() {
      calls.push(["encode", this === av]);
      return Promise.resolve("video");
    },
    stop() {
      calls.push(["stop", this === av]);
    },
  };
  const archive = {
    tar() {
      calls.push(["tar", this === archive]);
      return Promise.resolve("project");
    },
  };
  const file = {
    cleanUp() {
      calls.push("stock-cleanup-must-not-run");
    },
  };

  assert.equal(install({ PZ, av, archive, file }), true);
  assert.equal(install({ PZ, av, archive, file }), true);
  assert.ok(PZ.zoidiumIoSerialization);
  assert.equal(typeof PZ.zoidiumIoSerialization.state, "function");

  return (async () => {
    assert.equal(await av.encode(), "video");
    av.stop();
    assert.equal(await archive.tar(), "project");
    await file.cleanUp();
    assert.deepEqual(calls, [
      ["encode", true],
      ["stop", true],
      ["tar", true],
    ]);
  })();
});

test("install refuses incomplete targets", () => {
  assert.equal(install(null), false);
  assert.equal(install({}), false);
  assert.equal(
    install({ av: {}, archive: {}, file: {}, PZ: {} }),
    false,
  );
});
