"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const zlib = require("node:zlib");
const runtime = require("../tools/runtime-resources");
const snapshot = require("../tools/cm3-snapshot");
const sourcePageUrl = "https://example.test/cm3/clipmaker.html";
const videoEditorSourcePageUrl = "https://example.test/cm3/videoeditor.html";
const page = (layout) => `<html><head><script src="core-1.js"></script><script src="${layout}-1.js"></script><script>PZ.ui.ads.init(); initTool();</script></head></html>`;
const options = { sourcePageUrl, videoEditorSourcePageUrl };
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "zoidium-snapshot-test-"));
  t.after(() => fs.rm(root, { force: true, recursive: true }));
  const cacheRoot = path.join(root, "cache");
  const fetchImpl = async (url) => new Response(url === sourcePageUrl ? page("clipmaker") : url === videoEditorSourcePageUrl ? page("videoeditor") : "// CM3 fixture");
  await runtime.buildResourceStage(cacheRoot, sourcePageUrl, { videoEditorSourcePageUrl, fetchImpl });
  const file = path.join(root, "snapshot.gz");
  await snapshot.exportSnapshot({ ...options, cacheRoot, output: file });
  return { root, cacheRoot, file, fetchImpl };
}
function rewrite(bytes, change) {
  const unpacked = zlib.gunzipSync(bytes);
  const start = unpacked.indexOf(10) + 1;
  const end = unpacked.indexOf(10, start);
  const header = JSON.parse(unpacked.subarray(start, end));
  let payload = unpacked.subarray(end + 1);
  const result = change(header, payload);
  if (result) payload = result;
  return zlib.gzipSync(Buffer.concat([unpacked.subarray(0, start), Buffer.from(`${JSON.stringify(header)}\n`), payload]));
}
const digest = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
function changeMetadata(bytes, change) {
  return rewrite(bytes, (header, payload) => {
    const first = header.entries[0];
    const metadata = JSON.parse(payload.subarray(0, first.bytes));
    change(metadata, header);
    const updated = Buffer.from(JSON.stringify(metadata));
    const rest = payload.subarray(first.bytes);
    first.bytes = updated.length;
    first.sha256 = digest(updated);
    return Buffer.concat([updated, rest]);
  });
}

test("snapshot round trip includes only declared CM3 files and refreshes project files", async (t) => {
  const f = await fixture(t);
  const decoded = snapshot.decodeSnapshot(await fs.readFile(f.file));
  assert.ok(decoded.files.has(".zoidium-source/clipmaker.html"));
  assert.ok(!decoded.files.has("zoidium/runtime-loader.js"));
  const target = path.join(f.root, "restored");
  await snapshot.restoreSnapshot({ ...options, from: f.file, cacheRoot: target });
  assert.equal((await runtime.inspectResourceCache({ ...options, cacheRoot: target, verifyHashes: true })).valid, true);
  assert.ok((await fs.stat(path.join(target, "fonts"))).isDirectory());
  assert.deepEqual(await fs.readFile(path.join(target, "index.html")), await fs.readFile(path.join(f.cacheRoot, "index.html")));
});

test("snapshot rejects tampered hashes, sizes, traversal, absolute and protected paths", async (t) => {
  const f = await fixture(t);
  const bytes = await fs.readFile(f.file);
  for (const mutate of [
    (h) => { h.entries[0].sha256 = "0".repeat(64); },
    (h) => { h.entries[0].bytes += 1; },
    ...["../escape", "a/../escape", "/absolute", "plugins/evil.js", "zoidium/runtime-loader.js", ".zoidium-source/evil.html", "%2e%2e/escape"].map((name) => (h) => { h.entries[0].path = name; }),
  ]) assert.throws(() => snapshot.decodeSnapshot(rewrite(bytes, mutate)));
  assert.throws(() => snapshot.decodeSnapshot(rewrite(bytes, (h) => { h.entries[0].path = "extra.js"; })), /missing/);
});

test("invalid restore leaves the existing target intact", async (t) => {
  const f = await fixture(t);
  const broken = changeMetadata(await fs.readFile(f.file), (metadata) => { metadata.index.sha256 = "0".repeat(64); });
  // Remove raw pages so invalid metadata cannot be repaired offline.
  const withoutRaw = rewrite(broken, (h, payload) => {
    let offset = 0;
    const pieces = [];
    h.entries = h.entries.filter((entry) => {
      const part = payload.subarray(offset, offset + entry.bytes);
      offset += entry.bytes;
      if (entry.path.startsWith(".zoidium-source/")) return false;
      pieces.push(part); return true;
    });
    return Buffer.concat(pieces);
  });
  await fs.writeFile(f.file, withoutRaw);
  const before = await fs.readFile(path.join(f.cacheRoot, "index.html"));
  await assert.rejects(snapshot.restoreSnapshot({ ...options, from: f.file, cacheRoot: f.cacheRoot }), /Refresh the snapshot.*docs\/cm3-resources/);
  assert.deepEqual(await fs.readFile(path.join(f.cacheRoot, "index.html")), before);
});

test("outdated schema rebuilds offline from exact raw pages and resource bytes", async (t) => {
  const f = await fixture(t);
  await fs.writeFile(f.file, changeMetadata(await fs.readFile(f.file), (m, h) => { m.schemaVersion = 1; h.cacheSchemaVersion = 1; }));
  const target = path.join(f.root, "rebuilt");
  await snapshot.restoreSnapshot({ ...options, from: f.file, cacheRoot: target, fetchImpl: () => { throw new Error("No network allowed"); } });
  const inspection = await runtime.inspectResourceCache({ ...options, cacheRoot: target, verifyHashes: true });
  assert.equal(inspection.valid, true);
  assert.equal(inspection.metadata.schemaVersion, runtime.cacheSchemaVersion);
});

test("ensureResourceCache uses env snapshot and explicit refresh uses page fetches", async (t) => {
  const f = await fixture(t);
  const previous = process.env.ZOIDIUM_CM3_SNAPSHOT;
  process.env.ZOIDIUM_CM3_SNAPSHOT = f.file;
  t.after(() => { if (previous === undefined) delete process.env.ZOIDIUM_CM3_SNAPSHOT; else process.env.ZOIDIUM_CM3_SNAPSHOT = previous; });
  const cacheRoot = path.join(f.root, "env-cache");
  await runtime.ensureResourceCache({ ...options, cacheRoot, fetchImpl: () => { throw new Error("No page fetch allowed"); } });
  let calls = 0;
  await runtime.ensureResourceCache({ ...options, cacheRoot, force: true, fetchImpl: (url) => { calls++; return f.fetchImpl(url); } });
  assert.ok(calls >= 2);
});

test("saved page import uses local bytes, reports identical pages and rejects challenges", async (t) => {
  const f = await fixture(t);
  const pageHtml = path.join(f.root, "clip.html");
  const videoEditorHtml = path.join(f.root, "video.html");
  await fs.writeFile(pageHtml, page("clipmaker"));
  await fs.writeFile(videoEditorHtml, page("videoeditor"));
  const messages = [];
  const log = console.log;
  console.log = (message) => messages.push(message);
  try {
    await runtime.ensureResourceCache({ ...options, cacheRoot: f.cacheRoot, force: true, pageHtml, videoEditorHtml, fetchImpl: (url) => { assert.ok(!url.endsWith(".html")); return f.fetchImpl(url); } });
  } finally { console.log = log; }
  assert.ok(messages.some((message) => /identical to the cached version/.test(message)));
  await fs.writeFile(pageHtml, "<title>Just a moment...</title>");
  await assert.rejects(runtime.ensureResourceCache({ ...options, cacheRoot: f.cacheRoot, force: true, pageHtml, videoEditorHtml }), /browser check.*docs\/cm3-resources/);
  await fs.writeFile(pageHtml, "<html>Not CM3</html>");
  await assert.rejects(runtime.ensureResourceCache({ ...options, cacheRoot: f.cacheRoot, force: true, pageHtml, videoEditorHtml }), /no discoverable CM3 entry script/);
  assert.deepEqual(runtime.parseCliArgs(["--setup", `--page-html=${pageHtml}`, `--video-editor-html=${videoEditorHtml}`]).videoEditorHtml, videoEditorHtml);
});

test("challenge detection has actionable guidance and never retries", async () => {
  for (const response of [new Response("blocked", { status: 403, headers: { "cf-mitigated": "challenge" } }), new Response("<title>Just a moment...</title>", { status: 403 }), new Response("<title>Just a moment...</title>")]) {
    let calls = 0;
    await assert.rejects(runtime.fetchBytes(sourcePageUrl, { fetchImpl: async () => { calls++; return response; } }), /browser check.*--page-html.*ZOIDIUM_CM3_SNAPSHOT/);
    assert.equal(calls, 1);
  }
});

test("SigV4 matches the published AWS IAM example", () => {
  // https://aws.amazon.com/jp/builders-flash/202210/way-to-operate-api-2/
  const result = snapshot.signV4({ url: "https://iam.amazonaws.com/?Action=ListUsers&Version=2010-05-08", accessKeyId: "AKIDEXAMPLE", secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY", region: "us-east-1", service: "iam", date: new Date("2015-08-30T12:36:00Z"), headers: { "content-type": "application/x-www-form-urlencoded; charset=utf-8" }, includePayloadHash: false });
  assert.equal(result.signature, "5d672d79c15b13162d9279b0855cfba6789a8edb4c82c400e06b5924a6f2b5d7");
});

test("R2 GET and PUT sign the endpoint, payload and auto region without redirects", async () => {
  const env = { ZOIDIUM_R2_ACCOUNT_ID: "account123", ZOIDIUM_R2_ACCESS_KEY_ID: "example", ZOIDIUM_R2_SECRET_ACCESS_KEY: "secret" };
  for (const method of ["GET", "PUT"]) {
    const body = method === "PUT" ? Buffer.from("snapshot") : undefined;
    await snapshot.transfer("r2://private-bucket/folder/snapshot.gz", { method, body, env, fetchImpl: async (url, request) => {
      assert.equal(url, "https://account123.r2.cloudflarestorage.com/private-bucket/folder/snapshot.gz");
      assert.equal(request.method, method);
      assert.equal(request.redirect, "error");
      assert.equal(request.headers["x-amz-content-sha256"], digest(body || Buffer.alloc(0)));
      assert.match(request.headers.authorization, /\/auto\/s3\/aws4_request/);
      assert.equal(request.body, body);
      return new Response("snapshot");
    } });
  }
  await snapshot.transfer("https://example.test/snapshot", { env: { ZOIDIUM_CM3_SNAPSHOT_TOKEN: "example-token" }, fetchImpl: async (_, request) => { assert.equal(request.headers.authorization, "Bearer example-token"); return new Response("snapshot"); } });
});

test("schema 6 caches without raw pages remain valid and exportable", async (t) => {
  const f = await fixture(t);
  await fs.rm(path.join(f.cacheRoot, ".zoidium-source"), { recursive: true });
  assert.equal((await runtime.inspectResourceCache({ ...options, cacheRoot: f.cacheRoot })).valid, true);
  await snapshot.exportSnapshot({ ...options, cacheRoot: f.cacheRoot, output: f.file });
  const target = path.join(f.root, "old-restored");
  await snapshot.restoreSnapshot({ ...options, from: f.file, cacheRoot: target });
  assert.equal((await runtime.inspectResourceCache({ ...options, cacheRoot: target })).valid, true);
});

test("a changed index patch rebuilds even with a valid schema and matching hashes", async (t) => {
  const f = await fixture(t);
  const oldIndex = Buffer.from(`${runtime.patchIndexHtml(page("clipmaker"))}\n<!-- older patch -->`);
  const metadataPath = path.join(f.cacheRoot, runtime.cacheMetadataName);
  const metadata = JSON.parse(await fs.readFile(metadataPath));
  metadata.index = { bytes: oldIndex.length, sha256: digest(oldIndex) };
  await fs.writeFile(path.join(f.cacheRoot, "index.html"), oldIndex);
  await fs.writeFile(metadataPath, JSON.stringify(metadata));
  await snapshot.exportSnapshot({ ...options, cacheRoot: f.cacheRoot, output: f.file });
  const target = path.join(f.root, "patch-rebuilt");
  await snapshot.restoreSnapshot({ ...options, from: f.file, cacheRoot: target });
  assert.equal(await fs.readFile(path.join(target, "index.html"), "utf8"), runtime.patchIndexHtml(page("clipmaker")));
});

test("offline rebuild refuses newly discovered URLs absent from the snapshot", async (t) => {
  const f = await fixture(t);
  const bytes = await fs.readFile(f.file);
  const decoded = snapshot.decodeSnapshot(bytes);
  const newPage = Buffer.from(page("clipmaker").replace("</head>", '<script src="missing.js"></script></head>'));
  const mutated = rewrite(changeMetadata(bytes, (m, h) => {
    m.schemaVersion = 1; h.cacheSchemaVersion = 1;
    m.profiles.clipmaker.page.bytes = newPage.length;
    m.profiles.clipmaker.page.sha256 = digest(newPage);
  }), (header, payload) => {
    let offset = 0;
    const parts = header.entries.map((entry) => {
      const original = payload.subarray(offset, offset + entry.bytes);
      offset += entry.bytes;
      if (entry.path !== ".zoidium-source/clipmaker.html") return original;
      entry.bytes = newPage.length; entry.sha256 = digest(newPage);
      return newPage;
    });
    return Buffer.concat(parts);
  });
  assert.ok(decoded.files.has(".zoidium-source/clipmaker.html"));
  await fs.writeFile(f.file, mutated);
  await assert.rejects(snapshot.restoreSnapshot({ ...options, from: f.file, cacheRoot: path.join(f.root, "incomplete"), fetchImpl: () => { throw new Error("Network forbidden"); } }), /URL absent from the snapshot.*Refresh the snapshot/);
});

test("raw page hash failures and source mismatch are rejected", async (t) => {
  const f = await fixture(t);
  const raw = path.join(f.cacheRoot, ".zoidium-source/clipmaker.html");
  await fs.appendFile(raw, "tampered");
  assert.match((await runtime.inspectResourceCache({ ...options, cacheRoot: f.cacheRoot })).reason, /raw clipmaker page/);
  await assert.rejects(snapshot.restoreSnapshot({ ...options, sourcePageUrl: "https://other.test/cm3/clipmaker.html", from: f.file, cacheRoot: path.join(f.root, "wrong") }), /source pages do not match.*docs\/cm3-resources/);
});

test("challenge headers fail before consuming the body", async () => {
  await assert.rejects(runtime.fetchBytes(sourcePageUrl, { fetchImpl: async () => ({ status: 403, ok: false, headers: new Headers({ "cf-mitigated": "challenge" }), arrayBuffer() { throw new Error("Body must not be read"); } }) }), /browser check/);
});

test("snapshot CLI accepts the package runner argument separator", async (t) => {
  t.mock.method(runtime, "inspectResourceCache", async () => ({ valid: false, reason: "fixture cache is missing" }));
  await assert.rejects(snapshot.main(["export", "--", "--output=/unused-snapshot-target"]), /Cannot export CM3 cache: fixture cache is missing/);
  assert.equal(runtime.parseCliArgs(["--", "--setup"]).setup, true);
});

test("R2 failures name the S3 error code and trim pasted credentials", async () => {
  const { transfer } = require("../tools/cm3-snapshot.js");
  let seen;
  const fetchImpl = async (url, options) => {
    seen = { url, authorization: options.headers.authorization };
    return { ok: false, status: 403, text: async () => "<?xml version=\"1.0\"?><Error><Code>SignatureDoesNotMatch</Code><Message>x</Message></Error>" };
  };
  const env = { ZOIDIUM_R2_ACCOUNT_ID: "abc123\n", ZOIDIUM_R2_ACCESS_KEY_ID: " key-id ", ZOIDIUM_R2_SECRET_ACCESS_KEY: "secret\n" };
  await assert.rejects(transfer("r2://bucket/snapshot.zcs", { fetchImpl, env }), /HTTP 403 \(SignatureDoesNotMatch\)/);
  assert.equal(seen.url, "https://abc123.r2.cloudflarestorage.com/bucket/snapshot.zcs");
  assert.match(seen.authorization, /Credential=key-id\//);
});
