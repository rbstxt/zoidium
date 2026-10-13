"use strict";
// Snapshot age/version metadata: export records it, restore/info report it,
// old snapshots without it still restore with a warning, and age alone never
// fails a build unless ZOIDIUM_CM3_SNAPSHOT_STRICT_AGE=1 is set.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const zlib = require("node:zlib");
const runtime = require("../tools/runtime-resources");
const snapshot = require("../tools/cm3-snapshot");

const sourcePageUrl = "https://example.test/cm3/clipmaker.html";
const videoEditorSourcePageUrl = "https://example.test/cm3/videoeditor.html";
const page = (layout) => `<html><head><script src="core-1.js"></script><script src="${layout}-1.js"></script><script>PZ.ui.ads.init(); initTool();</script></head></html>`;
const options = { sourcePageUrl, videoEditorSourcePageUrl };

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "zoidium-snapshot-meta-test-"));
  t.after(() => fs.rm(root, { force: true, recursive: true }));
  const cacheRoot = path.join(root, "cache");
  const fetchImpl = async (url) => new Response(url === sourcePageUrl ? page("clipmaker") : url === videoEditorSourcePageUrl ? page("videoeditor") : "// CM3 fixture");
  await runtime.buildResourceStage(cacheRoot, sourcePageUrl, { videoEditorSourcePageUrl, fetchImpl });
  const file = path.join(root, "snapshot.zcs");
  await snapshot.exportSnapshot({ ...options, cacheRoot, output: file });
  return { root, cacheRoot, file, fetchImpl };
}

async function mutateHeader(file, change) {
  const unpacked = zlib.gunzipSync(await fs.readFile(file));
  const magicLength = unpacked.indexOf(10) + 1;
  const end = unpacked.indexOf(10, magicLength);
  const header = JSON.parse(unpacked.subarray(magicLength, end).toString());
  change(header);
  await fs.writeFile(file, zlib.gzipSync(Buffer.concat([unpacked.subarray(0, magicLength), Buffer.from(`${JSON.stringify(header)}\n`), unpacked.subarray(end + 1)])));
}

function captureConsole() {
  const messages = [];
  const originalLog = console.log;
  const originalWarn = console.warn;
  console.log = (message) => messages.push(["log", String(message)]);
  console.warn = (message) => messages.push(["warn", String(message)]);
  return { messages, restore() { console.log = originalLog; console.warn = originalWarn; } };
}

function setEnv(t, name, value) {
  const previous = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
  t.after(() => {
    if (previous === undefined) delete process.env[name];
    else process.env[name] = previous;
  });
}

test("export records creation time, source pages, runtime versions and a content hash", async (t) => {
  const f = await fixture(t);
  const decoded = snapshot.decodeSnapshot(await fs.readFile(f.file));
  assert.ok(decoded.snapshot, "expected snapshot metadata in the header");
  assert.match(decoded.snapshot.createdAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  assert.equal(decoded.snapshot.sourcePageUrl, sourcePageUrl);
  assert.equal(decoded.snapshot.videoEditorSourcePageUrl, videoEditorSourcePageUrl);
  assert.equal(decoded.snapshot.entryScripts.clipmaker, decoded.metadata.profiles.clipmaker.entryScript);
  assert.equal(decoded.snapshot.entryScripts.videoeditor, decoded.metadata.profiles.videoeditor.entryScript);
  assert.equal(decoded.snapshot.resourceCount, decoded.metadata.resources.length);
  assert.match(decoded.snapshot.contentSha256, /^[a-f0-9]{64}$/);
  assert.equal(decoded.snapshot.totalBytes, decoded.metadata.resources.reduce((sum, resource) => sum + resource.bytes, 0));
});

test("fresh restore prints an age and version summary without warnings", async (t) => {
  const f = await fixture(t);
  const captured = captureConsole();
  try {
    await snapshot.restoreSnapshot({ ...options, from: f.file, cacheRoot: path.join(f.root, "restored") });
  } finally { captured.restore(); }
  const text = captured.messages.map(([, message]) => message).join("\n");
  assert.match(text, /created .* \(0 days ago\)/);
  assert.match(text, /clipmaker entry clipmaker-1\.js/);
  assert.ok(!captured.messages.some(([kind]) => kind === "warn"), "fresh snapshot must not warn");
});

test("snapshot without metadata still restores but warns that its age is unknown", async (t) => {
  const f = await fixture(t);
  await mutateHeader(f.file, (header) => { delete header.snapshot; delete header.createdAt; });
  assert.equal(snapshot.decodeSnapshot(await fs.readFile(f.file)).snapshot, null);
  const captured = captureConsole();
  try {
    await snapshot.restoreSnapshot({ ...options, from: f.file, cacheRoot: path.join(f.root, "old-restored") });
  } finally { captured.restore(); }
  const text = captured.messages.map(([, message]) => message).join("\n");
  assert.match(text, /no creation metadata/);
  assert.match(text, /clipmaker-1\.js/);
  assert.equal((await runtime.inspectResourceCache({ ...options, cacheRoot: path.join(f.root, "old-restored"), verifyHashes: true })).valid, true);
});

test("snapshot from before the record still reports its age from the header", async (t) => {
  const f = await fixture(t);
  await mutateHeader(f.file, (header) => { delete header.snapshot; header.createdAt = new Date(Date.now() - 40 * 86_400_000).toISOString(); });
  const captured = captureConsole();
  try {
    await snapshot.restoreSnapshot({ ...options, from: f.file, cacheRoot: path.join(f.root, "header-age") });
  } finally { captured.restore(); }
  const text = captured.messages.map(([, message]) => message).join("\n");
  assert.match(text, /\(40 days ago\)/);
  assert.match(text, /40 days old/);
});

test("stale snapshot restores with a warning; the threshold is configurable", async (t) => {
  const f = await fixture(t);
  const old = new Date(Date.now() - 45 * 86_400_000).toISOString();
  await mutateHeader(f.file, (header) => { header.snapshot.createdAt = old; });
  setEnv(t, "ZOIDIUM_CM3_SNAPSHOT_MAX_AGE_DAYS", undefined);
  setEnv(t, "ZOIDIUM_CM3_SNAPSHOT_STRICT_AGE", undefined);
  let captured = captureConsole();
  try {
    await snapshot.restoreSnapshot({ ...options, from: f.file, cacheRoot: path.join(f.root, "stale") });
  } finally { captured.restore(); }
  let text = captured.messages.map(([, message]) => message).join("\n");
  assert.match(text, /45 days old.*30-day threshold/);

  setEnv(t, "ZOIDIUM_CM3_SNAPSHOT_MAX_AGE_DAYS", "60");
  captured = captureConsole();
  try {
    await snapshot.restoreSnapshot({ ...options, from: f.file, cacheRoot: path.join(f.root, "stale60") });
  } finally { captured.restore(); }
  assert.ok(!captured.messages.some(([kind]) => kind === "warn"), "60-day threshold must silence the 45-day warning");

  process.env.ZOIDIUM_CM3_SNAPSHOT_MAX_AGE_DAYS = "10";
  captured = captureConsole();
  try {
    await snapshot.restoreSnapshot({ ...options, from: f.file, cacheRoot: path.join(f.root, "stale10") });
  } finally { captured.restore(); }
  text = captured.messages.map(([, message]) => message).join("\n");
  assert.match(text, /10-day threshold/);
});

test("strict age mode rejects stale and metadata-less snapshots but accepts fresh ones", async (t) => {
  const f = await fixture(t);
  setEnv(t, "ZOIDIUM_CM3_SNAPSHOT_STRICT_AGE", "1");
  setEnv(t, "ZOIDIUM_CM3_SNAPSHOT_MAX_AGE_DAYS", undefined);
  await snapshot.restoreSnapshot({ ...options, from: f.file, cacheRoot: path.join(f.root, "strict-fresh") });
  await mutateHeader(f.file, (header) => { header.snapshot.createdAt = new Date(Date.now() - 45 * 86_400_000).toISOString(); });
  await assert.rejects(snapshot.restoreSnapshot({ ...options, from: f.file, cacheRoot: path.join(f.root, "strict-stale") }), /STRICT_AGE.*45 days old/);
  await mutateHeader(f.file, (header) => { delete header.snapshot; delete header.createdAt; });
  await assert.rejects(snapshot.restoreSnapshot({ ...options, from: f.file, cacheRoot: path.join(f.root, "strict-old") }), /STRICT_AGE.*no creation metadata/);
});

test("info command reports age, versions and files for a local file without network", async (t) => {
  const f = await fixture(t);
  const captured = captureConsole();
  try {
    await snapshot.main([`--info=${f.file}`]);
  } finally { captured.restore(); }
  const text = captured.messages.map(([, message]) => message).join("\n");
  assert.match(text, /CM3 snapshot created/);
  assert.match(text, /clipmaker entry clipmaker-1\.js/);
  assert.match(text, /CM3 snapshot file: clipmaker-1\.js/);
  assert.match(text, /within its freshness threshold/);
  const forbiddenFetch = () => { throw new Error("Network must not be used for local files"); };
  await snapshot.printSnapshotInfo(f.file, { fetchImpl: forbiddenFetch });
});

test("info command warns about stale snapshots without failing", async (t) => {
  const f = await fixture(t);
  await mutateHeader(f.file, (header) => { header.snapshot.createdAt = new Date(Date.now() - 45 * 86_400_000).toISOString(); });
  const captured = captureConsole();
  try {
    await snapshot.printSnapshotInfo(f.file);
  } finally { captured.restore(); }
  assert.ok(captured.messages.some(([kind, message]) => kind === "warn" && /45 days old/.test(message)));
});

test("cache fallback to a snapshot prints the age and version summary", async (t) => {
  const f = await fixture(t);
  setEnv(t, "ZOIDIUM_CM3_SNAPSHOT", f.file);
  setEnv(t, "ZOIDIUM_CM3_SNAPSHOT_STRICT_AGE", undefined);
  const captured = captureConsole();
  try {
    await runtime.ensureResourceCache({ ...options, cacheRoot: path.join(f.root, "env-cache"), fetchImpl: () => { throw new Error("No page fetch allowed"); } });
  } finally { captured.restore(); }
  const text = captured.messages.map(([, message]) => message).join("\n");
  assert.match(text, /restoring the CM3 resource cache from the configured snapshot/);
  assert.match(text, /CM3 snapshot created/);
  assert.match(text, /clipmaker entry/);
});
