"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { pipeline } = require("node:stream/promises");
const test = require("node:test");
const vm = require("node:vm");
const { isAllowedHost: devIsAllowedHost, requestPathname: devRequestPathname } = require("../tools/serve-with-resources");

const source = fs.readFileSync(path.join(__dirname, "../desktop/main.cjs"), "utf8");
const sliceStart = source.indexOf("function requestedPath(");
const sliceEnd = source.indexOf("async function startServer(", sliceStart);
const desktopFunctions = source.slice(sliceStart, sliceEnd);

function loadDesktopServer(extraGlobals = {}) {
  const sandbox = {
    applicationRoot: extraGlobals.applicationRoot,
    fs,
    path,
    URL,
    pipeline,
    MIME_TYPES: new Map(),
    desktopPort: 0,
    setTimeout,
    clearTimeout,
  };
  const exported = vm.runInNewContext(
    `${desktopFunctions}\n({ serveRequest, isAllowedHost, requestedPath })`,
    sandbox,
  );
  return { exported, sandbox };
}

function listenForTest(server) {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));
}

function httpRequest(port, { headers = {}, method = "GET", path: requestPath = "/fixture.mp4" } = {}) {
  return new Promise((resolve, reject) => {
    http.request({ host: "127.0.0.1", port, path: requestPath, headers, method }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve({
        status: response.statusCode,
        headers: response.headers,
        body: Buffer.concat(chunks).toString(),
      }));
    }).on("error", reject).end();
  });
}

function rawRequest(port, raw) {
  return new Promise((resolve, reject) => {
    let data = "";
    const socket = net.connect(port, "127.0.0.1", () => socket.write(raw));
    socket.on("data", (chunk) => { data += chunk.toString("latin1"); });
    socket.on("end", () => resolve(data));
    socket.on("error", reject);
  });
}

function rawStatus(rawResponse) {
  return Number(rawResponse.split("\r\n", 1)[0].split(" ")[1]);
}

function securityHeaders(headers) {
  return {
    nosniff: headers["x-content-type-options"],
    csp: headers["content-security-policy"],
  };
}

function assertDesktopSecurityHeaders(headers) {
  assert.equal(headers["x-content-type-options"], "nosniff");
  assert.equal(headers["content-security-policy"], "frame-ancestors 'self'; object-src 'none'");
}

test("desktop server supports media seek ranges, validators and HEAD", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "zoidium-http-"));
  fs.writeFileSync(path.join(root, "fixture.mp4"), "0123456789");
  const { exported, sandbox } = loadDesktopServer({ applicationRoot: root });
  const server = http.createServer((request, response) => {
    exported.serveRequest(request, response).catch((error) => {
      if (!response.headersSent) {
        const status = error && error.code === "ENOENT" ? 404 : 500;
        response.writeHead(status, {
          "x-content-type-options": "nosniff",
          "content-security-policy": "frame-ancestors 'self'; object-src 'none'",
          "content-type": "text/plain; charset=utf-8",
        });
      }
      response.end(error && error.code === "ENOENT" ? "Not Found" : "Internal Server Error");
    });
  });
  const port = await listenForTest(server);
  sandbox.desktopPort = port;
  const host = `127.0.0.1:${port}`;
  function request(headers = {}, method = "GET") {
    return httpRequest(port, { headers: { host, ...headers }, method });
  }
  try {
    const full = await request();
    assert.equal(full.body, "0123456789");
    assertDesktopSecurityHeaders(full.headers);
    const partial = await request({ range: "bytes=2-4" });
    assert.equal(partial.status, 206);
    assert.equal(partial.body, "234");
    assert.equal(partial.headers["content-range"], "bytes 2-4/10");
    assertDesktopSecurityHeaders(partial.headers);
    assert.equal((await request({ range: "bytes=-3" })).body, "789");
    assert.equal((await request({ range: "bytes=7-" })).body, "789");
    for (const range of ["bytes=-0", "bytes=10-", "bytes=5-2"]) {
      const invalid = await request({ range });
      assert.equal(invalid.status, 416);
      assert.equal(invalid.headers["content-range"], "bytes */10");
    }
    assert.equal((await request({ range: "bytes=2-4", "if-range": '"outdated"' })).status, 200);
    assert.equal((await request({ range: "bytes=2-4", "if-range": full.headers.etag })).status, 206);
    const cached = await request({ "if-none-match": full.headers.etag });
    assert.equal(cached.status, 304);
    assertDesktopSecurityHeaders(cached.headers);
    const head = await request({ range: "bytes=2-4" }, "HEAD");
    assert.equal(head.status, 200);
    assert.equal(head.headers["content-length"], "10");
    assert.equal(head.body, "");
    assertDesktopSecurityHeaders(head.headers);
    const missing = await httpRequest(port, { headers: { host }, path: "/no-such-file.txt" });
    assert.equal(missing.status, 404);
    assertDesktopSecurityHeaders(missing.headers);
    const traversal = await httpRequest(port, { headers: { host }, path: "/..%2f..%2fsecret.txt" });
    assert.equal(traversal.status, 400);
    assertDesktopSecurityHeaders(traversal.headers);
    const wrongMethod = await httpRequest(port, { headers: { host }, method: "POST" });
    assert.equal(wrongMethod.status, 405);
    assertDesktopSecurityHeaders(wrongMethod.headers);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("desktop server rejects hosts that fail loopback validation", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "zoidium-http-host-"));
  fs.writeFileSync(path.join(root, "fixture.mp4"), "0123456789");
  const { exported, sandbox } = loadDesktopServer({ applicationRoot: root });
  const server = http.createServer((request, response) => {
    exported.serveRequest(request, response).catch((error) => { response.destroy(error); });
  });
  const port = await listenForTest(server);
  sandbox.desktopPort = port;
  try {
    const good = `127.0.0.1:${port}`;
    assert.equal((await httpRequest(port, { headers: { host: good } })).status, 200);
    assert.equal((await httpRequest(port, { headers: { host: `localhost:${port}` } })).status, 200);
    assert.equal((await httpRequest(port, { headers: { host: `[::1]:${port}` } })).status, 200);
    assert.equal((await httpRequest(port, { headers: { host: "127.0.0.1" } })).status, 200);

    const forbidden = [
      "attacker.example",
      `attacker.example:${port}`,
      "example.com",
      `127.0.0.1:${port + 1}`,
      "127.0.0.1:notaport",
      "[::1",
      "127.0.0.1:80:80",
    ];
    for (const host of forbidden) {
      const denied = await httpRequest(port, { headers: { host } });
      assert.equal(denied.status, 403, `host ${JSON.stringify(host)} is rejected`);
      assertDesktopSecurityHeaders(denied.headers);
    }

    const noHost = await rawRequest(port, "GET /fixture.mp4 HTTP/1.0\r\nConnection: close\r\n\r\n");
    assert.equal(rawStatus(noHost), 403);

    const emptyHost = await rawRequest(
      port,
      "GET /fixture.mp4 HTTP/1.1\r\nHost:\r\nConnection: close\r\n\r\n",
    );
    assert.equal(rawStatus(emptyHost), 403);

    const absoluteForm = await rawRequest(
      port,
      `GET http://127.0.0.1:${port}/fixture.mp4 HTTP/1.1\r\nHost: ${good}\r\nConnection: close\r\n\r\n`,
    );
    assert.equal(rawStatus(absoluteForm), 400);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("desktop host validation and request paths match the development server", () => {
  const { exported } = loadDesktopServer({ applicationRoot: os.tmpdir() });
  const port = 17823;
  const hosts = [
    `127.0.0.1:${port}`,
    "127.0.0.1",
    `localhost:${port}`,
    `LOCALHOST:${port}`,
    `[::1]:${port}`,
    "[::1]",
    "localhost",
    `attacker.example:${port}`,
    "attacker.example",
    "example.com",
    `127.0.0.1:${port + 1}`,
    "127.0.0.1:notaport",
    "127.0.0.1:",
    "[::1",
    "127.0.0.1:80:80",
    "has space:80",
    "a/b",
    "a@b",
    "",
    "   ",
    null,
    undefined,
    127,
  ];
  for (const host of hosts) {
    assert.equal(
      exported.isAllowedHost(host, port),
      devIsAllowedHost(host, port),
      `host ${JSON.stringify(host)} matches the development server`,
    );
  }
  const targets = [
    "/",
    "/index.html",
    "/plugins/core/bundle.json?v=3",
    "/a/../b",
    "/..%2fsecret",
    "/a%2Fb",
    "/%00null",
    "/back\\slash",
    `http://127.0.0.1:${port}/index.html`,
    "http://example.com/index.html",
    "/undecodable/%E0%A4%A",
  ];
  for (const target of targets) {
    assert.equal(
      exported.requestedPath(target),
      devRequestPathname(target),
      `request target ${JSON.stringify(target)} matches the development server`,
    );
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
