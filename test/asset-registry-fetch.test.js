"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const source = fs.readFileSync(path.join(__dirname, "../plugins/core/asset-registry-fetch.js"), "utf8");
const flush = async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); };
function fixture(fetch) {
  const host = { fetch, AbortController, setTimeout: (...args) => setTimeout(...args), clearTimeout: id => clearTimeout(id) };
  vm.runInNewContext(source, host);
  return host.ZoidiumAssetRegistryParts.fetch;
}

test("a preset response timeout retries the request and keeps its consumer pending", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] }); let requests = 0, settled = false;
  const io = fixture((_url, { signal }) => {
    if (++requests === 1) return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new DOMException("Timed out", "AbortError"))));
    return Promise.resolve({ ok: true, arrayBuffer: async () => new ArrayBuffer(4) });
  });
  const operation = io.retry(() => io.response({ url: "/font.ttf" })).then(value => { settled = true; return value; });
  await flush(); t.mock.timers.tick(30000); await flush(); assert.equal(requests, 1); assert.equal(settled, false);
  t.mock.timers.tick(1999); await flush(); assert.equal(requests, 1);
  t.mock.timers.tick(1); await flush(); assert.equal((await operation).byteLength, 4); assert.equal(requests, 2);
});

test("HTTP 429 retries three times then stays failed, while HTTP 404 is terminal", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] }); let requests = 0;
  const io = fixture(async () => { requests++; return { ok: false, status: 429 }; });
  const failed = io.retry(() => io.response({ url: "/font.ttf" })).catch(error => error); await flush();
  for (const delay of [2000, 6000, 18000]) { t.mock.timers.tick(delay); await flush(); }
  assert.match((await failed).message, /HTTP 429/); assert.equal(requests, 4);
  t.mock.timers.tick(60000); await flush(); assert.equal(requests, 4);
  const fatal = fixture(async () => { requests++; return { ok: false, status: 404 }; });
  await assert.rejects(fatal.retry(() => fatal.response({ url: "/missing.ttf" })), /HTTP 404/);
  assert.equal(requests, 5);
});

test("canceling a retry clears its delay and cannot send another request", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] }); let requests = 0;
  const io = fixture(); const controller = new AbortController();
  const operation = io.retry(() => { requests++; return Promise.reject(new TypeError("Failed to fetch")); }, { signal: controller.signal }).catch(error => error);
  await flush(); controller.abort(); assert.match((await operation).message, /canceled/);
  t.mock.timers.tick(60000); await flush(); assert.equal(requests, 1);
});
