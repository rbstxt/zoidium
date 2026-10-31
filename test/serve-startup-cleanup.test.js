"use strict";

const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

async function harness(t, failurePoint) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "zoidium-startup-test-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const stage = path.join(root, "stage"), cache = path.join(root, ".zoidium-resources");
  await fs.mkdir(stage);
  await fs.mkdir(cache);
  const calls = [], failure = new Error(`startup ${failurePoint} failure`);
  const processFake = new EventEmitter();
  processFake.argv = ["node", "serve.js", "--port=45678"];
  let resolveExit;
  const exited = new Promise(resolve => { resolveExit = resolve; });
  processFake.exit = () => resolveExit();
  let serversCreated = 0;
  const servers = [];
  const requireFake = name => {
    if (name === "./runtime-resources") return { projectRoot: root, prepareRuntimeStage: async () => ({
      root: stage, async cleanup() { calls.push("cleanup"); await fs.rm(stage, { recursive: true }); },
    }) };
    if (name === "./build-docs") return { async buildDocs(destination) {
      assert.equal(destination, stage);
      calls.push("docs");
      if (failurePoint === "docs") throw failure;
      if (failurePoint === "docs-always-fail") throw new Error("docs build failed permanently");
      if (failurePoint === "docs-emfile-flaky" && calls.filter((call) => call === "docs").length < 3) {
        throw Object.assign(new Error("too many open files"), { code: "EMFILE" });
      }
    } };
    if (name === "compression") return () => {
      calls.push("middleware");
      if (failurePoint === "middleware") throw failure;
      return () => {};
    };
    if (name === "serve-handler" || name === "./directory-index") return {};
    // Exercise the real live-reload helpers: startup builds the bundles and
    // opens the watcher, shutdown must close it again.
    if (name === "./dev-live") return require("../tools/dev-live");
    if (name === "http") return { createServer() {
      serversCreated++;
      if (failurePoint === "server" && serversCreated === 2) throw failure;
      const server = new EventEmitter();
      server.listen = () => {
        calls.push("listen");
        queueMicrotask(() => {
          if (failurePoint === "listen") { server.emit("error", failure); return; }
          server.listening = true;
          server.emit("listening");
          if (servers.every(item => item.listening)) setImmediate(() => processFake.emit("SIGTERM"));
        });
      };
      server.address = () => ({ port: 45678 });
      server.close = callback => {
        calls.push("close");
        server.listening = false;
        server.emit("close");
        callback();
      };
      servers.push(server);
      return server;
    } };
    return require(name);
  };
  requireFake.main = {};
  const moduleFake = { exports: {} };
  const source = await fs.readFile(require.resolve("../tools/serve-with-resources.js"), "utf8");
  const warnings = [];
  vm.runInNewContext(source + "\nmodule.exports.main = main;", {
    module: moduleFake, require: requireFake, process: processFake, URL,
    console: { log() {}, error() {}, warn(message) { warnings.push(String(message)); } },
  });
  return { main: moduleFake.exports.main, failure, calls, warnings, stage, cache, processFake, exited };
}

for (const point of ["middleware", "server", "listen"]) {
  test(`development startup ${point} failure removes only the disposable stage`, async t => {
    const h = await harness(t, point);
    await assert.rejects(h.main(), error => error === h.failure);
    assert.equal(h.calls.filter(call => call === "cleanup").length, 1);
    await assert.rejects(fs.stat(h.stage), { code: "ENOENT" });
    assert.ok((await fs.stat(h.cache)).isDirectory());
    if (point !== "listen") assert.equal(h.calls.includes("listen"), false);
    assert.equal(h.processFake.exitCode, 1);
  });
}

test("normal development shutdown closes listeners and removes only the stage", async t => {
  const h = await harness(t);
  await h.main();
  await h.exited;
  assert.deepEqual(h.calls, ["docs", "middleware", "listen", "listen", "close", "close", "cleanup"]);
  await assert.rejects(fs.stat(h.stage), { code: "ENOENT" });
  assert.ok((await fs.stat(h.cache)).isDirectory());
  assert.equal(h.processFake.exitCode, 0);
});

test("development startup without docs still listens when the docs build keeps failing", async t => {
  const h = await harness(t, "docs-always-fail");
  await h.main();
  await h.exited;
  assert.deepEqual(h.calls.filter((call) => call === "docs"), ["docs", "docs", "docs"]);
  assert.equal(h.calls.filter((call) => call === "listen").length, 2);
  assert.ok(h.warnings.some((message) => /starting without \/docs/.test(message)),
    `expected a docs-unavailable warning in ${JSON.stringify(h.warnings)}`);
  await assert.rejects(fs.stat(h.stage), { code: "ENOENT" });
  assert.ok((await fs.stat(h.cache)).isDirectory());
  assert.equal(h.processFake.exitCode, 0);
});

test("development startup retries the docs build on EMFILE, then listens", async t => {
  const h = await harness(t, "docs-emfile-flaky");
  await h.main();
  await h.exited;
  assert.equal(h.calls.filter((call) => call === "docs").length, 3);
  assert.ok(h.warnings.some((message) => /retrying/.test(message)),
    `expected a retry warning in ${JSON.stringify(h.warnings)}`);
  assert.equal(h.calls.filter((call) => call === "listen").length, 2);
  assert.equal(h.processFake.exitCode, 0);
});
