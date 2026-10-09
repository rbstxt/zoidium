"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { pipeline } = require("node:stream/promises");
const test = require("node:test");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "../desktop/main.cjs"), "utf8");
test("desktop server supports media seek ranges, validators and HEAD", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "zoidium-http-"));
  fs.writeFileSync(path.join(root, "fixture.mp4"), "0123456789");
  const functions = source.slice(source.indexOf("function requestedPath("), source.indexOf("async function startServer("));
  const serveRequest = vm.runInNewContext(functions + "\nserveRequest", {
    applicationRoot: root, fs, path, URL, pipeline, MIME_TYPES: new Map(),
  });
  const server = http.createServer((request, response) => {
    serveRequest(request, response).catch((error) => { response.destroy(error); });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  function request(headers = {}, method = "GET") {
    return new Promise((resolve, reject) => {
      http.request({ host: "127.0.0.1", port: server.address().port, path: "/fixture.mp4", headers, method }, (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks).toString() }));
      }).on("error", reject).end();
    });
  }
  try {
    const full = await request();
    assert.equal(full.body, "0123456789");
    const partial = await request({ range: "bytes=2-4" });
    assert.equal(partial.status, 206);
    assert.equal(partial.body, "234");
    assert.equal(partial.headers["content-range"], "bytes 2-4/10");
    assert.equal((await request({ range: "bytes=-3" })).body, "789");
    assert.equal((await request({ range: "bytes=7-" })).body, "789");
    for (const range of ["bytes=-0", "bytes=10-", "bytes=5-2"]) {
      const invalid = await request({ range });
      assert.equal(invalid.status, 416);
      assert.equal(invalid.headers["content-range"], "bytes */10");
    }
    assert.equal((await request({ range: "bytes=2-4", "if-range": '"outdated"' })).status, 200);
    assert.equal((await request({ range: "bytes=2-4", "if-range": full.headers.etag })).status, 206);
    assert.equal((await request({ "if-none-match": full.headers.etag })).status, 304);
    const head = await request({ range: "bytes=2-4" }, "HEAD");
    assert.equal(head.status, 200);
    assert.equal(head.headers["content-length"], "10");
    assert.equal(head.body, "");
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  }
});
test("desktop shutdown terminates a connection that does not close", async () => {
  const start = source.indexOf("function closeHttpServer(");
  const end = source.indexOf("function closeServer()", start);
  const close = vm.runInNewContext(source.slice(start, end) + "\ncloseHttpServer", { setTimeout, clearTimeout });
  const calls = [];
  await close({ close() { calls.push("close"); }, closeIdleConnections() { calls.push("idle"); }, closeAllConnections() { calls.push("all"); } }, 10);
  assert.deepEqual(calls, ["close", "idle", "all"]);
});
