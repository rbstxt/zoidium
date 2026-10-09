"use strict";

const assert = require("node:assert/strict");
const http = require("node:http");
const test = require("node:test");
const {
  listenOnAvailablePort,
  requestPathname,
  shouldServeFromProject,
} = require("../tools/serve-with-resources");

test("development server recognizes live Zoidium runtime files", () => {
  assert.equal(requestPathname("/zoidium/runtime-loader.js?v=1"), "zoidium/runtime-loader.js");
  assert.equal(shouldServeFromProject("/zoidium/runtime-loader.js?v=1"), true);
  assert.equal(shouldServeFromProject("/plugins/core/temporal-render.js"), true);
  assert.equal(shouldServeFromProject("/plugins/player-plus/bundle.json?v=3"), true);
});

test("development server does not expose unrelated repository files", () => {
  assert.equal(shouldServeFromProject("/plugins/player-plus/player-plus.js"), false);
  assert.equal(shouldServeFromProject("/package.json"), false);
  assert.equal(shouldServeFromProject("/plugins/../package.json"), false);
});

function listenForTest(server, port = 0) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(server.address().port));
  });
}

function closeForTest(server) {
  return new Promise((resolve) => {
    if (!server.listening) {
      resolve();
      return;
    }
    server.close(() => resolve());
  });
}

test("development server falls forward when the preferred port is busy", async (t) => {
  const blocker = http.createServer(() => {});
  const busyPort = await listenForTest(blocker);
  if (busyPort >= 65535) {
    await closeForTest(blocker);
    t.skip("the port the blocker received has no successor");
    return;
  }

  const listeners = [
    { host: "127.0.0.1", server: http.createServer(() => {}) },
    { host: "::1", server: http.createServer(() => {}) },
  ];
  try {
    const port = await listenOnAvailablePort(listeners, busyPort);
    assert.ok(port > busyPort, `expected a port above ${busyPort}, got ${port}`);
  } finally {
    await Promise.all([
      ...listeners.map(({ server }) => closeForTest(server)),
      closeForTest(blocker),
    ]);
  }
});

test("development server reports a non-port error instead of moving on", async () => {
  const listeners = [{ host: "127.0.0.1", server: http.createServer(() => {}) }];
  await assert.rejects(
    listenOnAvailablePort(listeners, 70000),
    (error) => error.code === "ERR_SOCKET_BAD_PORT",
  );
});

test("port zero binds both loopback addresses to the same assigned port", async () => {
  const listeners = ["127.0.0.1", "::1"].map((host) => ({ host, server: http.createServer() }));
  try {
    const port = await listenOnAvailablePort(listeners, 0);
    assert.ok(port > 0);
    for (const { server } of listeners) {
      if (server.listening) assert.equal(server.address().port, port);
    }
  } finally {
    await Promise.all(listeners.map(({ server }) => closeForTest(server)));
  }
});

test("unsupported IPv6 does not discard an established IPv4 listener", async () => {
  const { EventEmitter } = require("node:events");
  const unavailable = new EventEmitter();
  unavailable.listen = function () { queueMicrotask(() => this.emit("error", Object.assign(new Error("IPv6 unavailable"), { code: "EAFNOSUPPORT" }))); };
  const ipv4 = http.createServer();
  try {
    const port = await listenOnAvailablePort([{ host: "127.0.0.1", server: ipv4 }, { host: "::1", server: unavailable }], 0);
    assert.equal(ipv4.address().port, port);
  } finally { await closeForTest(ipv4); }
});

test("a collision on the second ephemeral bind retries the complete pair", async () => {
  const { EventEmitter } = require("node:events");
  const second = new EventEmitter();
  let calls = 0;
  let actualPort;
  second.listen = function (port) {
    calls += 1;
    actualPort = port;
    queueMicrotask(() => {
      if (calls === 1) this.emit("error", Object.assign(new Error("busy"), { code: "EADDRINUSE" }));
      else { this.listening = true; this.emit("listening"); }
    });
  };
  second.address = () => ({ port: actualPort });
  second.close = (callback) => { second.listening = false; callback(); };
  const ipv4 = http.createServer();
  try {
    const port = await listenOnAvailablePort([{ host: "127.0.0.1", server: ipv4 }, { host: "::1", server: second }], 0);
    assert.equal(calls, 2);
    assert.equal(port, ipv4.address().port);
    assert.equal(port, actualPort);
  } finally { await Promise.all([closeForTest(ipv4), closeForTest(second)]); }
});
