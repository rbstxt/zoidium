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

// The stream copy flattens every read error into "TypeError: Failed to fetch".
// One byte from the same snapshot keeps the specific DOMException without
// allocating the export a second time.
const NOT_READABLE_HINT = " The temporary file was changed or locked by another program " +
  "(for example antivirus or a disk indexer).";
const NOT_FOUND_HINT = " The temporary file was removed.";

// Peak-constrained VBR treats the requested bitrate as a mean target, not a
// floor. A driver that ignores it, a slow preset, or simple frames can land far
// below it, and nothing in the API reports the value that was used. The target
// sees every written byte, so the average is checked once at the end.
const LOW_BITRATE_RATIO = 0.35;

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

function readbackHint(cause) {
  if (!cause) return "";
  if (cause.name === "NotReadableError") return NOT_READABLE_HINT;
  if (cause.name === "NotFoundError") return NOT_FOUND_HINT;
  return "";
}

function readbackFailure(cause) {
  return new Error(READBACK_FAILURE + readbackHint(cause), { cause });
}

async function probeCause(snapshot) {
  try {
    if (!snapshot || typeof snapshot.slice !== "function") return null;
    const head = snapshot.slice(0, 1);
    if (!head || typeof head.arrayBuffer !== "function") return null;
    await head.arrayBuffer();
    return null;
  } catch (error) {
    return error || null;
  }
}

function formatRate(bits) {
  if (!(bits > 0)) return "0 Mbps";
  const unit = bits >= 1e6 ? [1e5, "Mbps"] : [1e2, "kbps"];
  const value = Math.round(bits / unit[0]) / 10;
  return (Number.isInteger(value) ? value : value.toFixed(1)) + " " + unit[1];
}

// The target receives the whole muxed file. Without an audio track every byte
// is video, so bytes * 8 / duration is the achieved video rate. With audio the
// tracks cannot be separated here, and the check would credit the video with
// the audio bytes; it stays silent instead of reporting a wrong number.
function warnLowBitrate(bytes, options) {
  if (!options || options.hasAudio) return;
  const requested = Number(options.videoBitrate);
  const duration = Number(options.duration);
  if (!(requested > 0) || !(duration > 0) || !(bytes > 0)) return;
  const achieved = bytes * 8 / duration;
  if (achieved >= requested * LOW_BITRATE_RATIO) return;
  console.warn("[Zoidium] The encoder produced " + formatRate(achieved) + " of the " +
    formatRate(requested) + " requested for this MP4 export. A slow speed preset or " +
    "simple frames can stay below the target.");
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
// A copy whose length differs from the written length is a failed attempt, not
// a success: a short read would otherwise download a broken movie. When every
// attempt fails, the read error names the small set of remaining causes instead
// of the raw "Failed to fetch".
async function readBack(scope, file, name, length, options) {
  const delays = options && Array.isArray(options.delays) ? options.delays : READBACK_DELAYS;
  const signal = options && options.signal;
  const ResponseCtor = scope.Response || (typeof Response === "function" ? Response : null);
  let cause = null;
  for (let index = 0; index < delays.length; index++) {
    const attempt = index + 1;
    await wait(delays[index], signal);
    let snapshot = null;
    try {
      if (!ResponseCtor) throw new Error("This browser cannot copy the finished file.");
      // A fresh snapshot per attempt: status, size, and modification state can
      // change between attempts, and an old File handle keeps the first error.
      snapshot = await file.getFile();
      const copy = await new ResponseCtor(snapshot.stream(), {
        headers: { "Content-Type": "video/mp4" },
      }).blob();
      if (!copy || copy.size !== length) {
        throw new Error("The copied MP4 was " + (copy ? copy.size : 0) +
          " bytes instead of " + length + ".");
      }
      return { blob: copy, retained: false };
    } catch (error) {
      // A cancelled export reports the abort, not a read failure.
      if (signal && signal.aborted) throw cancelledError();
      // Quota and allocation failures keep their own message upstream.
      if (isMemoryError(error)) throw error;
      cause = error;
      if (snapshot && cause.name === "TypeError") {
        const probed = await probeCause(snapshot);
        if (probed) cause = probed;
      }
      console.warn("[Zoidium] MP4 output read-back failed (attempt " + attempt + "): " + describeError(cause));
    }
  }
  // Every copy failed. The temporary file can still be downloaded when it is
  // complete and readable: the wrapper references it instead of copying its
  // bytes, and dispose() keeps the entry readable until the next export or
  // page unload. A zero-length or shorter snapshot would arrive as an empty or
  // broken download, so it is never offered.
  try {
    const snapshot = await file.getFile();
    if (!snapshot || snapshot.size === 0 || snapshot.size !== length) {
      cause = new Error("The temporary file is " + (snapshot ? snapshot.size : 0) +
        " bytes instead of " + length + ".");
    } else {
      const probed = await probeCause(snapshot);
      if (probed) cause = probed;
      else {
        retainedNames.add(name);
        return { blob: new Blob([snapshot], { type: "video/mp4" }), retained: true };
      }
    }
  } catch (error) {
    if (isMemoryError(error)) throw error;
    cause = error;
  }
  throw readbackFailure(cause);
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
      warnLowBitrate(length, options);
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
