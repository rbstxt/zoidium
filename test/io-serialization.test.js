"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  MINIMUM_WORKSPACE_BYTES,
  createIoSerializer,
  createWebLockRunner,
  estimateArchiveStorageBytes,
  estimateVideoStorageBytes,
  install,
  requestPersistentQuota,
} = require("../plugins/core/io-serialization");

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

function videoBlob() {
  return new Blob([new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3])]);
}

function archiveBlob() {
  return new Blob([new Uint8Array([0x1f, 0x8b, 8, 0, 1, 2, 3])]);
}

// Mimics the File handle the CM3 workers post back for the origin-private file
// named "out": it stays valid until a later render, save, or cleanup rewrites
// the file, and then every read fails.
function fileBackedExport(bytes) {
  const data = new Uint8Array(bytes);
  const state = { source: new Blob([data]) };
  const blob = {
    name: "out",
    // A File handle keeps the length it reported when it was created.
    size: data.length,
    slice(start, end) {
      return state.source.slice(start, end);
    },
    stream() {
      if (!state.source) throw new Error("NotReadableError");
      return state.source.stream();
    },
    arrayBuffer() {
      if (!state.source) throw new Error("NotReadableError");
      return state.source.arrayBuffer();
    },
  };
  return {
    blob,
    invalidate() {
      state.source = null;
    },
  };
}

class SharedLockManager {
  constructor() {
    this.tails = new Map();
  }

  request(name, _options, callback) {
    const previous = this.tails.get(name) || Promise.resolve();
    const result = previous.then(callback, callback);
    this.tails.set(name, result.catch(() => {}));
    return result;
  }
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
    return renderGate.promise.then(() => {
      order.push("encode-end");
      return videoBlob();
    });
  });
  const tar = io.wrapTar(() => {
    order.push("tar-run");
    return archiveBlob();
  });

  const encodeResult = encode();
  await flush();
  const tarResult = tar();
  await flush();
  assert.deepEqual(order, ["encode-start"]);
  assert.equal(waits.length, 1);
  assert.equal(waits[0].kind, "archive");
  assert.equal(waits[0].snapshot.running, "encode");

  renderGate.resolve();
  assert.equal((await tarResult).size, archiveBlob().size);
  assert.equal((await encodeResult).size, videoBlob().size);
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
    return archiveBlob();
  });

  encode().catch(() => {});
  await flush();
  const tarResult = tar();
  await flush();
  assert.deepEqual(order, ["encode-start"]);

  stop();
  assert.equal((await tarResult).size, archiveBlob().size);
  assert.deepEqual(order, ["encode-start", "stop-run", "tar-run"]);
  assert.equal(io.state().running, null);
});

test("an internal completion stop does not cancel the encode result", async () => {
  const io = createIoSerializer({});
  let stop;
  const encode = io.wrapEncode(
    () =>
      new Promise((resolve) => {
        setImmediate(() => {
          stop();
          resolve(videoBlob());
        });
      }),
  );
  stop = io.wrapStop(() => {});

  assert.equal((await encode()).size, videoBlob().size);
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
    return tarGate.promise.then(archiveBlob);
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
    return renderGate.promise.then(videoBlob);
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

test("image export shares the page-local render queue", async () => {
  const io = createIoSerializer({});
  const gate = deferred();
  const order = [];
  const encode = io.wrapEncode(() => {
    order.push("video-start");
    return gate.promise.then(videoBlob);
  });
  const image = io.wrapImageEncode(() => {
    order.push("image-run");
    return new Blob(["image"]);
  });

  const videoResult = encode();
  await flush();
  const imageResult = image();
  await flush();
  assert.deepEqual(order, ["video-start"]);
  gate.resolve();
  await videoResult;
  await imageResult;
  assert.deepEqual(order, ["video-start", "image-run"]);
});

test("two serializers use one Web Lock across tabs", async () => {
  const lockManager = new SharedLockManager();
  const runExclusive = createWebLockRunner(lockManager);
  const first = createIoSerializer({ runExclusive });
  const second = createIoSerializer({ runExclusive });
  const gate = deferred();
  const order = [];
  const encode = first.wrapEncode(() => {
    order.push("tab-a-render");
    return gate.promise.then(videoBlob);
  });
  const tar = second.wrapTar(() => {
    order.push("tab-b-save");
    return archiveBlob();
  });

  const firstResult = encode();
  await flush();
  const secondResult = tar();
  await flush();
  assert.deepEqual(order, ["tab-a-render"]);
  gate.resolve();
  await firstResult;
  await secondResult;
  assert.deepEqual(order, ["tab-a-render", "tab-b-save"]);
});

test("cancelling a render releases its Web Lock for another tab", async () => {
  const lockManager = new SharedLockManager();
  const runExclusive = createWebLockRunner(lockManager);
  const first = createIoSerializer({ runExclusive });
  const second = createIoSerializer({ runExclusive });
  const order = [];
  const encode = first.wrapEncode(() => {
    order.push("tab-a-render");
    return new Promise(() => {});
  });
  const stop = first.wrapStop(() => order.push("tab-a-stop"));
  const tar = second.wrapTar(() => {
    order.push("tab-b-save");
    return archiveBlob();
  });

  encode().catch(() => {});
  await flush();
  const save = tar();
  await flush();
  assert.deepEqual(order, ["tab-a-render"]);
  stop();
  await save;
  assert.deepEqual(order, ["tab-a-render", "tab-a-stop", "tab-b-save"]);
});

test("a failed operation still hands the workspace to the next one", async () => {
  const io = createIoSerializer({});
  const tar = io.wrapTar(() => Promise.reject(new Error("tar failed")));
  const second = io.wrapTar(archiveBlob);

  await assert.rejects(tar(), /tar failed/);
  assert.equal((await second()).size, archiveBlob().size);
});

test("integrity checks reject output from the wrong worker", async () => {
  const io = createIoSerializer({});
  const badVideo = io.wrapEncode(archiveBlob);
  const badArchive = io.wrapTar(videoBlob);

  await assert.rejects(badVideo(), /Video output failed its file-integrity check/);
  await assert.rejects(
    badArchive(),
    /Project archive output failed its file-integrity check/,
  );
});

test("a render is copied out of the shared workspace file before it is returned", async () => {
  const io = createIoSerializer({});
  const entry = fileBackedExport([0x1a, 0x45, 0xdf, 0xa3, 9, 9, 9]);
  const encode = io.wrapEncode(() => entry.blob);

  const result = await encode();
  // The next render, save, or cleanup rewrites the shared file named "out".
  entry.invalidate();

  assert.notEqual(result, entry.blob);
  assert.deepEqual(
    new Uint8Array(await result.arrayBuffer()),
    new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 9, 9, 9]),
  );
});

test("a project archive is copied out of the shared workspace file", async () => {
  const io = createIoSerializer({});
  const entry = fileBackedExport([0x1f, 0x8b, 8, 0, 1, 2, 3]);
  const tar = io.wrapTar(() => entry.blob);

  const result = await tar();
  entry.invalidate();

  assert.notEqual(result, entry.blob);
  assert.equal(result.size, 7);
});

test("an in-memory export is returned without another copy", async () => {
  const io = createIoSerializer({});
  const blob = videoBlob();
  const encode = io.wrapEncode(() => blob);

  assert.equal(await encode(), blob);
});

test("a render that cannot be read back fails instead of returning a stale file", async () => {
  const io = createIoSerializer({});
  const entry = fileBackedExport([0x1a, 0x45, 0xdf, 0xa3, 1]);
  const encode = io.wrapEncode(() => {
    entry.invalidate();
    return entry.blob;
  });

  await assert.rejects(encode(), /could not be read back from the browser's temporary file/);
});

test("storage estimates scale beyond the old fixed 100 MB quota", () => {
  assert.equal(estimateArchiveStorageBytes([]), MINIMUM_WORKSPACE_BYTES);
  assert.ok(
    estimateArchiveStorageBytes([{ data: { size: 200 * 1024 * 1024 } }]) >
      200 * 1024 * 1024,
  );
  assert.ok(
    estimateVideoStorageBytes({
      width: 3840,
      height: 2160,
      rate: 60,
      length: 60 * 60 * 10,
      quality: 4,
    }) > MINIMUM_WORKSPACE_BYTES,
  );
});

test("quota denial rejects instead of continuing with a truncated output", async () => {
  const fakeWindow = {
    navigator: {
      webkitPersistentStorage: {
        requestQuota(_bytes, success) {
          success(1024);
        },
      },
    },
  };
  await assert.rejects(
    requestPersistentQuota(fakeWindow, MINIMUM_WORKSPACE_BYTES),
    /did not grant enough temporary storage/,
  );
});

test("remux calls cannot overwrite the shared callback slot", async () => {
  const io = createIoSerializer({});
  const firstGate = deferred();
  const order = [];
  const remux = io.wrapRemux((name) => {
    order.push(name + "-start");
    if (name === "first") {
      return firstGate.promise.then(() => order.push(name + "-end"));
    }
    order.push(name + "-end");
  });

  const first = remux("first");
  const second = remux("second");
  await flush();
  assert.deepEqual(order, ["first-start"]);
  firstGate.resolve();
  await Promise.all([first, second]);
  assert.deepEqual(order, [
    "first-start",
    "first-end",
    "second-start",
    "second-end",
  ]);
});

test("stopping an encode clears a remux callback left by that worker", async () => {
  const io = createIoSerializer({});
  const calls = [];
  const remux = io.wrapRemux((name) => {
    calls.push(name);
    return name === "old-worker" ? new Promise(() => {}) : Promise.resolve(name);
  });
  const stop = io.wrapStop(() => {});

  remux("old-worker").catch(() => {});
  await flush();
  stop();
  assert.equal(await remux("new-worker"), "new-worker");
  assert.deepEqual(calls, ["old-worker", "new-worker"]);
});

test("install wraps every export entry point exactly once", async () => {
  const calls = [];
  const PZ = {};
  const av = {
    profiles: [{ bitrate: 1, abr: 1 }],
    encode() {
      calls.push(["encode", this === av]);
      return Promise.resolve(videoBlob());
    },
    remux() {
      calls.push(["remux", this === av]);
      return Promise.resolve("audio");
    },
    stop() {
      calls.push(["stop", this === av]);
    },
  };
  const archive = {
    files: [],
    tar() {
      calls.push(["tar", this === archive]);
      return Promise.resolve(archiveBlob());
    },
  };
  const file = {
    cleanUp() {
      calls.push("stock-cleanup-must-not-run");
    },
    getQuota() {
      calls.push("quota");
    },
  };
  const imageEncoder = {
    encode() {
      calls.push(["image", this === imageEncoder]);
      return Promise.resolve(new Blob(["image"]));
    },
  };

  assert.equal(install({ PZ, av, archive, file, imageEncoder }), true);
  assert.equal(install({ PZ, av, archive, file, imageEncoder }), true);
  assert.ok(PZ.zoidiumIoSerialization);
  assert.equal(typeof PZ.zoidiumIoSerialization.state, "function");
  assert.equal(typeof PZ.zoidiumIoSerialization.run, "function");

  assert.equal((await av.encode()).size, videoBlob().size);
  av.stop();
  assert.equal((await archive.tar()).size, archiveBlob().size);
  await imageEncoder.encode();
  await file.cleanUp();
  assert.deepEqual(calls, [
    "quota",
    ["encode", true],
    ["stop", true],
    "quota",
    ["tar", true],
    ["image", true],
  ]);
});

test("install refuses incomplete targets", () => {
  assert.equal(install(null), false);
  assert.equal(install({}), false);
  assert.equal(
    install({ av: {}, archive: {}, file: {}, imageEncoder: {}, PZ: {} }),
    false,
  );
});
