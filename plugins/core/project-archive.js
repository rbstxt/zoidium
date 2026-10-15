// Project archives use in-memory gzip/TAR; CM3 ignores optional integrity data.
(function installProjectArchive(global) {
  "use strict";
  const MAX_BYTES = 2048 * 1024 * 1024; // Zip-bomb guard, far above real projects.
  const LIMIT_LABEL = "2 GB";
  const MAX_JSON_BYTES = 32 * 1024 * 1024;
  const MAX_ENTRIES = 10000;
  const WAIT_MS = 10000;
  // 10 s plus 1 s per 4 MB, so a slow disk or a large video is not a failure.
  function budget(size, minimum = WAIT_MS) {
    const bytes = Number(size) > 0 ? Number(size) : 0;
    return Math.max(minimum, WAIT_MS + Math.floor(bytes / (4 * 1024 * 1024)) * 1000);
  }
  // Without onSlow a step that outlives its budget fails. A user-started save
  // or open passes onSlow(label, signal) instead: it resolves true to keep
  // waiting another budget, false to stop. A slow disk, a network or cloud
  // placeholder file is then never a failure. The signal aborts when the step
  // finishes while the question is still open.
  function bounded(value, label, milliseconds = WAIT_MS, cancel, onSlow) {
    return new Promise((resolve, reject) => {
      let settled = false;
      let timer = null;
      let question = null;
      const finish = (callback, result) => {
        if (settled) return;
        settled = true;
        global.clearTimeout(timer);
        if (question) question.abort();
        callback(result);
      };
      const stop = message => {
        if (cancel) { try { cancel(); } catch (_error) { /* best effort */ } }
        finish(reject, new Error(label + message + " No incomplete archive was delivered."));
      };
      const arm = () => {
        timer = global.setTimeout(async () => {
          if (settled) return;
          if (typeof onSlow !== "function") {
            stop(" did not finish within " + Math.ceil(milliseconds / 1000) + " seconds.");
            return;
          }
          question = typeof global.AbortController === "function" ? new global.AbortController() : null;
          let keepWaiting = false;
          try { keepWaiting = await onSlow(label, question && question.signal); } catch (_error) { keepWaiting = false; }
          question = null;
          if (settled) return;
          if (keepWaiting) arm();
          else stop(" was stopped.");
        }, milliseconds);
      };
      arm();
      Promise.resolve(value).then(result => finish(resolve, result), error => finish(reject, error));
    });
  }
  async function bytes(data, label = "Archive entry", onSlow) {
    const size = Number(data && (data.size ?? data.byteLength));
    if (size > MAX_BYTES) throw new Error(label + " exceeds the " + LIMIT_LABEL + " safety limit.");
    if (data && typeof data.arrayBuffer === "function") {
      const result = new Uint8Array(await bounded(data.arrayBuffer(), label, budget(size), undefined, onSlow));
      if (Number.isFinite(size) && result.byteLength !== size) throw new Error(label + " was read incompletely.");
      return result;
    }
    if (data instanceof ArrayBuffer) return new Uint8Array(data);
    if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    throw new Error(label + " cannot be read.");
  }
  async function hash(data) {
    if (!global.crypto?.subtle) throw new Error("Secure hashing is unavailable. Nothing was replaced.");
    const input = await bytes(data);
    const digest = await bounded(global.crypto.subtle.digest("SHA-256", input), "Asset hash", budget(input.byteLength));
    return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, "0")).join("");
  }
  function safeName(name) {
    if (typeof name !== "string" || !name || name.includes("\0") || name.startsWith("/") ||
        name.includes("\\") || name.split("/").some(part => part === ".." || part === ".")) {
      throw new Error("Unsafe archive entry: " + String(name));
    }
    return name;
  }
  async function collect(stream, limit, label, onSlow) {
    const reader = stream.getReader();
    const chunks = [];
    let size = 0;
    try {
      for (;;) {
        const next = await bounded(reader.read(), label, WAIT_MS, () => reader.cancel().catch(() => {}), onSlow);
        if (next.done) break;
        size += next.value.byteLength;
        if (size > limit) throw new Error(label + " exceeds the " + LIMIT_LABEL + " safety limit.");
        chunks.push(next.value);
      }
      return new Blob(chunks);
    } catch (error) {
      reader.cancel().catch(() => {});
      throw error;
    } finally {
      reader.releaseLock();
    }
  }
  function octal(header, offset, length, value) {
    const text = value.toString(8).padStart(length - 1, "0") + "\0";
    header.set(new TextEncoder().encode(text), offset);
  }
  async function encode(archive, onSlow) {
    if (typeof global.CompressionStream !== "function") throw new Error("In-memory project compression is unavailable.");
    const chunks = [];
    const names = new Set();
    let total = 1024;
    for (const entry of archive.files) {
      const name = safeName(entry.name);
      if (names.has(name)) throw new Error("Duplicate archive entry: " + name);
      names.add(name);
      const nameBytes = new TextEncoder().encode(name);
      if (nameBytes.length > 100) throw new Error("Archive entry name is too long: " + name);
      const data = entry.data instanceof Blob ? entry.data : new Blob([await bytes(entry.data, name)]);
      total += 512 + Math.ceil(data.size / 512) * 512;
      if (data.size > MAX_BYTES || total > MAX_BYTES) throw new Error("The project exceeds the " + LIMIT_LABEL + " safety limit. Nothing was replaced.");
      const header = new Uint8Array(512);
      header.set(nameBytes);
      octal(header, 100, 8, 0o644);
      octal(header, 108, 8, 0);
      octal(header, 116, 8, 0);
      octal(header, 124, 12, data.size);
      octal(header, 136, 12, 0);
      header.fill(32, 148, 156);
      header[156] = 48;
      header.set(new TextEncoder().encode("ustar\0"), 257);
      header.set(new TextEncoder().encode("00"), 263);
      octal(header, 148, 7, header.reduce((sum, value) => sum + value, 0));
      header[155] = 32;
      chunks.push(header, data, new Uint8Array((512 - data.size % 512) % 512));
    }
    chunks.push(new Uint8Array(1024));
    return collect(new Blob(chunks).stream().pipeThrough(new global.CompressionStream("gzip")), MAX_BYTES, "Project compression", onSlow);
  }
  function field(header, offset, length) {
    return new TextDecoder().decode(header.subarray(offset, offset + length)).split("\0")[0];
  }
  function numberField(header, offset, length, name) {
    const value = field(header, offset, length).trim();
    if (!/^[0-7]+$/.test(value)) throw new Error("Invalid TAR size or checksum in entry: " + name);
    return parseInt(value, 8);
  }
  async function decode(source, Archive, onSlow) {
    if (!(source?.size > 0)) throw new Error("The archive is empty.");
    if (source.size > MAX_BYTES) throw new Error("The archive exceeds the " + LIMIT_LABEL + " safety limit.");
    if (typeof global.DecompressionStream !== "function") throw new Error("In-memory project decompression is unavailable.");
    const unpacked = await collect(source.stream().pipeThrough(new global.DecompressionStream("gzip")), MAX_BYTES, "Project decompression", onSlow);
    const archive = new Archive();
    const names = new Set();
    let offset = 0;
    let ended = false;
    while (offset + 512 <= unpacked.size) {
      const header = await bytes(unpacked.slice(offset, offset + 512));
      offset += 512;
      if (header.every(value => value === 0)) {
        const trailer = await bytes(unpacked.slice(offset));
        if (trailer.length < 512 || trailer.some(value => value !== 0)) throw new Error("The TAR end marker is incomplete.");
        ended = true;
        break;
      }
      const prefix = field(header, 345, 155);
      const name = safeName((prefix ? prefix + "/" : "") + field(header, 0, 100));
      const checksum = numberField(header, 148, 8, name);
      const expected = header.reduce((sum, value, index) => sum + (index >= 148 && index < 156 ? 32 : value), 0);
      if (checksum !== expected) throw new Error("Invalid TAR header checksum in entry: " + name);
      const size = numberField(header, 124, 12, name);
      if (size > MAX_BYTES || offset + size > unpacked.size) throw new Error("Incomplete or oversized archive entry: " + name);
      if ([0, 48].includes(header[156])) {
        if (names.has(name)) throw new Error("Duplicate archive entry: " + name);
        names.add(name);
        if (names.size > MAX_ENTRIES) throw new Error("The archive has too many entries.");
        if (["project", "meta", "zoidium.json"].includes(name) && size > MAX_JSON_BYTES) throw new Error("JSON entry is too large: " + name);
        // CM3's getFileString expects typed bytes, not a Blob.
        archive.addFile(name, await bytes(unpacked.slice(offset, offset + size), name));
      } else if (header[156] !== 53) {
        throw new Error("Unsupported TAR entry type: " + name);
      }
      offset += Math.ceil(size / 512) * 512;
    }
    if (!ended) throw new Error("The TAR archive is truncated.");
    return archive;
  }
  async function integrity(archive) {
    const entries = Object.create(null);
    for (const entry of archive.files.slice().sort((left, right) => left.name.localeCompare(right.name))) {
      if (entry.name === "zoidium.json") continue;
      const data = await bytes(entry.data, entry.name);
      entries[entry.name] = { size: data.byteLength, sha256: await hash(data) };
    }
    return entries;
  }
  async function checkAssets(archive, document, metadata, mode) {
    const byName = new Map(archive.files.map(entry => [entry.name, entry]));
    const failures = [];
    const badEntries = new Set();
    let documentDamaged = false;
    const assetNames = new Set(Object.entries(document.assets || {}).map(([key, asset]) => asset?.sha256 || key));
    const manifest = metadata?.integrity;
    if (manifest) {
      for (const name of Object.keys(manifest)) {
        const entry = byName.get(name);
        const ref = manifest[name];
        if (!ref || !Number.isSafeInteger(ref.size) || ref.size < 0 || !/^[a-f0-9]{64}$/.test(ref.sha256)) {
          throw Object.assign(new Error("Invalid integrity record for entry: " + name), { name: "ProjectDataError" });
        }
        const before = failures.length;
        if (!entry) failures.push("Entry \"" + name + "\" is missing");
        else {
          const data = await bytes(entry.data, name);
          if (data.byteLength !== ref.size) failures.push("Entry \"" + name + "\" has the wrong size");
          else if (await hash(data) !== ref.sha256) failures.push("Entry \"" + name + "\" has the wrong SHA-256 hash");
        }
        if (failures.length > before) {
          badEntries.add(name);
          if (!assetNames.has(name)) documentDamaged = true;
        }
      }
      for (const entry of archive.files) {
        if (entry.name !== "zoidium.json" && !Object.prototype.hasOwnProperty.call(manifest, entry.name)) {
          failures.push("Entry " + entry.name + " has no integrity record");
          badEntries.add(entry.name);
          if (!assetNames.has(entry.name)) documentDamaged = true;
        }
      }
    }
    for (const [key, asset] of Object.entries(document.assets || {})) {
      if (!asset || asset.external === true || asset.source === 3 || asset.source === 4) continue;
      const name = asset.sha256 || key;
      const label = "Asset \"" + (asset.filename || name) + "\" (" + name + ")";
      const entry = byName.get(name);
      const before = failures.length;
      if (!entry) { failures.push(label + " is missing"); continue; }
      const data = await bytes(entry.data, label);
      if (!data.byteLength) failures.push(label + " is empty");
      if (asset.size > 0 && asset.size !== data.byteLength) failures.push(label + " has the wrong size");
      // CM3 IDs use the first four little-endian words of a prefix digest.
      // Never replace those IDs with the full integrity digest.
      if (/^[a-f0-9]{32}$/.test(name)) {
        const full = await hash(data.subarray(0, 268435456));
        const native = full.match(/.{8}/g).map(word => word.match(/../g).reverse().join("")).join("").slice(0, 32);
        if (name !== native) failures.push(label + " has the wrong content hash");
      } else if (/^[a-f0-9]{64}$/.test(name) && await hash(data) !== name) failures.push(label + " has the wrong content hash");
      if (failures.length > before) badEntries.add(name);
    }
    if (failures.length) {
      const error = new Error(failures.join("; ") + ". Nothing was replaced.");
      error.name = "ProjectDataError";
      error.entries = failures;
      // Unreadable assets can be opened partially. A failed
      // document hash or a truncated container cannot be repaired safely.
      if (mode === "open" && !documentDamaged) {
        archive.files = archive.files.filter(entry => !badEntries.has(entry.name));
        error.partialArchive = archive;
      }
      throw error;
    }
  }
  // Lists asset references whose asset is not in the project at all. CM3 itself
  // saves and loads such a reference (an editor-only selection can outlive its
  // image, for example). Refusing would lose every other change while no bytes
  // exist that saving could still keep, so callers report them instead. Listed
  // assets with missing bytes remain errors (checkAssets).
  function danglingAssetReferences(document, fail) {
    const assetFields = /^(?:asset|font|image|texture|geometry|vertexShader|fragmentShader|nodeImage|.*(?:Asset|Texture|Map|Data))$/i;
    const dangling = [];
    const visit = (value, path, field, depth) => {
      if (depth > 128) fail("The project data exceeds the 128-level nesting limit");
      if (typeof value === "string" && assetFields.test(field) && /^[a-f0-9]{32}(?:[a-f0-9]{32})?$/.test(value)) {
        if (!document.assets || !Object.prototype.hasOwnProperty.call(document.assets, value)) {
          dangling.push(path + " (" + value + ")");
        }
      } else if (value && typeof value === "object") {
        Object.keys(value).forEach(key => {
          if (path === "project" && key === "assets") return;
          const referenceField = assetFields.test(field) && /^(?:value|keyframes|objects|\d+)$/.test(key) ? field : key;
          visit(value[key], path + "." + key, referenceField, depth + 1);
        });
      }
    };
    visit(document, "project", "", 0);
    return dangling;
  }
  const api = { bounded, budget, bytes, hash, encode, decode, integrity, checkAssets, danglingAssetReferences, MAX_BYTES, LIMIT_LABEL };
  if (global.PZ) global.PZ.zoidiumProjectArchive = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
