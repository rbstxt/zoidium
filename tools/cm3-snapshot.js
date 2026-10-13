#!/usr/bin/env node
"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const zlib = require("node:zlib");
const runtime = require("./runtime-resources");
const { writeFileAtomic } = require("./atomic-write");
const magic = "ZOIDIUM-CM3-SNAPSHOT 1\n";
const format = "ZOIDIUM-CM3-SNAPSHOT";
// Measured 2026-10-11: the production cache exports to ~5.6 MB compressed and
// ~11.7 MB decompressed across 180 entries. The 64 MB ceiling leaves more than
// 5x headroom while bounding a hostile snapshot's transient heap on the
// synchronous gunzip path.
const maximumSnapshotDecompressedBytes = 64 * 1024 * 1024;
const rawPaths = [".zoidium-source/clipmaker.html", ".zoidium-source/videoeditor.html"];
const cachePaths = [runtime.cacheMetadataName, "index.html", "zoidium-runtime-profiles.js"];
const hash = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
const defaultSnapshotMaxAgeDays = 30;
const hmac = (key, value) => crypto.createHmac("sha256", key).update(value).digest();
const encode = (value) => encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);

// Also supports the published IAM example for a reproducible signing test.
function signV4({ url, method = "GET", body = Buffer.alloc(0), accessKeyId, secretAccessKey, region = "auto", service = "s3", date = new Date(), headers = {}, includePayloadHash = true }) {
  const target = new URL(url);
  const timestamp = date.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const day = timestamp.slice(0, 8);
  const payloadHash = hash(body);
  const signed = Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), String(value).trim().replace(/\s+/g, " ")]));
  signed.host = target.host;
  signed["x-amz-date"] = timestamp;
  if (includePayloadHash) signed["x-amz-content-sha256"] = payloadHash;
  const names = Object.keys(signed).sort();
  const query = [...target.searchParams].map(([key, value]) => [encode(key), encode(value)]).sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0).map((pair) => pair.join("=")).join("&");
  const uri = target.pathname.split("/").map((part) => encode(decodeURIComponent(part))).join("/");
  const canonicalRequest = [method, uri, query, names.map((name) => `${name}:${signed[name]}\n`).join(""), names.join(";"), payloadHash].join("\n");
  const scope = `${day}/${region}/${service}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", timestamp, scope, hash(canonicalRequest)].join("\n");
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${secretAccessKey}`, day), region), service), "aws4_request");
  const signature = hmac(signingKey, stringToSign).toString("hex");
  return { headers: { ...signed, authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature}` }, signature, canonicalRequest, stringToSign };
}

function remoteRequest(source, method, body, env) {
  if (source.startsWith("r2://")) {
    const location = new URL(source);
    if (!location.hostname || location.username || location.password || location.search || location.hash || location.pathname === "/") throw new Error("Use r2://bucket/key for a snapshot");
    // Pasted dashboard values often carry a trailing newline or space.
    env = Object.fromEntries(["ZOIDIUM_R2_ACCOUNT_ID", "ZOIDIUM_R2_ACCESS_KEY_ID", "ZOIDIUM_R2_SECRET_ACCESS_KEY"]
      .map((name) => [name, String(env[name] || "").trim()]));
    for (const name of Object.keys(env)) {
      if (!env[name]) throw new Error(`Missing ${name} for the private CM3 snapshot`);
    }
    if (!/^[a-zA-Z0-9]+$/.test(env.ZOIDIUM_R2_ACCOUNT_ID)) throw new Error("Invalid R2 account ID");
    const url = `https://${env.ZOIDIUM_R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${encode(location.hostname)}${location.pathname}`;
    return { url, headers: signV4({ url, method, body, accessKeyId: env.ZOIDIUM_R2_ACCESS_KEY_ID, secretAccessKey: env.ZOIDIUM_R2_SECRET_ACCESS_KEY }).headers };
  }
  const url = new URL(source);
  if (url.protocol !== "https:" || url.username || url.password) throw new Error("Snapshot URLs must use HTTPS without embedded credentials");
  return { url: url.href, headers: env.ZOIDIUM_CM3_SNAPSHOT_TOKEN ? { authorization: `Bearer ${env.ZOIDIUM_CM3_SNAPSHOT_TOKEN}` } : {} };
}

const retryableSnapshotStatus = new Set([408, 429, 500, 502, 503, 504]);

function snapshotTransferTransient(error) {
  if (error && error.retryableSnapshot === true) return true;
  const code = error && (error.code || (error.cause && error.cause.code));
  if (
    [
      "ECONNRESET",
      "ECONNREFUSED",
      "EAI_AGAIN",
      "ETIMEDOUT",
      "UND_ERR_CONNECT_TIMEOUT",
      "UND_ERR_SOCKET",
    ].includes(code)
  ) {
    return true;
  }
  return (
    error instanceof TypeError &&
    /fetch failed|network|terminated/i.test(error.message || "")
  );
}

function snapshotTransferDelay(attempt) {
  return Math.min(300 * 2 ** attempt, 5000);
}

async function transfer(source, { method = "GET", body, fetchImpl = globalThis.fetch, env = process.env } = {}) {
  if (!/^[a-z][a-z\d+.-]*:\/\//i.test(source)) {
    if (method === "GET") return fs.readFile(source);
    writeFileAtomic(source, body);
    return;
  }
  const request = remoteRequest(source, method, body, env);
  // Retry remote transfers like runtime-resources fetchBytes: transient network
  // errors and retryable HTTP statuses get up to three attempts with backoff.
  // The body is a retained Buffer, so PUT retries resend identical bytes.
  for (let attempt = 0; true; attempt += 1) {
    let response;
    try {
      // Never redirect signed requests or bearer credentials to another endpoint.
      response = await fetchImpl(request.url, { method, headers: request.headers, body: method === "PUT" ? body : undefined, redirect: "error", signal: AbortSignal.timeout(60_000) });
    } catch (error) {
      if (!snapshotTransferTransient(error) || attempt >= 2) throw error;
      await new Promise((resolve) => setTimeout(resolve, snapshotTransferDelay(attempt)));
      continue;
    }
    if (!response.ok) {
      // S3-compatible errors name the cause (for example SignatureDoesNotMatch,
      // InvalidAccessKeyId or AccessDenied) without echoing credentials.
      const text = await response.text().catch(() => "");
      const code = /<Code>([A-Za-z]+)<\/Code>/.exec(text);
      const error = new Error(`CM3 snapshot ${method} failed with HTTP ${response.status}${code ? ` (${code[1]})` : ""}`);
      if (!retryableSnapshotStatus.has(response.status) || attempt >= 2) throw error;
      await new Promise((resolve) => setTimeout(resolve, snapshotTransferDelay(attempt)));
      continue;
    }
    if (method === "GET") return Buffer.from(await response.arrayBuffer());
    return;
  }
}

function validatePath(value) {
  if (typeof value !== "string" || /^[\\/]|^[a-zA-Z]:/.test(value) || value.includes("\\") || value !== runtime.normalizeResourcePath(value) || value.split("/").includes("..")) throw new Error("Invalid snapshot entry path");
  if (!cachePaths.includes(value) && !rawPaths.includes(value)) runtime.assertFetchedResourcePath(value);
  return value;
}

// Snapshot age/version metadata. Recorded on export so operators can tell
// how old a snapshot is and which CM3 runtime it pins without restoring it.
// Snapshots exported before this existed have no such metadata; they must
// still decode and restore (with a warning instead of a summary).
function snapshotContentFromMetadata(metadata) {
  const resources = metadata.resources.map((resource) => ({
    bytes: resource.bytes,
    path: resource.sourcePath,
    sha256: resource.sha256,
  }));
  const ordered = [...resources].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return {
    contentSha256: hash(Buffer.from(JSON.stringify(ordered.map((resource) => [resource.path, resource.sha256])), "utf8")),
    entryScripts: {
      clipmaker: metadata.profiles.clipmaker.entryScript,
      videoeditor: metadata.profiles.videoeditor.entryScript,
    },
    resourceCount: resources.length,
    resources,
    totalBytes: resources.reduce((sum, resource) => sum + resource.bytes, 0),
  };
}

function snapshotRecordFromMetadata({ metadata, createdAt }) {
  return {
    contentSha256: snapshotContentFromMetadata(metadata).contentSha256,
    createdAt,
    entryScripts: {
      clipmaker: metadata.profiles.clipmaker.entryScript,
      videoeditor: metadata.profiles.videoeditor.entryScript,
    },
    resourceCount: metadata.resources.length,
    resources: metadata.resources.map((resource) => ({
      bytes: resource.bytes,
      path: resource.sourcePath,
      sha256: resource.sha256,
    })),
    sourcePageUrl: metadata.sourcePageUrl,
    totalBytes: metadata.resources.reduce((sum, resource) => sum + resource.bytes, 0),
    videoEditorSourcePageUrl: metadata.profiles.videoeditor.sourcePageUrl,
  };
}

function snapshotMaxAgeDays(env = process.env) {
  const parsed = Number(String(env.ZOIDIUM_CM3_SNAPSHOT_MAX_AGE_DAYS ?? "").trim());
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return defaultSnapshotMaxAgeDays;
}

function snapshotStrictAge(env = process.env) {
  return ["1", "true", "yes"].includes(String(env.ZOIDIUM_CM3_SNAPSHOT_STRICT_AGE ?? "").trim().toLowerCase());
}

function snapshotAgeDays(createdAt, now = new Date()) {
  const created = new Date(createdAt);
  const timestamp = created.getTime();
  if (!createdAt || Number.isNaN(timestamp)) return null;
  return (now.getTime() - timestamp) / 86_400_000;
}

function formatSnapshotSummary(decoded, now = new Date()) {
  const record = decoded.snapshot;
  const lines = [];
  if (record) {
    const age = snapshotAgeDays(record.createdAt, now);
    const ageText = age === null ? "unknown age" : `${Math.max(0, Math.floor(age))} days ago`;
    lines.push(`[Zoidium] CM3 snapshot created ${record.createdAt} (${ageText})`);
    lines.push(`[Zoidium] CM3 snapshot source: ${record.sourcePageUrl} and ${record.videoEditorSourcePageUrl}`);
    lines.push(`[Zoidium] CM3 snapshot runtime: clipmaker entry ${record.entryScripts.clipmaker}, video editor entry ${record.entryScripts.videoeditor}; ${record.resourceCount} resources, ${record.totalBytes} bytes, content sha256:${record.contentSha256}`);
  } else {
    const fallback = snapshotContentFromMetadata(decoded.metadata);
    lines.push("[Zoidium] CM3 snapshot has no creation metadata (exported by an older Zoidium); its age is unknown");
    lines.push(`[Zoidium] CM3 snapshot runtime: clipmaker entry ${fallback.entryScripts.clipmaker}, video editor entry ${fallback.entryScripts.videoeditor}; ${fallback.resourceCount} resources`);
  }
  return lines;
}

function snapshotAgeWarning(decoded, { env = process.env, now = new Date() } = {}) {
  const record = decoded.snapshot;
  if (!record || snapshotAgeDays(record.createdAt, now) === null) {
    return "CM3 snapshot has no creation metadata, so its age and freshness are unknown. Refresh it when the source pages are reachable; see docs/cm3-resources.md";
  }
  const maxAge = snapshotMaxAgeDays(env);
  const age = snapshotAgeDays(record.createdAt, now);
  if (age > maxAge) {
    return `CM3 snapshot is ${Math.floor(age)} days old (older than the ${maxAge}-day threshold set by ZOIDIUM_CM3_SNAPSHOT_MAX_AGE_DAYS, default 30). It may pin an outdated CM3 runtime; refresh it when the source pages are reachable; see docs/cm3-resources.md`;
  }
  return null;
}

// Prints the summary and any age warning. Age never fails the operation;
// with ZOIDIUM_CM3_SNAPSHOT_STRICT_AGE=1 a stale or metadata-less snapshot
// throws instead. Never fetches upstream.
function reportSnapshot(decoded, { env = process.env, now = new Date() } = {}) {
  for (const line of formatSnapshotSummary(decoded, now)) console.log(line);
  const warning = snapshotAgeWarning(decoded, { env, now });
  if (warning) {
    if (snapshotStrictAge(env)) throw new Error(`Stale CM3 snapshot rejected (ZOIDIUM_CM3_SNAPSHOT_STRICT_AGE=1): ${warning}`);
    console.warn(`[Zoidium] WARNING: ${warning}`);
  }
  return warning;
}

function decodeSnapshot(compressed) {
  const bytes = zlib.gunzipSync(compressed, { maxOutputLength: maximumSnapshotDecompressedBytes });
  if (bytes.subarray(0, magic.length).toString() !== magic) throw new Error("Invalid CM3 snapshot magic");
  const end = bytes.indexOf(10, magic.length);
  if (end < 0) throw new Error("Missing CM3 snapshot header");
  const header = JSON.parse(bytes.subarray(magic.length, end).toString());
  if (header.format !== format || header.version !== 1 || !Array.isArray(header.entries)) throw new Error("Unsupported CM3 snapshot format");
  const files = new Map();
  let offset = end + 1;
  for (const entry of header.entries) {
    const name = validatePath(entry.path);
    if (files.has(name) || !Number.isSafeInteger(entry.bytes) || entry.bytes < 0 || !/^[a-f0-9]{64}$/.test(entry.sha256) || entry.bytes > bytes.length - offset) throw new Error("Invalid snapshot entry size, hash, or duplicate path");
    const contents = bytes.subarray(offset, offset + entry.bytes);
    if (hash(contents) !== entry.sha256) throw new Error(`Snapshot entry hash mismatch: ${name}`);
    files.set(name, contents);
    offset += entry.bytes;
  }
  if (offset !== bytes.length) throw new Error("Unexpected trailing CM3 snapshot bytes");
  if (!cachePaths.every((name) => files.has(name))) throw new Error("Snapshot cache files are missing");
  const metadata = JSON.parse(files.get(runtime.cacheMetadataName));
  if (!Array.isArray(metadata.resources) || header.cacheSchemaVersion !== metadata.schemaVersion || header.sourcePageUrl !== metadata.sourcePageUrl || header.videoEditorSourcePageUrl !== metadata.profiles?.videoeditor?.sourcePageUrl) throw new Error("Snapshot header does not match cache metadata");
  const allowed = new Set([...cachePaths, ...rawPaths, ...metadata.resources.map((resource) => resource.sourcePath)]);
  for (const name of files.keys()) if (!allowed.has(name)) throw new Error(`Snapshot contains an undeclared cache file: ${name}`);
  for (const resource of metadata.resources) {
    const name = validatePath(resource.sourcePath);
    runtime.assertFetchedResourcePath(name);
    const contents = files.get(name);
    if (!contents || contents.length !== resource.bytes || hash(contents) !== resource.sha256) throw new Error(`Snapshot resource does not match metadata: ${name}`);
  }
  for (const [index, layout] of ["clipmaker", "videoeditor"].entries()) {
    const raw = files.get(rawPaths[index]);
    if (raw && (raw.length !== metadata.profiles?.[layout]?.page?.bytes || hash(raw) !== metadata.profiles?.[layout]?.page?.sha256)) throw new Error(`Snapshot raw ${layout} page does not match metadata`);
  }
  const record = header.snapshot && typeof header.snapshot === "object" ? header.snapshot : null;
  return { header, metadata, files, snapshot: record };
}

async function exportSnapshot({ output, cacheRoot = runtime.defaultResourceCacheRoot, sourcePageUrl = runtime.defaultSourcePage, videoEditorSourcePageUrl = runtime.defaultVideoEditorSourcePage, allowInsecureSource = false, ...options }) {
  const inspection = await runtime.inspectResourceCache({ cacheRoot, sourcePageUrl, videoEditorSourcePageUrl, verifyHashes: true, allowInsecureSource });
  if (!inspection.valid) throw new Error(`Cannot export CM3 cache: ${inspection.reason}`);
  const metadata = inspection.metadata;
  const paths = [...cachePaths, ...metadata.resources.map((resource) => resource.sourcePath)];
  for (const name of rawPaths) {
    try { await fs.lstat(runtime.safeStagePath(cacheRoot, name)); paths.push(name); } catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  const contents = [];
  const entries = [];
  for (const name of paths) {
    validatePath(name);
    const file = await runtime.readRegularFile(cacheRoot, name);
    const bytes = await fs.readFile(file.filePath);
    entries.push({ path: name, bytes: bytes.length, sha256: hash(bytes) });
    contents.push(bytes);
  }
  const createdAt = new Date().toISOString();
  const header = { format, version: 1, createdAt, cacheSchemaVersion: metadata.schemaVersion, sourcePageUrl: metadata.sourcePageUrl, videoEditorSourcePageUrl: metadata.profiles.videoeditor.sourcePageUrl, snapshot: snapshotRecordFromMetadata({ metadata, createdAt }), entries };
  const compressed = zlib.gzipSync(Buffer.concat([Buffer.from(`${magic}${JSON.stringify(header)}\n`), ...contents]));
  // Validate the assembled archive too, in case cache files changed during export.
  const decoded = decodeSnapshot(compressed);
  await transfer(output, { ...options, method: "PUT", body: compressed });
  for (const line of formatSnapshotSummary(decoded)) console.log(line);
  return header;
}

async function restoreSnapshot({ from, cacheRoot = runtime.defaultResourceCacheRoot, sourcePageUrl = runtime.defaultSourcePage, videoEditorSourcePageUrl = runtime.defaultVideoEditorSourcePage, allowInsecureSource = false, env = process.env, ...options }) {
  const root = await runtime.assertCacheRootSafe(cacheRoot);
  const snapshot = decodeSnapshot(await transfer(from, { ...options, env }));
  reportSnapshot(snapshot, { env });
  const source = runtime.normalizeSourcePageUrl(sourcePageUrl, { allowInsecureSource });
  const video = runtime.normalizeSourcePageUrl(videoEditorSourcePageUrl, { allowInsecureSource });
  if (snapshot.header.sourcePageUrl !== source || snapshot.header.videoEditorSourcePageUrl !== video) throw new Error("Snapshot source pages do not match the configured pages. Refresh the snapshot; see docs/cm3-resources.md");
  await fs.mkdir(path.dirname(root), { recursive: true });
  const stage = await fs.mkdtemp(path.join(path.dirname(root), ".zoidium-snapshot-"));
  try {
    for (const [name, contents] of snapshot.files) {
      const destination = runtime.safeStagePath(stage, name);
      await fs.mkdir(path.dirname(destination), { recursive: true });
      await fs.writeFile(destination, contents);
    }
    await runtime.copyProjectFiles(stage);
    let inspection = await runtime.inspectResourceCache({ cacheRoot: stage, sourcePageUrl: source, videoEditorSourcePageUrl: video, verifyHashes: true, allowInsecureSource });
    // Compare against today's patch even when the schema has stayed compatible.
    const raw = snapshot.files.get(rawPaths[0]);
    const patchChanged = raw && !Buffer.from(runtime.patchIndexHtml(raw.toString("utf8"))).equals(snapshot.files.get("index.html"));
    if (!inspection.valid || patchChanged) {
      if (!rawPaths.every((name) => snapshot.files.has(name))) throw new Error(`Snapshot cannot be restored: ${inspection.reason}. Refresh the snapshot with raw source pages; see docs/cm3-resources.md`);
      const responses = new Map([[source, snapshot.files.get(rawPaths[0])], [video, snapshot.files.get(rawPaths[1])]]);
      for (const resource of snapshot.metadata.resources) responses.set(resource.url, snapshot.files.get(resource.sourcePath));
      const offlineFetch = async (url) => {
        if (!responses.has(url)) throw new Error("Offline snapshot rebuild requested a URL absent from the snapshot. Refresh the snapshot; see docs/cm3-resources.md");
        const response = new Response(responses.get(url));
        const page = url === source ? snapshot.metadata.profiles.clipmaker.page
          : url === video ? snapshot.metadata.profiles.videoeditor.page : null;
        if (page) Object.defineProperty(response, "url", { value: page.url });
        return response;
      };
      await fs.rm(stage, { recursive: true, force: true });
      await runtime.buildResourceStage(stage, source, { videoEditorSourcePageUrl: video, fetchImpl: offlineFetch, allowInsecureSource });
      inspection = await runtime.inspectResourceCache({ cacheRoot: stage, sourcePageUrl: source, videoEditorSourcePageUrl: video, verifyHashes: true, allowInsecureSource });
      if (!inspection.valid) throw new Error(`Rebuilt snapshot is invalid: ${inspection.reason}. Refresh the snapshot; see docs/cm3-resources.md`);
    }
    await runtime.replaceDirectoryAtomically(stage, root);
    return runtime.stageResultFromMetadata(inspection.metadata, root, true);
  } finally {
    await fs.rm(stage, { recursive: true, force: true });
  }
}

// Read-only inspection. Local files are read from disk without any network
// access; remote sources use the same signed transfer as restore.
async function readSnapshot(source, options = {}) {
  return decodeSnapshot(await transfer(source, options));
}

async function printSnapshotInfo(source, { env = process.env, now = new Date(), ...options } = {}) {
  const decoded = await readSnapshot(source, { ...options, env });
  for (const line of formatSnapshotSummary(decoded, now)) console.log(line);
  const warning = snapshotAgeWarning(decoded, { env, now });
  if (warning) console.warn(`[Zoidium] WARNING: ${warning}`);
  else console.log("[Zoidium] CM3 snapshot is within its freshness threshold");
  if (decoded.snapshot) {
    for (const resource of decoded.snapshot.resources) console.log(`[Zoidium] CM3 snapshot file: ${resource.path} (${resource.bytes} bytes, sha256:${resource.sha256.slice(0, 12)}...)`);
  }
  return decoded;
}

async function main(args = process.argv.slice(2)) {
  args = args.filter((argument) => argument !== "--");
  if (args.includes("--help") || args.includes("-h")) {
    console.log(`Usage: node tools/cm3-snapshot.js export --output=<file|r2://bucket/key>
       node tools/cm3-snapshot.js restore --from=<file|r2://bucket/key|https://url>
       node tools/cm3-snapshot.js --info=<file|r2://bucket/key|https://url>
Inspecting a snapshot prints when it was created, which CM3 runtime files it
pins, and a warning when it is older than ZOIDIUM_CM3_SNAPSHOT_MAX_AGE_DAYS
(default 30). Restoring prints the same summary; age never fails a restore
unless ZOIDIUM_CM3_SNAPSHOT_STRICT_AGE=1 is set.
Private R2 credentials: ZOIDIUM_R2_ACCOUNT_ID, ZOIDIUM_R2_ACCESS_KEY_ID, ZOIDIUM_R2_SECRET_ACCESS_KEY.
HTTPS bearer token: ZOIDIUM_CM3_SNAPSHOT_TOKEN. See docs/cm3-resources.md.`);
    return;
  }
  if (args.length === 1 && args[0].startsWith("--info=")) {
    await printSnapshotInfo(args[0].slice(7));
    return;
  }
  if (args.length !== 2) throw new Error("Specify export --output=<target>, restore --from=<source>, or --info=<source>; see --help");
  if (args[0] === "export" && args[1].startsWith("--output=")) await exportSnapshot({ output: args[1].slice(9) });
  else if (args[0] === "restore" && args[1].startsWith("--from=")) await restoreSnapshot({ from: args[1].slice(7) });
  else if (args[0] === "info" && args[1].startsWith("--from=")) await printSnapshotInfo(args[1].slice(7));
  else throw new Error("Unknown snapshot command; see --help");
  console.log("[Zoidium] CM3 snapshot operation completed");
}
if (require.main === module) main().catch((error) => { console.error(`[Zoidium] ${error.message}`); process.exitCode = 1; });
module.exports = { signV4, remoteRequest, transfer, validatePath, decodeSnapshot, exportSnapshot, restoreSnapshot, readSnapshot, printSnapshotInfo, formatSnapshotSummary, snapshotAgeWarning, snapshotAgeDays, snapshotMaxAgeDays, snapshotStrictAge, reportSnapshot, main, maximumSnapshotDecompressedBytes, defaultSnapshotMaxAgeDays };
