"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const runtime = require("../tools/runtime-resources");

test("snapshot decompression ceiling is 64 MB with headroom over the real snapshot", () => {
  const snapshot = require("../tools/cm3-snapshot");
  assert.equal(snapshot.maximumSnapshotDecompressedBytes, 64 * 1024 * 1024);
  const zlib = require("node:zlib");
  const bomb = zlib.gzipSync(Buffer.alloc(70 * 1024 * 1024));
  assert.throws(
    () => snapshot.decodeSnapshot(bomb),
    (error) => !/snapshot magic/.test(error.message),
    "a payload past the ceiling must fail before the magic check"
  );
});

// SEC-13: plain-HTTP source pages and redirect hops are refused by default.


test("CM3 source pages and fetch redirects refuse http without the explicit flag", async () => {
  assert.throws(
    () => runtime.normalizeSourcePageUrl("http://example.test/cm3/clipmaker.html"),
    /HTTPS.*--allow-insecure-source/
  );
  assert.equal(
    runtime.normalizeSourcePageUrl("http://example.test/cm3/clipmaker.html", { allowInsecureSource: true }),
    "http://example.test/cm3/clipmaker.html"
  );
  assert.equal(runtime.parseCliArgs(["--allow-insecure-source"]).allowInsecureSource, true);
  let calls = 0;
  await assert.rejects(
    runtime.fetchBytes("http://example.test/cm3/script.js", {
      fetchImpl: async () => { calls += 1; return new Response("x"); },
    }),
    /HTTPS/
  );
  assert.equal(calls, 0);
  const insecure = await runtime.fetchBytes("http://example.test/cm3/script.js", {
    allowInsecureSource: true,
    fetchImpl: async () => new Response("ready"),
  });
  assert.equal(insecure.bytes.toString(), "ready");
  const hopped = {
    ok: true,
    status: 200,
    url: "http://example.test/cm3/other.js",
    headers: { get: () => null },
    arrayBuffer: async () => Buffer.from("x"),
  };
  await assert.rejects(
    runtime.fetchBytes("https://example.test/cm3/script.js", {
      fetchImpl: async () => hopped,
    }),
    /HTTPS/
  );
  const allowed = await runtime.fetchBytes("https://example.test/cm3/script.js", {
    allowInsecureSource: true,
    fetchImpl: async () => hopped,
  });
  assert.equal(allowed.bytes.toString(), "x");
});

// A14: atomic build outputs and retried snapshot transfers.


test("snapshot transfers retry transient failures but not permanent ones", async () => {
  const snapshot = require("../tools/cm3-snapshot");
  let calls = 0;
  const body = await snapshot.transfer("https://example.test/snapshot.gz", {
    env: {},
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) throw new TypeError("fetch failed");
      return new Response("snapshot");
    },
  });
  assert.equal(calls, 2);
  assert.equal(body.toString(), "snapshot");
  calls = 0;
  await assert.rejects(
    snapshot.transfer("https://example.test/snapshot.gz", {
      env: {},
      fetchImpl: async () => {
        calls += 1;
        return { ok: false, status: 404, text: async () => "" };
      },
    }),
    /HTTP 404/
  );
  assert.equal(calls, 1);
  const seen = [];
  await snapshot.transfer("r2://bucket/snapshot.gz", {
    method: "PUT",
    body: Buffer.from("snapshot"),
    env: { ZOIDIUM_R2_ACCOUNT_ID: "abc123", ZOIDIUM_R2_ACCESS_KEY_ID: "key", ZOIDIUM_R2_SECRET_ACCESS_KEY: "secret" },
    fetchImpl: async (url, request) => {
      seen.push(request.body);
      if (seen.length === 1) return { ok: false, status: 503, text: async () => "" };
      return { ok: true, status: 200, text: async () => "" };
    },
  });
  assert.equal(seen.length, 2);
  assert.ok(seen[0].equals(seen[1]), "PUT retries resend identical bytes");
});
