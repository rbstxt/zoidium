"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const {
  buildResourceStage,
  discoverEditorEntryScript,
  discoverTextReferences,
  inspectResourceCache,
  normalizeResourcePath,
  patchIndexHtml,
  patchThreeR91Source,
} = require("../tools/runtime-resources");

test("resource paths reject traversal outside the stage", () => {
  assert.equal(normalizeResourcePath("assets/../effect/test.js"), "effect/test.js");
  assert.throws(() => normalizeResourcePath("../outside.js"), /Invalid CM3 resource path/);
  assert.throws(() => normalizeResourcePath("%2e%2e%2foutside.js"), /Invalid CM3 resource path/);
});

test("CM3 site-root shader paths are remapped into the source directory", () => {
  const references = discoverTextReferences(
    'this.shaderfile = "blend";',
    "https://panzoid.com/legacy/gen3/effect/example.js",
    "https://panzoid.com/legacy/gen3/clipmaker.html",
    "https://panzoid.com/legacy/gen3/"
  );
  assert.deepEqual(references.get("assets/shaders/fragment/blend.glsl"), {
    sourcePath: "assets/shaders/fragment/blend.glsl",
    url: "https://panzoid.com/legacy/gen3/assets/shaders/fragment/blend.glsl",
  });
});

test("the source page patch defers CM3 initialization and adds the bootstrap", () => {
  const source = [
    "<!doctype html>",
    "<head>",
    '<script src="core-1.0.0.js"></script>',
    '<script src="clipmaker-1.0.0.js"></script>',
    "<script>PZ.ui.ads.init(); initTool();</script>",
    "</head>",
  ].join("\n");

  const patched = patchIndexHtml(source);
  assert.match(patched, /zoidium\/runtime-config\.js/);
  assert.match(patched, /zoidium-runtime-profiles\.js/);
  assert.match(patched, /zoidium\/runtime-policy\.js/);
  assert.match(patched, /zoidium\/runtime-loader\.js/);
  assert.doesNotMatch(patched, /src="clipmaker-1\.0\.0\.js"/);
  assert.doesNotMatch(patched, /PZ\.ui\.ads\.init\s*\(\)\s*;/);
  assert.doesNotMatch(patched, /initTool\s*\(\)\s*;/);
});

test("layout entry scripts are discovered from their source pages", () => {
  const clipmaker = discoverEditorEntryScript(
    '<script src="./clipmaker-3.0.106.js"></script>',
    "https://panzoid.com/legacy/gen3/clipmaker.html",
    "clipmaker"
  );
  const videoEditor = discoverEditorEntryScript(
    '<script src="./videoeditor-2.0.69.js"></script>',
    "https://panzoid.com/legacy/gen3/videoeditor.html",
    "videoeditor"
  );

  assert.equal(clipmaker.sourcePath, "clipmaker-3.0.106.js");
  assert.equal(videoEditor.sourcePath, "videoeditor-2.0.69.js");
});

test("the staged three.js patch adds the four extended bevel options", () => {
  const source = [
    "E=void 0!==b.UVGenerator?b.UVGenerator:fb.WorldUVGenerator;",
    "y||(v=q=x=0);",
    "V=Xa.triangulateShape(a,O),X=a;Q=0;for(M=O.length;Q<M;Q++)S=O[Q],a=a.concat(S);",
    "for(R=0;R<x;R++){W=R/x;var fa=q*Math.cos(W*Math.PI/2);U=v*Math.sin(W*Math.PI/2);",
    "ha=c(S[J],ca[J],U),f(ha.x,ha.y,-fa)",
    "ha=y?c(a[J],ea[J],U):a[J]",
    "ha=y?c(a[J],ea[J],U):a[J]",
    "for(R=x-1;0<=R;R--){W=R/x;fa=q*Math.cos(W*Math.PI/2);U=v*Math.sin(W*Math.PI/2);",
    "ha=c(S[J],ca[J],U),A?f(ha.x,ha.y+H[B-1].y,H[B-1].x+fa):f(ha.x,ha.y,m+fa)",
  ].join("\n");

  const patched = patchThreeR91Source(source);
  assert.match(patched, /bevelProfilePow/);
  assert.match(patched, /bevelRound/);
  assert.match(patched, /bevelSizeInner/);
  assert.match(patched, /bevelShift/);
  assert.match(patched, /verticesSizes/);
  assert.equal(patchThreeR91Source(patched), patched);
});

const { fetchBytes } = require("../tools/runtime-resources");

test("resource fetch retries temporary HTTP errors within one timeout budget", async () => {
  let calls = 0;
  const result = await fetchBytes("https://example.test/cm3/script.js", {
    timeoutMs: 2000,
    fetchImpl: async () => ++calls === 1 ? new Response("busy", { status: 503, headers: { "Retry-After": "0" } }) : new Response("ready"),
  });
  assert.equal(calls, 2);
  assert.equal(result.bytes.toString(), "ready");
});

test("permanent HTTP failures and policy violations are not retried", async () => {
  for (const response of [
    { ok: false, status: 404 },
    { ok: true, url: "https://other.test/cm3/script.js" },
    { ok: true, url: "https://example.test/outside/script.js" },
  ]) {
    let calls = 0;
    await assert.rejects(fetchBytes("https://example.test/cm3/script.js", {
      allowedOrigin: "https://example.test",
      allowedDirectory: "https://example.test/cm3/",
      fetchImpl: async () => { calls += 1; return response; },
    }));
    assert.equal(calls, 1);
  }
});

test("retry-after waiting shares the fetch timeout and honors caller abort", async () => {
  let calls = 0;
  const busy = async () => { calls += 1; return new Response("busy", { status: 429, headers: { "Retry-After": "60" } }); };
  await assert.rejects(fetchBytes("https://example.test/cm3/script.js", { fetchImpl: busy, timeoutMs: 20 }), /Timed out/);
  assert.equal(calls, 1);
  const controller = new AbortController();
  const reason = new Error("caller cancelled");
  const pending = fetchBytes("https://example.test/cm3/script.js", { fetchImpl: busy, timeoutMs: 1000, signal: controller.signal });
  setTimeout(() => controller.abort(reason), 10);
  await assert.rejects(pending, (error) => error === reason);
  assert.equal(calls, 2);
});

test("a network error retries but a fetch AbortError does not", async () => {
  let calls = 0;
  await fetchBytes("https://example.test/cm3/script.js", {
    fetchImpl: async () => { if (++calls === 1) throw new TypeError("fetch failed"); return new Response("ready"); },
  });
  assert.equal(calls, 2);
  calls = 0;
  await assert.rejects(fetchBytes("https://example.test/cm3/script.js", {
    fetchImpl: async () => { calls += 1; throw new DOMException("cancelled", "AbortError"); },
  }), { name: "AbortError" });
  assert.equal(calls, 1);
});

test("repeated transient failures stop after three attempts with the last error", async () => {
  let calls = 0;
  await assert.rejects(fetchBytes("https://example.test/cm3/script.js", {
    timeoutMs: 30000,
    fetchImpl: async () => { calls += 1; return new Response("busy", { status: 503 }); },
  }), /HTTP 503 for https:\/\/example\.test\/cm3\/script\.js/);
  assert.equal(calls, 3);
});

test("a challenge page fails fast without retry", async () => {
  let calls = 0;
  await assert.rejects(fetchBytes("https://example.test/cm3/script.js", {
    fetchImpl: async () => { calls += 1; return new Response("<html><body>Just a moment...</body></html>", { status: 200 }); },
  }), /browser check/);
  assert.equal(calls, 1);
});

test("a tampered cached resource fails validation without refetching", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "zoidium-integrity-test-"));
  t.after(() => fs.rm(root, { force: true, recursive: true }));
  const sourcePageUrl = "https://example.test/cm3/clipmaker.html";
  const videoEditorSourcePageUrl = "https://example.test/cm3/videoeditor.html";
  const page = (layout) => `<html><head><script src="core-1.js"></script><script src="${layout}-1.js"></script><script>PZ.ui.ads.init(); initTool();</script></head></html>`;
  const fetchImpl = async (url) => new Response(
    url === sourcePageUrl ? page("clipmaker") : url === videoEditorSourcePageUrl ? page("videoeditor") : "// CM3 fixture",
  );
  const cacheRoot = path.join(root, "cache");
  await buildResourceStage(cacheRoot, sourcePageUrl, { videoEditorSourcePageUrl, fetchImpl });
  const options = { sourcePageUrl, videoEditorSourcePageUrl };
  assert.equal((await inspectResourceCache({ ...options, cacheRoot, verifyHashes: true })).valid, true);
  const metadata = (await inspectResourceCache({ ...options, cacheRoot, verifyHashes: true })).metadata;
  assert.ok(metadata.resources.length > 0);
  const tampered = path.join(cacheRoot, metadata.resources[0].sourcePath);
  const bytes = await fs.readFile(tampered);
  bytes[0] ^= 0xff;
  await fs.writeFile(tampered, bytes);
  const inspection = await inspectResourceCache({ ...options, cacheRoot, verifyHashes: true });
  assert.equal(inspection.valid, false);
  assert.match(inspection.reason, /hash does not match/);
});
