"use strict";

// Tests for tools/dev-live.js: the file watching, debouncing, retry, and
// live-rebuild helpers behind the development server's reload behavior.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  buildDocsWithFallback,
  createApprovalsCache,
  createDebouncer,
  createLiveBundles,
  createLiveCommunitySource,
  createLivePresets,
  createRecursiveWatcher,
  createRequestGate,
  isRetryableFsError,
  sendBytes,
  withFsRetry,
} = require("../tools/dev-live");

function makeTempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "zoidium-dev-live-"));
}

function writeFile(root, relativePath, content) {
  const absolute = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, content);
  return absolute;
}

function waitFor(condition, { timeoutMs = 5000, intervalMs = 25 } = {}) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      let done = false;
      try {
        done = condition();
      } catch (error) {
        reject(error);
        return;
      }
      if (done) {
        resolve();
        return;
      }
      if (Date.now() - started > timeoutMs) {
        reject(new Error("Timed out waiting for condition"));
        return;
      }
      setTimeout(check, intervalMs);
    };
    check();
  });
}

test("only EMFILE and ENFILE are retryable file errors", () => {
  assert.equal(isRetryableFsError(Object.assign(new Error("busy"), { code: "EMFILE" })), true);
  assert.equal(isRetryableFsError(Object.assign(new Error("busy"), { code: "ENFILE" })), true);
  assert.equal(isRetryableFsError(Object.assign(new Error("gone"), { code: "ENOENT" })), false);
  assert.equal(isRetryableFsError(new Error("plain")), false);
  assert.equal(isRetryableFsError(null), false);
});

test("withFsRetry retries EMFILE then succeeds", async () => {
  let calls = 0;
  const result = await withFsRetry(async () => {
    calls += 1;
    if (calls < 3) throw Object.assign(new Error("too many open files"), { code: "EMFILE" });
    return "recovered";
  }, { baseDelayMs: 1 });
  assert.equal(result, "recovered");
  assert.equal(calls, 3);
});

test("withFsRetry gives up after bounded attempts and rethrows EMFILE", async () => {
  let calls = 0;
  await assert.rejects(
    withFsRetry(async () => {
      calls += 1;
      throw Object.assign(new Error("too many open files"), { code: "EMFILE" });
    }, { retries: 2, baseDelayMs: 1 }),
    (error) => error.code === "EMFILE"
  );
  assert.equal(calls, 3);
});

test("withFsRetry does not retry other errors", async () => {
  let calls = 0;
  await assert.rejects(
    withFsRetry(async () => {
      calls += 1;
      throw Object.assign(new Error("gone"), { code: "ENOENT" });
    }, { baseDelayMs: 1 }),
    (error) => error.code === "ENOENT"
  );
  assert.equal(calls, 1);
});

test("debouncer coalesces rapid triggers into one call", async () => {
  const seen = [];
  const debouncer = createDebouncer(30, (...args) => {
    seen.push(args);
  });
  debouncer.trigger("a");
  debouncer.trigger("b");
  debouncer.trigger("c");
  assert.equal(debouncer.pending, true);
  await waitFor(() => seen.length === 1);
  assert.deepEqual(seen, [["c"]]);
  assert.equal(debouncer.pending, false);
});

test("debouncer flush runs a pending call immediately", async () => {
  let calls = 0;
  const debouncer = createDebouncer(10_000, () => {
    calls += 1;
  });
  debouncer.trigger();
  await debouncer.flush();
  assert.equal(calls, 1);
  debouncer.cancel();
});

test("recursive watcher sees edits, additions, and removals", async (t) => {
  const root = makeTempRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeFile(root, "sub/file.js", "v1\n");
  const batches = [];
  const watcher = createRecursiveWatcher([root], (changed) => {
    batches.push(changed);
  }, { debounceMs: 30 });
  t.after(() => watcher.close());
  assert.equal(watcher.mode, "recursive");

  writeFile(root, "sub/file.js", "v2\n");
  await waitFor(() => batches.length >= 1);
  writeFile(root, "sub/added.js", "new\n");
  await waitFor(() => batches.length >= 2);
  fs.rmSync(path.join(root, "sub/file.js"));
  await waitFor(() => batches.length >= 3);
  const all = batches.flat().map((file) => path.relative(root, file).split(path.sep).join("/"));
  assert.ok(all.some((file) => file === "sub/file.js"), `expected sub/file.js in ${JSON.stringify(all)}`);
  assert.ok(all.some((file) => file === "sub/added.js"), `expected sub/added.js in ${JSON.stringify(all)}`);
});

test("polling watcher fallback sees edits, additions, and removals", async (t) => {
  const root = makeTempRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeFile(root, "file.js", "v1\n");
  const batches = [];
  const watcher = createRecursiveWatcher([root], (changed) => {
    batches.push(changed);
  }, { debounceMs: 20, forcePoll: true, pollMs: 50 });
  t.after(() => watcher.close());
  assert.equal(watcher.mode, "poll");

  writeFile(root, "file.js", "v2\n");
  await waitFor(() => batches.length >= 1);
  writeFile(root, "added.js", "new\n");
  await waitFor(() => batches.length >= 2);
  fs.rmSync(path.join(root, "file.js"));
  await waitFor(() => batches.length >= 3);
  const all = batches.flat().map((file) => path.relative(root, file).split(path.sep).join("/"));
  assert.ok(all.includes("file.js"), `expected file.js in ${JSON.stringify(all)}`);
  assert.ok(all.includes("added.js"), `expected added.js in ${JSON.stringify(all)}`);
});

test("watcher errors are reported, never thrown", async (t) => {
  const root = makeTempRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const errors = [];
  const watcher = createRecursiveWatcher([root], () => {
    throw new Error("listener blew up");
  }, { debounceMs: 20, forcePoll: true, pollMs: 50, onError: (error) => errors.push(error) });
  t.after(() => watcher.close());
  writeFile(root, "file.js", "v1\n");
  await waitFor(() => errors.length >= 1);
  assert.match(errors[0].message, /listener blew up/);
});

function writeDemoPlugin(root, { extraModule = null } = {}) {
  const modules = [{ id: "main", source: "./plugins/demo/demo.js?v=1" }];
  if (extraModule) modules.push(extraModule);
  writeFile(root, "plugins/demo/demo.js", "globalThis.__demo = 1;\n");
  writeFile(root, "plugins/demo/manifest.json", JSON.stringify({
    schemaVersion: 1,
    id: "demo",
    name: "Demo",
    author: "Zoidium",
    version: "1",
    kind: "extension",
    modules,
  }, null, 2) + "\n");
  writeFile(root, "plugins/registry.json", JSON.stringify({
    schemaVersion: 1,
    plugins: [{
      id: "demo",
      name: "Demo",
      author: "Zoidium",
      version: "1",
      manifest: "./plugins/demo/manifest.json?v=1",
      bundle: "./plugins/demo/bundle.json?v=1",
      integrity: "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
    }],
  }, null, 2) + "\n");
}

test("live bundles see source edits without a restart", async (t) => {
  const root = makeTempRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeDemoPlugin(root);
  const logs = [];
  const bundles = createLiveBundles({ root, onLog: (message) => logs.push(message) });

  const before = await bundles.getFile("plugins/demo/bundle.json");
  assert.ok(before && before.includes("__demo = 1"), "expected the initial module in the bundle");
  const registry = await bundles.getRegistry();
  assert.ok(registry && registry.includes('"id": "demo"'), "expected the demo plugin in the registry");

  writeFile(root, "plugins/demo/demo.js", "globalThis.__demo = 2;\n");
  const after = await bundles.getFile("plugins/demo/bundle.json");
  assert.ok(after && after.includes("__demo = 2"), "expected the edit in the rebuilt bundle");
  assert.ok(!after.includes("__demo = 1"), "expected the old bytes to be gone");
});

test("live bundles see added manifest modules and keep serving on failure", async (t) => {
  const root = makeTempRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeDemoPlugin(root);
  const bundles = createLiveBundles({ root, onLog: () => {} });
  const good = await bundles.getFile("plugins/demo/bundle.json");
  assert.ok(good);

  writeFile(root, "plugins/demo/extra.js", "globalThis.__extra = true;\n");
  const manifestPath = path.join(root, "plugins/demo/manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  manifest.modules.push({ id: "extra", source: "./plugins/demo/extra.js?v=1" });
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  const withExtra = await bundles.getFile("plugins/demo/bundle.json");
  assert.ok(withExtra && withExtra.includes("__extra"), "expected the added module in the rebuilt bundle");

  fs.rmSync(path.join(root, "plugins/demo/extra.js"));
  const lastGood = await bundles.getFile("plugins/demo/bundle.json");
  assert.ok(lastGood && lastGood.includes("__extra"), "expected the last good bundle after a failed rebuild");
  assert.ok(bundles.getError(), "expected the rebuild error to be recorded");
  assert.match(String(bundles.getStats().error), /extra\.js/);
});

test("live presets serve listed fonts and ignore anything else", async (t) => {
  const root = makeTempRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeFile(root, "fonts/presets.json", JSON.stringify([{ name: "demo" }]));
  writeFile(root, "fonts/presets/demo.ttf", "fake-ttf-bytes");
  const presets = createLivePresets({ root, onLog: () => {} });

  const bytes = await presets.getPresetBytes("demo");
  assert.equal(bytes && bytes.toString(), "fake-ttf-bytes");
  assert.equal(await presets.getPresetBytes("missing"), null);
  assert.equal(await presets.getPresetBytes("../presets"), null);
  assert.equal(await presets.getPresetBytes("a/b"), null);
  assert.equal(await presets.getPresetBytes(".."), null);
  assert.equal(await presets.getPresetBytes(""), null);

  writeFile(root, "fonts/presets.json", JSON.stringify([{ name: "_led.preset-1" }]));
  writeFile(root, "fonts/presets/_led.preset-1.ttf", "dash-bytes");
  assert.equal((await presets.getPresetBytes("_led.preset-1")).toString(), "dash-bytes");
});

test("live community source refreshes on edit and holds last good on removal", async (t) => {
  const root = makeTempRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeFile(root, "zoidium/part.js", "v1\n");
  const community = createLiveCommunitySource({
    root,
    files: ["part.js"],
    runtimeSource: () => fs.readFileSync(path.join(root, "zoidium", "part.js"), "utf8"),
    onLog: () => {},
  });
  const before = await community.get();
  assert.ok(before.includes("v1"));
  writeFile(root, "zoidium/part.js", "v2\n");
  assert.ok((await community.get()).includes("v2"));
  fs.rmSync(path.join(root, "zoidium", "part.js"));
  assert.ok((await community.get()).includes("v2"), "expected the last good bytes after removal");
});

test("approvals cache avoids recomputation within its TTL", async (t) => {
  const root = makeTempRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const receiptPath = writeFile(root, "receipt.js", "module.exports = { fingerprint: 'fp', plugins: {} };\n");
  writeFile(root, "plugins/demo/bundle.json", "LIVE");
  let fingerprints = 0;
  const approvals = {
    root,
    approvalPath: "receipt.js",
    fingerprint: () => {
      fingerprints += 1;
      return "fp";
    },
    source: (receipt) => `STALE:${JSON.stringify(receipt)}`,
  };
  const bundles = {
    ensureFresh: async () => ({ files: new Map([["plugins/demo/bundle.json", "LIVE"]]) }),
  };
  const cache = createApprovalsCache({ approvals, bundles, ttlMs: 60_000, onLog: () => {} });
  assert.equal(await cache.get(), fs.readFileSync(receiptPath, "utf8"));
  assert.equal(await cache.get(), fs.readFileSync(receiptPath, "utf8"));
  assert.equal(fingerprints, 1);

  cache.invalidate();
  writeFile(root, "plugins/demo/bundle.json", "OLD");
  const stale = await cache.get();
  assert.ok(stale.startsWith("STALE:"), `expected the stale receipt, got ${stale.slice(0, 40)}`);
  assert.ok(stale.includes('"stale":true'));
});

test("request gate bounds concurrency and drains in order", async () => {
  const gate = createRequestGate({ maxConcurrent: 2 });
  let active = 0;
  let peak = 0;
  const order = [];
  await Promise.all(Array.from({ length: 5 }, (_, index) => gate.run(async () => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 10));
    order.push(index);
    active -= 1;
    return index;
  })));
  assert.ok(peak <= 2, `expected at most 2 concurrent, saw ${peak}`);
  assert.deepEqual(order, [0, 1, 2, 3, 4]);
  assert.deepEqual(gate.stats(), { active: 0, queued: 0, limit: 2 });
});

test("docs build fallback succeeds on the first try", async () => {
  let calls = 0;
  const warnings = [];
  const built = await buildDocsWithFallback(async () => {
    calls += 1;
  }, { baseDelayMs: 1, warn: (message) => warnings.push(message) });
  assert.equal(built, true);
  assert.equal(calls, 1);
  assert.deepEqual(warnings, []);
});

test("docs build fallback retries EMFILE, then succeeds", async () => {
  let calls = 0;
  const warnings = [];
  const built = await buildDocsWithFallback(async () => {
    calls += 1;
    if (calls < 3) throw Object.assign(new Error("too many open files"), { code: "EMFILE" });
  }, { baseDelayMs: 1, warn: (message) => warnings.push(message) });
  assert.equal(built, true);
  assert.equal(calls, 3);
  assert.equal(warnings.length, 2);
  assert.ok(warnings.every((message) => /retrying/.test(message)));
});

test("docs build fallback retries generic child failures, then succeeds", async () => {
  let calls = 0;
  const built = await buildDocsWithFallback(async () => {
    calls += 1;
    // A child build surfaces file pressure as a plain exit failure.
    if (calls < 2) throw new Error("Documentation build exited with 1");
  }, { baseDelayMs: 1, warn: () => {} });
  assert.equal(built, true);
  assert.equal(calls, 2);
});

test("docs build fallback degrades to starting without docs", async () => {
  let calls = 0;
  const warnings = [];
  const built = await buildDocsWithFallback(async () => {
    calls += 1;
    throw new Error("Documentation build exited with 1");
  }, { attempts: 3, baseDelayMs: 1, warn: (message) => warnings.push(message) });
  assert.equal(built, false);
  assert.equal(calls, 3);
  assert.equal(warnings.length, 3);
  assert.match(warnings[2], /starting without \/docs/);
  assert.match(warnings[2], /docs:build/);
});

test("sendBytes answers normally and stays silent on aborted requests", () => {  const sent = [];
  const response = {
    destroyed: false,
    writableEnded: false,
    headersSent: false,
    writeHead(status, headers) {
      sent.push(["writeHead", status, headers]);
    },
    end(body) {
      sent.push(["end", body.toString()]);
    },
  };
  assert.equal(sendBytes(null, response, { status: 200, contentType: "text/plain", bytes: "hello" }), true);
  assert.deepEqual(sent[0], ["writeHead", 200, {
    "Content-Type": "text/plain",
    "Content-Length": "5",
    "Cache-Control": "no-cache",
  }]);
  assert.deepEqual(sent[1], ["end", "hello"]);

  const aborted = { aborted: true };
  const dead = { destroyed: true, writableEnded: false, headersSent: false, writeHead() { throw new Error("must not send"); }, end() { throw new Error("must not send"); } };
  assert.equal(sendBytes(aborted, dead), false);
  assert.equal(sendBytes(null, { destroyed: false, writableEnded: true, headersSent: true }), false);
});
