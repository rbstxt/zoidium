"use strict";

// The development server crashed after long sessions with EMFILE: serve-handler
// opens a read stream before answering 304 and never closes it. These tests
// drive the real serve-handler and count the process's open file handles.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { PassThrough } = require("node:stream");
const test = require("node:test");
const handler = require("serve-handler");
const { createRequestStreams } = require("../tools/dev-live");

const fdDir = fs.existsSync("/proc/self/fd") ? "/proc/self/fd" : "/dev/fd";
const openHandles = () => fs.readdirSync(fdDir).length;

async function withServer(useStreams, run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "zoidium-stream-leak-"));
  fs.writeFileSync(path.join(root, "icons.svg"), "<svg xmlns='http://www.w3.org/2000/svg'/>".repeat(64));
  const server = http.createServer((request, response) => {
    const methods = useStreams ? { createReadStream: createRequestStreams(response) } : {};
    handler(request, response, { public: root, etag: true }, methods).catch((error) => {
      response.destroy(error);
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
  const get = (headers = {}) =>
    new Promise((resolve, reject) => {
      const request = http.get({ host: "127.0.0.1", port: server.address().port, path: "/icons.svg", headers, agent }, (response) => {
        response.resume();
        response.on("end", () => resolve(response));
      });
      request.on("error", reject);
    });
  try {
    return await run(get);
  } finally {
    agent.destroy();
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  }
}

async function settle() {
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setTimeout(resolve, 20));
}

async function leakedAfterRevalidations(useStreams, count) {
  return withServer(useStreams, async (get) => {
    const first = await get();
    const etag = first.headers.etag;
    assert.ok(etag, "serve-handler sends an ETag");
    await settle();
    const before = openHandles();
    for (let i = 0; i < count; i += 1) {
      const response = await get({ "If-None-Match": etag });
      assert.equal(response.statusCode, 304);
    }
    await settle();
    return openHandles() - before;
  });
}

test("serve-handler alone leaks one file handle per 304 (the bug this guards)", async () => {
  const leaked = await leakedAfterRevalidations(false, 40);
  assert.ok(leaked >= 30, `expected the unpatched handler to leak, leaked ${leaked}`);
});

test("request streams close every handle a 304 opened", async () => {
  const leaked = await leakedAfterRevalidations(true, 40);
  assert.ok(leaked <= 2, `leaked ${leaked} handles`);
});

test("200 responses still deliver the file through request streams", async () => {
  await withServer(true, async (get) => {
    const response = await get();
    assert.equal(response.statusCode, 200);
  });
});

test("a stream left open by a disconnected client is closed with the response", async () => {
  const response = new PassThrough();
  const createReadStream = createRequestStreams(response);
  const file = path.join(os.tmpdir(), `zoidium-stream-leak-${process.pid}.bin`);
  fs.writeFileSync(file, Buffer.alloc(1 << 20));
  try {
    const stream = createReadStream(file, { highWaterMark: 1024 });
    await new Promise((resolve) => stream.once("open", resolve));
    response.emit("close");
    await new Promise((resolve) => stream.once("close", resolve));
    assert.equal(stream.destroyed, true);
  } finally {
    fs.rmSync(file, { force: true });
  }
});

test("an open failure on a piped stream ends the response instead of crashing", async () => {
  const response = new PassThrough();
  const createReadStream = createRequestStreams(response);
  const stream = createReadStream(path.join(os.tmpdir(), "zoidium-missing", "icons.svg"));
  stream.pipe(response);
  await new Promise((resolve) => response.once("close", resolve));
  assert.equal(response.destroyed, true);
});

test("an unpiped stream's error is swallowed rather than thrown", async () => {
  const response = new PassThrough();
  const createReadStream = createRequestStreams(response);
  const stream = createReadStream(path.join(os.tmpdir(), "zoidium-missing", "icons.svg"));
  await new Promise((resolve) => stream.once("close", resolve));
  assert.equal(response.destroyed, false);
});
