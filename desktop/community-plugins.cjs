"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { createHash, randomUUID } = require("node:crypto");
const P = require("../zoidium/community-package");
const S = require("../zoidium/community-safe-json");
const { validateStorage } = require("../zoidium/community-plugin-store");
const HASH = /^sha256-[A-Za-z0-9+/]{43}=$/;
const INDEX_LIMIT = 4 * 1024 * 1024;
function digest(bytes) { return "sha256-" + createHash("sha256").update(bytes).digest("base64"); }
function filename(hash) {
  if (!HASH.test(hash)) throw new Error("Invalid community package hash.");
  return Buffer.from(hash.slice(7), "base64").toString("hex") + ".json";
}
async function regularFile(file, limit) {
  const handle = await fs.open(file, require("node:fs").constants.O_RDONLY | require("node:fs").constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > limit) throw new Error("Invalid community storage file.");
    return await handle.readFile();
  } finally { await handle.close(); }
}
function createDiskAdapter(userData) {
  const root = path.join(userData, "community-plugins"), blobs = path.join(root, "packages"), index = path.join(root, "index.json");
  let tail = Promise.resolve();
  function serial(action) { const next = tail.then(action); tail = next.catch(() => {}); return next; }
  async function directory(dir) {
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    if (!(await fs.lstat(dir)).isDirectory()) throw new Error("Invalid community storage directory.");
  }
  async function init() { await directory(root); await directory(blobs); }
  async function syncDirectory(dir) {
    if (process.platform === "win32") return;
    const handle = await fs.open(dir, "r");
    try { await handle.sync(); } finally { await handle.close(); }
  }
  async function atomic(file, bytes) {
    const temporary = file + "." + randomUUID() + ".tmp";
    let handle;
    try {
      handle = await fs.open(temporary, "wx", 0o600); await handle.writeFile(bytes); await handle.sync();
      await handle.close(); handle = null;
      await fs.rename(temporary, file); await syncDirectory(path.dirname(file));
    } finally { await handle?.close(); await fs.rm(temporary, { force: true }); }
  }
  async function load() {
    await init();
    let bytes;
    try { bytes = await regularFile(index, INDEX_LIMIT); } catch (error) { if (error.code === "ENOENT") return null; throw error; }
    const state = S.parse(bytes.toString("utf8"), INDEX_LIMIT), packages = state.blobs;
    S.keys(state, ["schemaVersion", "revision", "records", "blobs", "safeMode", "attempts"]);
    if (!packages || typeof packages !== "object" || Array.isArray(packages) || Object.keys(packages).length > P.LIMITS.installed * 3) throw new Error("Invalid community package index.");
    state.blobs = {};
    let total = 0;
    for (const hash of Object.keys(packages)) {
      if (packages[hash] !== true) throw new Error("Invalid community package index.");
      let data;
      try { data = await regularFile(path.join(blobs, filename(hash)), P.LIMITS.packageBytes); }
      catch (error) { if (error.code !== "ENOENT") throw error; data = Buffer.alloc(0); }
      total += data.byteLength;
      if (total > P.LIMITS.storageBytes) throw new Error("Community storage quota exceeded.");
      // Preserve corrupt bytes for the store's quarantine and management path.
      state.blobs[hash] = new Uint8Array(data);
    }
    return validateStorage(state);
  }
  async function commit(revision, next) {
    next = structuredClone(next); validateStorage(next);
    if (!Number.isSafeInteger(revision) || next.revision !== revision + 1) throw new Error("Invalid community storage revision.");
    const prior = await load();
    if ((prior?.revision || 0) !== revision) { const error = new Error("Community storage changed. Refresh and try again."); error.code = "REVISION_CONFLICT"; throw error; }
    const metadata = { ...next, blobs: {} };
    for (const [hash, bytes] of Object.entries(next.blobs)) {
      // Existing corrupt packages remain removable without rewriting them.
      if (digest(bytes) !== hash) {
        if (!prior?.blobs[hash] || !Buffer.from(prior.blobs[hash]).equals(Buffer.from(bytes))) throw new Error("Community package hash verification failed.");
      } else P.parse(bytes);
      metadata.blobs[hash] = true;
    }
    const encoded = Buffer.from(JSON.stringify(metadata));
    if (encoded.length > INDEX_LIMIT) throw new Error("Community package index limit exceeded.");
    for (const [hash, bytes] of Object.entries(next.blobs)) await atomic(path.join(blobs, filename(hash)), bytes);
    await atomic(index, encoded);
    // Orphans from interrupted commits never enter the authoritative index.
    const retained = new Set(Object.keys(next.blobs).map(filename));
    for (const entry of await fs.readdir(blobs)) {
      if (/^[a-f0-9]{64}\.json(?:\.[a-f0-9-]+\.tmp)?$/.test(entry) && !retained.has(entry)) await fs.rm(path.join(blobs, entry), { force: true });
    }
  }
  return { load: () => serial(load), commit: (revision, next) => serial(() => commit(revision, next)) };
}
module.exports = { createDiskAdapter, digest, filename };
