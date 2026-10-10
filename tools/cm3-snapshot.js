#!/usr/bin/env node
"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const zlib = require("node:zlib");
const runtime = require("./runtime-resources");
const magic = "ZOIDIUM-CM3-SNAPSHOT 1\n";
const format = "ZOIDIUM-CM3-SNAPSHOT";
const rawPaths = [".zoidium-source/clipmaker.html", ".zoidium-source/videoeditor.html"];
const cachePaths = [runtime.cacheMetadataName, "index.html", "zoidium-runtime-profiles.js"];
const hash = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
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
    for (const name of ["ZOIDIUM_R2_ACCOUNT_ID", "ZOIDIUM_R2_ACCESS_KEY_ID", "ZOIDIUM_R2_SECRET_ACCESS_KEY"]) {
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

async function transfer(source, { method = "GET", body, fetchImpl = globalThis.fetch, env = process.env } = {}) {
  if (!/^[a-z][a-z\d+.-]*:\/\//i.test(source)) {
    if (method === "GET") return fs.readFile(source);
    await fs.writeFile(source, body);
    return;
  }
  const request = remoteRequest(source, method, body, env);
  // Never redirect signed requests or bearer credentials to another endpoint.
  const response = await fetchImpl(request.url, { method, headers: request.headers, body: method === "PUT" ? body : undefined, redirect: "error", signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`CM3 snapshot ${method} failed with HTTP ${response.status}`);
  if (method === "GET") return Buffer.from(await response.arrayBuffer());
}

function validatePath(value) {
  if (typeof value !== "string" || /^[\\/]|^[a-zA-Z]:/.test(value) || value.includes("\\") || value !== runtime.normalizeResourcePath(value) || value.split("/").includes("..")) throw new Error("Invalid snapshot entry path");
  if (!cachePaths.includes(value) && !rawPaths.includes(value)) runtime.assertFetchedResourcePath(value);
  return value;
}

function decodeSnapshot(compressed) {
  const bytes = zlib.gunzipSync(compressed, { maxOutputLength: 512 * 1024 * 1024 });
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
  return { header, metadata, files };
}

async function exportSnapshot({ output, cacheRoot = runtime.defaultResourceCacheRoot, sourcePageUrl = runtime.defaultSourcePage, videoEditorSourcePageUrl = runtime.defaultVideoEditorSourcePage, ...options }) {
  const inspection = await runtime.inspectResourceCache({ cacheRoot, sourcePageUrl, videoEditorSourcePageUrl, verifyHashes: true });
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
  const header = { format, version: 1, createdAt: new Date().toISOString(), cacheSchemaVersion: metadata.schemaVersion, sourcePageUrl: metadata.sourcePageUrl, videoEditorSourcePageUrl: metadata.profiles.videoeditor.sourcePageUrl, entries };
  const compressed = zlib.gzipSync(Buffer.concat([Buffer.from(`${magic}${JSON.stringify(header)}\n`), ...contents]));
  // Validate the assembled archive too, in case cache files changed during export.
  decodeSnapshot(compressed);
  await transfer(output, { ...options, method: "PUT", body: compressed });
  return header;
}

async function restoreSnapshot({ from, cacheRoot = runtime.defaultResourceCacheRoot, sourcePageUrl = runtime.defaultSourcePage, videoEditorSourcePageUrl = runtime.defaultVideoEditorSourcePage, ...options }) {
  const root = await runtime.assertCacheRootSafe(cacheRoot);
  const snapshot = decodeSnapshot(await transfer(from, options));
  const source = runtime.normalizeSourcePageUrl(sourcePageUrl);
  const video = runtime.normalizeSourcePageUrl(videoEditorSourcePageUrl);
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
    let inspection = await runtime.inspectResourceCache({ cacheRoot: stage, sourcePageUrl: source, videoEditorSourcePageUrl: video, verifyHashes: true });
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
      await runtime.buildResourceStage(stage, source, { videoEditorSourcePageUrl: video, fetchImpl: offlineFetch });
      inspection = await runtime.inspectResourceCache({ cacheRoot: stage, sourcePageUrl: source, videoEditorSourcePageUrl: video, verifyHashes: true });
      if (!inspection.valid) throw new Error(`Rebuilt snapshot is invalid: ${inspection.reason}. Refresh the snapshot; see docs/cm3-resources.md`);
    }
    await runtime.replaceDirectoryAtomically(stage, root);
    return runtime.stageResultFromMetadata(inspection.metadata, root, true);
  } finally {
    await fs.rm(stage, { recursive: true, force: true });
  }
}

async function main(args = process.argv.slice(2)) {
  args = args.filter((argument) => argument !== "--");
  if (args.includes("--help") || args.includes("-h")) {
    console.log("Usage: node tools/cm3-snapshot.js export --output=<file|r2://bucket/key>\n       node tools/cm3-snapshot.js restore --from=<file|r2://bucket/key|https://url>\nPrivate R2 credentials: ZOIDIUM_R2_ACCOUNT_ID, ZOIDIUM_R2_ACCESS_KEY_ID, ZOIDIUM_R2_SECRET_ACCESS_KEY.\nHTTPS bearer token: ZOIDIUM_CM3_SNAPSHOT_TOKEN. See docs/cm3-resources.md.");
    return;
  }
  if (args.length !== 2) throw new Error("Specify export --output=<target> or restore --from=<source>; see --help");
  if (args[0] === "export" && args[1].startsWith("--output=")) await exportSnapshot({ output: args[1].slice(9) });
  else if (args[0] === "restore" && args[1].startsWith("--from=")) await restoreSnapshot({ from: args[1].slice(7) });
  else throw new Error("Unknown snapshot command; see --help");
  console.log("[Zoidium] CM3 snapshot operation completed");
}
if (require.main === module) main().catch((error) => { console.error(`[Zoidium] ${error.message}`); process.exitCode = 1; });
module.exports = { signV4, remoteRequest, transfer, validatePath, decodeSnapshot, exportSnapshot, restoreSnapshot, main };
