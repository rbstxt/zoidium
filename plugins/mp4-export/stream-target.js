"use strict";

const { isMemoryError } = require("./export-math.js");

// The finished movie lives in an origin-private file until the download takes
// it. Chromium reports every read error while that file is copied as
// "TypeError: Failed to fetch", and the read can fail right after the writer
// closes it (a virus scanner or indexer still holds it) or when Blob storage
// refuses a second full copy of a large export. Each attempt therefore takes a
// fresh snapshot: a File remembered before the failure stays unreadable.
// The first delay is zero, so a healthy export keeps its single snapshot and
// its single copy. The whole schedule stays under five seconds.
const READBACK_DELAYS = [0, 250, 1000, 3000];

const READBACK_FAILURE = "MP4 was encoded, but the browser could not read the finished file from " +
  "temporary storage. Free some disk space and try again, or use MKV/WebM.";

// Names this page keeps because a download still points at the file. Only these
// names may be removed later: another tab can be writing its own temporary file
// at the same time, so sweeping the "zoidium-mp4-" prefix would delete a live
// export and cause this very failure.
const retainedNames = new Set();
const watchedScopes = new WeakSet();

function replaceChunks(parts, blob, start) {
  const end = start + blob.size;
  const next = [];
  for (const part of parts) {
    const partEnd = part.start + part.blob.size;
    if (partEnd <= start || part.start >= end) next.push(part);
    else {
      if (part.start < start) next.push({ start: part.start, blob: part.blob.slice(0, start - part.start) });
      if (partEnd > end) next.push({ start: end, blob: part.blob.slice(end - part.start) });
    }
  }
  next.push({ start, blob });
  return next.sort((a, b) => a.start - b.start);
}

function cancelledError() {
  return new DOMException("MP4 export cancelled.", "AbortError");
}

function describeError(error) {
  return (error && error.name ? error.name : "Error") + ": " +
    (error && error.message ? error.message : String(error));
}

// Cancellation must win over a retry schedule: a cancel during any wait stops
// the read-back at once instead of holding the export page for seconds.
function wait(ms, signal) {
  if (signal && signal.aborted) throw cancelledError();
  if (!(ms > 0)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    let timer = null;
    function settle() {
      if (signal && typeof signal.removeEventListener === "function") {
        signal.removeEventListener("abort", abort);
      }
      resolve();
    }
    function abort() {
      if (timer !== null) clearTimeout(timer);
      if (signal && typeof signal.removeEventListener === "function") {
        signal.removeEventListener("abort", abort);
      }
      reject(cancelledError());
    }
    timer = setTimeout(settle, ms);
    if (signal && typeof signal.addEventListener === "function") {
      signal.addEventListener("abort", abort, { once: true });
    }
  });
}

// Remove only entries this page kept for earlier downloads. A missing entry is
// forgotten; any other failure stays in the set for the next export or unload.
async function removeRetained(directory) {
  if (!retainedNames.size) return;
  for (const name of Array.from(retainedNames)) {
    try {
      await directory.removeEntry(name);
      retainedNames.delete(name);
    } catch (error) {
      if (error && error.name === "NotFoundError") retainedNames.delete(name);
    }
  }
}

async function removeRetainedInScope(scope) {
  if (!retainedNames.size) return;
  if (!scope.navigator || !scope.navigator.storage || !scope.navigator.storage.getDirectory) return;
  try {
    await removeRetained(await scope.navigator.storage.getDirectory());
  } catch (_error) {
    // The page is unloading; the next export or the browser's own cleanup runs.
  }
}

function watchUnload(scope) {
  if (!scope || typeof scope.addEventListener !== "function" || watchedScopes.has(scope)) return;
  watchedScopes.add(scope);
  scope.addEventListener("pagehide", () => { removeRetainedInScope(scope).catch(() => {}); });
}

// Copy the finished file into page Blob storage. The copy is what makes the
// download independent of the temporary file, so it stays the normal result.
// When every attempt fails, the read error names the small set of remaining
// causes instead of the raw "Failed to fetch".
async function readBack(scope, file, name, length, options) {
  const delays = options && Array.isArray(options.delays) ? options.delays : READBACK_DELAYS;
  const signal = options && options.signal;
  const ResponseCtor = scope.Response || (typeof Response === "function" ? Response : null);
  let cause = null;
  for (let index = 0; index < delays.length; index++) {
    const attempt = index + 1;
    await wait(delays[index], signal);
    try {
      if (!ResponseCtor) throw new Error("This browser cannot copy the finished file.");
      // A fresh snapshot per attempt: status, size, and modification state can
      // change between attempts, and an old File handle keeps the first error.
      const snapshot = await file.getFile();
      const copy = await new ResponseCtor(snapshot.stream(), {
        headers: { "Content-Type": "video/mp4" },
      }).blob();
      return { blob: copy, retained: false };
    } catch (error) {
      // A cancelled export reports the abort, not a read failure.
      if (signal && signal.aborted) throw cancelledError();
      // Quota and allocation failures keep their own message upstream.
      if (isMemoryError(error)) throw error;
      cause = error;
      console.warn("[Zoidium] MP4 output read-back failed (attempt " + attempt + "): " + describeError(error));
    }
  }
  // Every copy failed. The temporary file can still be downloaded when it is
  // complete: the wrapper references it instead of copying its bytes, and
  // dispose() keeps the entry readable until the next export or page unload.
  try {
    const snapshot = await file.getFile();
    if (snapshot && snapshot.size === length) {
      const download = new Blob([snapshot], { type: "video/mp4" });
      retainedNames.add(name);
      return { blob: download, retained: true };
    }
  } catch (error) {
    if (isMemoryError(error)) throw error;
    cause = error;
  }
  throw new Error(READBACK_FAILURE, { cause });
}

// OPFS bounds page memory. The fallback retains immutable Blob chunks and
// supports header rewrites without constructing a contiguous movie buffer.
async function createStorage(scope, bunny, options) {
  let directory, name, file, writer;
  let parts = [];
  let length = 0;
  let closed = false;
  let kept = false;
  watchUnload(scope);
  try {
    if (scope.navigator.storage?.getDirectory) {
      directory = await scope.navigator.storage.getDirectory();
      await removeRetained(directory);
      name = "zoidium-mp4-" + scope.crypto.randomUUID();
      file = await directory.getFileHandle(name, { create: true });
      writer = await file.createWritable();
    }
  } catch (_error) {
    if (directory && name) await directory.removeEntry(name).catch(() => {});
    directory = file = writer = null;
  }
  const stream = new WritableStream({
    async write(chunk) {
      if (chunk.position < 0 || chunk.position > length) throw new Error("The MP4 writer produced an invalid file offset.");
      if (writer) await writer.write({ type: "write", position: chunk.position, data: chunk.data });
      else parts = replaceChunks(parts, new Blob([chunk.data]), chunk.position);
      length = Math.max(length, chunk.position + chunk.data.byteLength);
    },
    async close() {
      if (writer && !closed) { closed = true; await writer.close(); }
    },
    async abort() {
      if (writer && !closed) { closed = true; await writer.abort(); }
    },
  });
  return {
    target: new bunny.StreamTarget(stream, { chunked: true, chunkSize: 1024 * 1024 }),
    async finish() {
      if (!length) throw new Error("The MP4 export is empty.");
      if (!file) return new Blob(parts.map((part) => part.blob), { type: "video/mp4" });
      // Detach from our temporary file once, using browser Blob storage. The
      // normal download manager then receives a stable Blob, not a live File.
      const read = await readBack(scope, file, name, length, options);
      kept = read.retained;
      return read.blob;
    },
    async dispose() {
      if (writer && !closed) { closed = true; await writer.abort().catch(() => {}); }
      // A retained file backs the download that replaced the failed copy, so
      // removing it here would make that download unreadable.
      if (directory && name && !kept) await directory.removeEntry(name).catch(() => {});
      parts.length = 0;
    },
  };
}

module.exports = { createStorage, replaceChunks };
