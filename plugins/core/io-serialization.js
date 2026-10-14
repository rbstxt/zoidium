// Project archives use in-memory gzip/TAR; CM3 ignores optional integrity data.
(function installProjectArchive(global) {
  "use strict";
  const MAX_BYTES = 512 * 1024 * 1024;
  const MAX_JSON_BYTES = 32 * 1024 * 1024;
  const MAX_ENTRIES = 10000;
  const WAIT_MS = 10000;
  function bounded(value, label, milliseconds = WAIT_MS, cancel) {
    let timer;
    return Promise.race([
      Promise.resolve(value),
      new Promise((_, reject) => {
        timer = global.setTimeout(() => {
          if (cancel) { try { cancel(); } catch (_error) { /* best effort */ } }
          reject(new Error(label + " did not finish within " + Math.ceil(milliseconds / 1000) + " seconds. No incomplete archive was delivered."));
        }, milliseconds);
      }),
    ]).finally(() => global.clearTimeout(timer));
  }
  async function bytes(data, label = "Archive entry") {
    const size = Number(data && (data.size ?? data.byteLength));
    if (size > MAX_BYTES) throw new Error(label + " exceeds the 512 MB safety limit.");
    if (data && typeof data.arrayBuffer === "function") {
      const result = new Uint8Array(await bounded(data.arrayBuffer(), label));
      if (Number.isFinite(size) && result.byteLength !== size) throw new Error(label + " was read incompletely.");
      return result;
    }
    if (data instanceof ArrayBuffer) return new Uint8Array(data);
    if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    throw new Error(label + " cannot be read.");
  }
  async function hash(data) {
    if (!global.crypto?.subtle) throw new Error("Secure hashing is unavailable. Nothing was replaced.");
    const digest = await bounded(global.crypto.subtle.digest("SHA-256", await bytes(data)), "Asset hash");
    return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, "0")).join("");
  }
  function safeName(name) {
    if (typeof name !== "string" || !name || name.includes("\0") || name.startsWith("/") ||
        name.includes("\\") || name.split("/").some(part => part === ".." || part === ".")) {
      throw new Error("Unsafe archive entry: " + String(name));
    }
    return name;
  }
  async function collect(stream, limit, label) {
    const reader = stream.getReader();
    const chunks = [];
    let size = 0;
    try {
      for (;;) {
        const next = await bounded(reader.read(), label, WAIT_MS, () => reader.cancel().catch(() => {}));
        if (next.done) break;
        size += next.value.byteLength;
        if (size > limit) throw new Error(label + " exceeds the 512 MB safety limit.");
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
  async function encode(archive) {
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
      if (data.size > MAX_BYTES || total > MAX_BYTES) throw new Error("The project exceeds the 512 MB safety limit. Nothing was replaced.");
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
    return collect(new Blob(chunks).stream().pipeThrough(new global.CompressionStream("gzip")), MAX_BYTES, "Project compression");
  }
  function field(header, offset, length) {
    return new TextDecoder().decode(header.subarray(offset, offset + length)).split("\0")[0];
  }
  function numberField(header, offset, length, name) {
    const value = field(header, offset, length).trim();
    if (!/^[0-7]+$/.test(value)) throw new Error("Invalid TAR size or checksum in entry: " + name);
    return parseInt(value, 8);
  }
  async function decode(source, Archive) {
    if (!(source?.size > 0)) throw new Error("The archive is empty.");
    if (source.size > MAX_BYTES) throw new Error("The archive exceeds the 512 MB safety limit.");
    if (typeof global.DecompressionStream !== "function") throw new Error("In-memory project decompression is unavailable.");
    const unpacked = await collect(source.stream().pipeThrough(new global.DecompressionStream("gzip")), MAX_BYTES, "Project decompression");
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
  const api = { bounded, bytes, hash, encode, decode, integrity, checkAssets, MAX_BYTES };
  if (global.PZ) global.PZ.zoidiumProjectArchive = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);

(function installIoSerializationPatch(global) {
  "use strict";
  const PATCH_MARKER = "__zoidiumIoSerializationPatch";
  const ORIGINAL_MARKER = "__zoidiumIoSerializationOriginal";
  const RETRY_DELAY_MS = 100;
  const MAX_ATTEMPTS = 200;
  const CLEANUP_TIMEOUT_MS = 5000;
  const DIAGNOSTICS_KEY = "zoidiumIoSerialization";
  const CROSS_TAB_LOCK_NAME = "zoidium-export-workspace-v2";
  const MINIMUM_WORKSPACE_BYTES = 100 * 1024 * 1024;
  const ARCHIVE_HEADROOM_BYTES = 16 * 1024 * 1024;
  const LEASE_DATABASE_NAME = "zoidium-coordination";
  const LEASE_STORE_NAME = "locks";
  const LEASE_DURATION_MS = 5 * 60 * 1000;
  const LEASE_RENEW_MS = 30 * 1000;
  const LEASE_RETRY_MS = 250;
  const CANCELLED = Object.freeze({ cancelled: true });
  function delay(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
  }
  function createWebLockRunner(lockManager) {
    return function runWithWebLock(_kind, task, cancellation) {
      const options = { mode: "exclusive" };
      if (cancellation && cancellation.signal) {
        options.signal = cancellation.signal;
      }
      return Promise.resolve()
        .then(() =>
          lockManager.request(CROSS_TAB_LOCK_NAME, options, function () {
            if (cancellation && cancellation.isCancelled()) return CANCELLED;
            const result = Promise.resolve().then(task);
            return cancellation
              ? Promise.race([result, cancellation.promise])
              : result;
          }),
        )
        .catch((error) => {
          if (
            cancellation &&
            cancellation.isCancelled() &&
            error &&
            error.name === "AbortError"
          ) {
            return CANCELLED;
          }
          throw error;
        });
    };
  }
  function openLeaseDatabase(indexedDb) {
    return new Promise((resolve, reject) => {
      const request = indexedDb.open(LEASE_DATABASE_NAME, 1);
      request.onupgradeneeded = function () {
        if (!request.result.objectStoreNames.contains(LEASE_STORE_NAME)) {
          request.result.createObjectStore(LEASE_STORE_NAME);
        }
      };
      request.onsuccess = function () {
        resolve(request.result);
      };
      request.onerror = function () {
        reject(request.error || new Error("Could not open the export coordination database."));
      };
      request.onblocked = function () {
        reject(new Error("The export coordination database is blocked by another tab."));
      };
    });
  }
  function createIndexedDbLockRunner(globalObject) {
    const indexedDb = globalObject && globalObject.indexedDB;
    if (!indexedDb || typeof indexedDb.open !== "function") return null;
    const databasePromise = openLeaseDatabase(indexedDb);
    const ownerPrefix =
      String(Date.now()) + "-" + Math.random().toString(36).slice(2);
    let requestCounter = 0;
    async function updateLease(token, action) {
      const database = await databasePromise;
      return new Promise((resolve, reject) => {
        const transaction = database.transaction(LEASE_STORE_NAME, "readwrite");
        const store = transaction.objectStore(LEASE_STORE_NAME);
        const request = store.get(CROSS_TAB_LOCK_NAME);
        let result = { acquired: false, expiresAt: 0 };
        request.onsuccess = function () {
          const now = Date.now();
          const current = request.result;
          if (action === "claim") {
            if (!current || current.expiresAt <= now || current.owner === token) {
              const expiresAt = now + LEASE_DURATION_MS;
              store.put({ owner: token, expiresAt }, CROSS_TAB_LOCK_NAME);
              result = { acquired: true, expiresAt };
            } else {
              result.expiresAt = current.expiresAt;
            }
            return;
          }
          if (!current || current.owner !== token) return;
          if (action === "renew") {
            const expiresAt = now + LEASE_DURATION_MS;
            store.put({ owner: token, expiresAt }, CROSS_TAB_LOCK_NAME);
            result = { acquired: true, expiresAt };
          } else if (action === "release") {
            store.delete(CROSS_TAB_LOCK_NAME);
            result = { acquired: true, expiresAt: 0 };
          }
        };
        request.onerror = function () {
          try {
            transaction.abort();
          } catch (_error) {
          }
        };
        transaction.oncomplete = function () {
          resolve(result);
        };
        transaction.onerror = function () {
          reject(
            transaction.error ||
              request.error ||
              new Error("Could not coordinate export access between tabs."),
          );
        };
        transaction.onabort = transaction.onerror;
      });
    }
    return async function runWithIndexedDbLease(_kind, task, cancellation) {
      const token = ownerPrefix + "-" + String(++requestCounter);
      let acquired = false;
      while (!acquired) {
        if (cancellation && cancellation.isCancelled()) return CANCELLED;
        const attempt = await updateLease(token, "claim");
        acquired = attempt.acquired;
        if (!acquired) {
          const wait = Math.max(
            25,
            Math.min(LEASE_RETRY_MS, attempt.expiresAt - Date.now()),
          );
          if (cancellation) {
            const result = await Promise.race([delay(wait), cancellation.promise]);
            if (result === CANCELLED) return CANCELLED;
          } else {
            await delay(wait);
          }
        }
      }
      const renewTimer = setInterval(function () {
        updateLease(token, "renew").catch(function () {});
      }, LEASE_RENEW_MS);
      try {
        if (cancellation) {
          return await Promise.race([
            Promise.resolve().then(task),
            cancellation.promise,
          ]);
        }
        return await task();
      } finally {
        clearInterval(renewTimer);
        await updateLease(token, "release").catch(function () {});
      }
    };
  }
  function createOriginLockRunner(globalObject) {
    const lockManager =
      globalObject && globalObject.navigator && globalObject.navigator.locks;
    if (lockManager && typeof lockManager.request === "function") {
      return {
        mode: "web-locks",
        run: createWebLockRunner(lockManager),
      };
    }
    const indexedDbRunner = createIndexedDbLockRunner(globalObject);
    if (indexedDbRunner) {
      return { mode: "indexeddb-lease", run: indexedDbRunner };
    }
    return {
      mode: "page-only",
      run: function runWithoutCrossTabLock(_kind, task, cancellation) {
        const result = Promise.resolve().then(task);
        return cancellation
          ? Promise.race([result, cancellation.promise])
          : result;
      },
    };
  }
  function byteLength(value) {
    if (!value) return 0;
    if (Number.isFinite(Number(value.size))) return Math.max(0, Number(value.size));
    if (Number.isFinite(Number(value.byteLength))) {
      return Math.max(0, Number(value.byteLength));
    }
    return 0;
  }
  function estimateArchiveStorageBytes(files) {
    let inputBytes = 0;
    for (const file of files || []) inputBytes += byteLength(file && file.data);
    return Math.max(
      MINIMUM_WORKSPACE_BYTES,
      Math.ceil(inputBytes * 1.25 + ARCHIVE_HEADROOM_BYTES),
    );
  }
  function estimateVideoStorageBytes(params, profiles) {
    params = params || {};
    const width = Math.max(1, Number(params.width) || 640);
    const height = Math.max(1, Number(params.height) || 360);
    const rate = Math.max(1, Number(params.rate) || 30);
    const frames = Math.max(0, Number(params.length) || 0);
    const quality = Math.max(0, Math.floor(Number(params.quality) || 0));
    const profile = profiles && profiles[quality] ? profiles[quality] : {};
    const bitrateScale = Number(profile.bitrate) || 1;
    const audioScale = Number(profile.abr) || 1;
    let videoBitrate = (width / 640) * (height / 360) * 1000000;
    if (rate > 30) videoBitrate *= 1.5;
    videoBitrate *= bitrateScale;
    const audioBitrate = 64000 * audioScale;
    const expectedOutput = ((videoBitrate + audioBitrate) * (frames / rate)) / 8;
    return Math.max(
      MINIMUM_WORKSPACE_BYTES,
      Math.ceil(expectedOutput * 1.5 + ARCHIVE_HEADROOM_BYTES),
    );
  }
  function requestPersistentQuota(globalObject, requestedBytes, fallback) {
    const requested = Math.max(
      MINIMUM_WORKSPACE_BYTES,
      Math.ceil(Number(requestedBytes) || MINIMUM_WORKSPACE_BYTES),
    );
    const storage =
      globalObject &&
      globalObject.navigator &&
      globalObject.navigator.webkitPersistentStorage;
    if (!storage || typeof storage.requestQuota !== "function") {
      return typeof fallback === "function"
        ? Promise.resolve().then(() => fallback(requested))
        : Promise.resolve(requested);
    }
    return new Promise((resolve, reject) => {
      try {
        storage.requestQuota(
          requested,
          function (grantedBytes) {
            const granted = Number(grantedBytes);
            if (Number.isFinite(granted) && granted < requested) {
              reject(
                new Error(
                  "The browser did not grant enough temporary storage for this export.",
                ),
              );
              return;
            }
            resolve(Number.isFinite(granted) ? granted : requested);
          },
          function (error) {
            reject(
              error instanceof Error
                ? error
                : new Error("The browser denied temporary storage for this export."),
            );
          },
        );
      } catch (error) {
        reject(error);
      }
    });
  }
  async function assertBlobPrefix(blob, expected, description) {
    if (!blob) return blob;
    if (byteLength(blob) < expected.length) {
      throw new Error(description + " output was empty or incomplete.");
    }
    if (!blob.slice || typeof blob.slice(0, expected.length).arrayBuffer !== "function") {
      return blob;
    }
    const prefix = new Uint8Array(await blob.slice(0, expected.length).arrayBuffer());
    for (let index = 0; index < expected.length; index += 1) {
      if (prefix[index] !== expected[index]) {
        throw new Error(description + " output failed its file-integrity check.");
      }
    }
    return blob;
  }
  function isFileBackedBlob(value) {
    return Boolean(
      value &&
        Number.isFinite(Number(value.size)) &&
        typeof value.slice === "function" &&
        typeof value.stream === "function" &&
        typeof value.name === "string" &&
        value.name.length > 0,
    );
  }
  async function detachFileBackedBlob(blob, description) {
    if (!isFileBackedBlob(blob)) return blob;
    if (typeof Response !== "function" || byteLength(blob) === 0) return blob;
    let copy;
    try {
      copy = await new Response(blob.stream()).blob();
    } catch (error) {
      const failure = new Error(
        description + " could not be read back from the browser's temporary file.",
      );
      failure.cause = error;
      throw failure;
    }
    if (!copy || byteLength(copy) !== byteLength(blob)) {
      throw new Error(
        description + " was copied incompletely from the browser's temporary file.",
      );
    }
    return copy;
  }
  function createIoSerializer(hooks) {
    hooks = hooks || {};
    const notifyWaiter =
      typeof hooks.notifyWaiter === "function" ? hooks.notifyWaiter : null;
    const deleteOutFile =
      typeof hooks.deleteOutFile === "function"
        ? hooks.deleteOutFile
        : defaultDeleteOutFile;
    const coordination = hooks.runExclusive
      ? { mode: hooks.coordinationMode || "custom", run: hooks.runExclusive }
      : createOriginLockRunner(global);
    const ensureQuota =
      typeof hooks.ensureQuota === "function"
        ? hooks.ensureQuota
        : function () {
            return Promise.resolve();
          };
    let tail = Promise.resolve();
    let queued = 0;
    let running = null;
    let completed = 0;
    let originalTar = null;
    let resetRemuxQueue = null;
    function state() {
      return {
        queued,
        running: running ? running.kind : null,
        completed,
        coordination: coordination.mode,
      };
    }
    function settle(holder) {
      if (!holder || holder.settled) return;
      holder.settled = true;
      if (running === holder) running = null;
    }
    function enqueue(kind, task, options) {
      options = options || {};
      const previous = tail;
      let releaseTail = null;
      let tailReleased = false;
      tail = new Promise((resolve) => {
        releaseTail = function () {
          if (tailReleased) return;
          tailReleased = true;
          resolve();
        };
      });
      if (notifyWaiter && (queued > 0 || running)) {
        notifyWaiter(kind, state());
      }
      queued += 1;
      let resolveCancellation = null;
      const abortController =
        typeof AbortController === "function" ? new AbortController() : null;
      const cancellationPromise = new Promise((resolve) => {
        resolveCancellation = resolve;
      });
      const holder = {
        kind,
        taskSettled: false,
        encodeSettled: false,
        cancelled: false,
        settled: false,
        releaseTail,
        cancel: function () {
          if (holder.cancelled || holder.taskSettled) return;
          holder.cancelled = true;
          if (abortController) abortController.abort();
          resolveCancellation(CANCELLED);
        },
      };
      const cancellation = {
        promise: cancellationPromise,
        signal: abortController && abortController.signal,
        isCancelled: function () {
          return holder.cancelled;
        },
      };
      const start = function () {
        queued -= 1;
        running = holder;
        const guardedTask = function () {
          if (holder.cancelled) return CANCELLED;
          let taskResult;
          try {
            taskResult = task(holder);
          } catch (error) {
            holder.taskSettled = true;
            throw error;
          }
          return Promise.resolve(taskResult).then(
            (value) => {
              holder.taskSettled = true;
              return value;
            },
            (error) => {
              holder.taskSettled = true;
              throw error;
            },
          );
        };
        const operation =
          options.crossTab === false
            ? Promise.race([guardedTask(), cancellationPromise])
            : coordination.run(kind, guardedTask, cancellation);
        return Promise.resolve(operation).then(
          (value) => {
            holder.releaseTail();
            settle(holder);
            if (value === CANCELLED) return new Promise(function () {});
            completed += 1;
            return value;
          },
          (error) => {
            holder.releaseTail();
            settle(holder);
            throw error;
          },
        );
      };
      return previous.then(start, start);
    }
    function releaseEncodeHolder() {
      const holder = running;
      if (!holder || holder.kind !== "encode" || holder.settled) return;
      holder.releaseTail();
      setTimeout(function () {
        if (!holder.encodeSettled) holder.cancel();
      }, 0);
    }
    function wrapEncode(original, profiles) {
      if (typeof original !== "function" || original[PATCH_MARKER]) {
        return original;
      }
      const wrapped = function zoidiumSerializedEncode() {
        const receiver = this;
        const args = Array.prototype.slice.call(arguments);
        return enqueue("encode", async function (holder) {
          await ensureQuota(estimateVideoStorageBytes(args[1], profiles));
          let blob;
          try {
            blob = await original.apply(receiver, args);
          } finally {
            holder.encodeSettled = true;
          }
          return assertBlobPrefix(
            await detachFileBackedBlob(blob, "The rendered video"),
            [0x1a, 0x45, 0xdf, 0xa3],
            "Video",
          );
        });
      };
      wrapped[PATCH_MARKER] = true;
      wrapped[ORIGINAL_MARKER] = original;
      return wrapped;
    }
    function wrapImageEncode(original) {
      if (typeof original !== "function" || original[PATCH_MARKER]) {
        return original;
      }
      const wrapped = function zoidiumSerializedImageEncode() {
        const receiver = this;
        const args = Array.prototype.slice.call(arguments);
        return enqueue(
          "image",
          () => original.apply(receiver, args),
          { crossTab: false },
        );
      };
      wrapped[PATCH_MARKER] = true;
      wrapped[ORIGINAL_MARKER] = original;
      return wrapped;
    }
    async function runTar(original, receiver, args) {
      await ensureQuota(estimateArchiveStorageBytes(receiver && receiver.files));
      const blob = await original.apply(receiver, args || []);
      return assertBlobPrefix(
        await detachFileBackedBlob(blob, "The project archive"),
        [0x1f, 0x8b],
        "Project archive",
      );
    }
    function tarWithoutLock(receiver, args) {
      if (typeof originalTar !== "function") {
        return Promise.reject(new Error("The project archive writer is unavailable."));
      }
      return runTar(originalTar, receiver, args);
    }
    function wrapTar(original) {
      if (typeof original !== "function") return original;
      if (original[PATCH_MARKER]) {
        if (!originalTar) originalTar = original[ORIGINAL_MARKER];
        return original;
      }
      if (!originalTar) originalTar = original;
      const wrapped = function zoidiumSerializedTar() {
        const receiver = this;
        const args = Array.prototype.slice.call(arguments);
        return enqueue("archive", () => runTar(original, receiver, args));
      };
      wrapped[PATCH_MARKER] = true;
      wrapped[ORIGINAL_MARKER] = original;
      return wrapped;
    }
    function wrapStop(original) {
      if (typeof original !== "function" || original[PATCH_MARKER]) {
        return original;
      }
      const wrapped = function zoidiumStopWithIoRelease() {
        try {
          return original.apply(this, arguments);
        } finally {
          if (resetRemuxQueue) resetRemuxQueue();
          releaseEncodeHolder();
        }
      };
      wrapped[PATCH_MARKER] = true;
      wrapped[ORIGINAL_MARKER] = original;
      return wrapped;
    }
    function wrapCleanUp(original) {
      if (typeof original === "function" && original[PATCH_MARKER]) {
        return original;
      }
      const wrapped = function zoidiumSerializedCleanUp() {
        return enqueue("cleanup", () => deleteOutFile());
      };
      wrapped[PATCH_MARKER] = true;
      wrapped[ORIGINAL_MARKER] = original;
      return wrapped;
    }
    function wrapRemux(original) {
      if (typeof original !== "function" || original[PATCH_MARKER]) {
        return original;
      }
      let remuxTail = Promise.resolve();
      resetRemuxQueue = function () {
        remuxTail = Promise.resolve();
      };
      const wrapped = function zoidiumSerializedRemux() {
        const receiver = this;
        const args = Array.prototype.slice.call(arguments);
        const result = remuxTail.then(() => original.apply(receiver, args));
        remuxTail = result.catch(function () {});
        return result;
      };
      wrapped[PATCH_MARKER] = true;
      wrapped[ORIGINAL_MARKER] = original;
      return wrapped;
    }
    function wrapQuota(original) {
      if (typeof original === "function" && original[PATCH_MARKER]) {
        return original;
      }
      const wrapped = function zoidiumCheckedQuota(bytes) {
        return ensureQuota(bytes || MINIMUM_WORKSPACE_BYTES);
      };
      wrapped[PATCH_MARKER] = true;
      wrapped[ORIGINAL_MARKER] = original;
      return wrapped;
    }
    return {
      enqueue,
      releaseEncodeHolder,
      state,
      tarWithoutLock,
      wrapCleanUp,
      wrapEncode,
      wrapImageEncode,
      wrapQuota,
      wrapRemux,
      wrapStop,
      wrapTar,
    };
  }
  function defaultDeleteOutFile() {
    return new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        resolve();
      };
      try {
        if (typeof webkitRequestFileSystem !== "function") {
          finish();
          return;
        }
        webkitRequestFileSystem(
          PERSISTENT,
          0,
          (fs) => {
            try {
              fs.root.getFile(
                "out",
                null,
                (entry) => {
                  try {
                    entry.remove(finish, finish);
                  } catch (_error) {
                    finish();
                  }
                },
                finish,
              );
            } catch (_error) {
              finish();
            }
          },
          finish,
        );
        setTimeout(finish, CLEANUP_TIMEOUT_MS);
      } catch (_error) {
        finish();
      }
    });
  }
  function notifyWaiter(kind, snapshot) {
    try {
      if (typeof console !== "undefined" && console.warn) {
        console.warn(
          "Zoidium: waiting for the " +
            (snapshot.running || "previous") +
            " file operation to finish before starting " +
            kind +
            ".",
        );
      }
    } catch (_error) {
    }
    try {
      if (
        global &&
        typeof global.dispatchEvent === "function" &&
        typeof CustomEvent === "function"
      ) {
        global.dispatchEvent(
          new CustomEvent("zoidium:io-waiting", {
            detail: { kind, snapshot },
          }),
        );
      }
    } catch (_error) {
    }
  }
  function install(targets) {
    if (
      !targets ||
      !targets.av ||
      !targets.archive ||
      !targets.file ||
      !targets.imageEncoder
    ) {
      return false;
    }
    if (
      typeof targets.av.encode !== "function" ||
      typeof targets.av.stop !== "function" ||
      typeof targets.av.remux !== "function" ||
      typeof targets.archive.tar !== "function" ||
      typeof targets.file.cleanUp !== "function" ||
      typeof targets.imageEncoder.encode !== "function"
    ) {
      return false;
    }
    let api = targets.PZ && targets.PZ[DIAGNOSTICS_KEY];
    const existingSerializer = api && api._serializer;
    const originalQuota = targets.file.getQuota;
    const serializer =
      targets.serializer ||
      existingSerializer ||
      createIoSerializer({
        notifyWaiter,
        ensureQuota: function (bytes) {
          return requestPersistentQuota(
            global,
            bytes,
            typeof originalQuota === "function"
              ? originalQuota.bind(targets.file)
              : null,
          );
        },
      });
    targets.av.encode = serializer.wrapEncode(
      targets.av.encode,
      targets.av.profiles,
    );
    targets.av.remux = serializer.wrapRemux(targets.av.remux);
    targets.av.stop = serializer.wrapStop(targets.av.stop);
    targets.archive.tar = serializer.wrapTar(targets.archive.tar);
    targets.file.cleanUp = serializer.wrapCleanUp(targets.file.cleanUp);
    targets.file.getQuota = serializer.wrapQuota(targets.file.getQuota);
    targets.imageEncoder.encode = serializer.wrapImageEncode(
      targets.imageEncoder.encode,
    );
    try {
      if (targets.PZ && !existingSerializer) {
        api = {
          _serializer: serializer,
          detachBlob: detachFileBackedBlob,
          run: serializer.enqueue,
          state: serializer.state,
          tarWithoutLock: serializer.tarWithoutLock,
        };
        targets.PZ[DIAGNOSTICS_KEY] = api;
      }
    } catch (_error) {
    }
    return true;
  }
  function installWithRetry(attempt) {
    if (!global) return;
    attempt = attempt || 1;
    const PZ = global.PZ;
    const ready =
      PZ &&
      install({
        PZ,
        archive: PZ.archive && PZ.archive.prototype,
        av: PZ.av,
        file: PZ.file,
        imageEncoder: PZ.imageEncoder,
      });
    if (ready || attempt >= MAX_ATTEMPTS) {
      if (!ready) {
        try {
          if (typeof console !== "undefined" && console.warn) {
            console.warn(
              "Zoidium: export serialization is unavailable. Do not render and save at the same time.",
            );
          }
        } catch (_error) {
        }
      }
      return;
    }
    setTimeout(() => installWithRetry(attempt + 1), RETRY_DELAY_MS);
  }
  if (typeof module === "object" && module.exports) {
    module.exports = {
      ARCHIVE_HEADROOM_BYTES,
      CLEANUP_TIMEOUT_MS,
      CROSS_TAB_LOCK_NAME,
      MAX_ATTEMPTS,
      MINIMUM_WORKSPACE_BYTES,
      RETRY_DELAY_MS,
      createIoSerializer,
      createOriginLockRunner,
      createWebLockRunner,
      detachFileBackedBlob,
      estimateArchiveStorageBytes,
      estimateVideoStorageBytes,
      install,
      isFileBackedBlob,
      requestPersistentQuota,
    };
    return;
  }
  installWithRetry(1);
})(typeof window !== "undefined" ? window : null);
