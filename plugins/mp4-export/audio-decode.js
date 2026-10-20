"use strict";

const { isMemoryError } = require("./export-math.js");

// Match CM3's existing decoder fallback without borrowing its active encode
// worker or touching its shared output file. This worker decodes audio only.
async function decodeWithWorker(scope, context, file, signal) {
  const bytes = await file.arrayBuffer();
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    let worker = null;
    let timer = null;
    let finished = false;
    function finish(error, buffer) {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      if (worker) {
        worker.onmessage = worker.onerror = null;
        worker.terminate();
      }
      if (error) reject(error);
      else resolve(buffer);
    }
    function abort() { finish(new DOMException("MP4 export cancelled.", "AbortError")); }
    try {
      if (signal?.aborted) { abort(); return; }
      worker = new scope.Worker("worker/av.js");
      signal?.addEventListener("abort", abort, { once: true });
      timer = setTimeout(() => finish(new Error("Audio decoding timed out.")), 30000);
      worker.onerror = (error) => finish(isMemoryError(error)
        ? new RangeError("Audio decoder memory allocation failed.")
        : new Error("The audio decoder failed."));
      worker.onmessage = (event) => {
        const message = event.data;
        if (message.type === "ready") {
          worker.postMessage({ type: "command", options: { decode: true }, files: [{ name: "input", data: bytes }] }, [bytes]);
        } else if (message.type === "error") {
          finish(isMemoryError(new Error(message.data))
            ? new RangeError("Audio decoder memory allocation failed.")
            : new Error("The audio asset could not be decoded."));
        } else if (message.type === "done") {
          try {
            const left = new Float32Array(message.data[0].data);
            const right = new Float32Array(message.data[1].data);
            if (!left.length || left.length !== right.length) throw new Error("The decoded audio is empty.");
            const buffer = context.createBuffer(2, left.length, 48000);
            buffer.copyToChannel(left, 0);
            buffer.copyToChannel(right, 1);
            finish(null, buffer);
          } catch (error) { finish(error); }
        }
      };
    } catch (error) { finish(error); }
  });
}

async function decodeAudio(scope, context, file, signal) {
  try {
    const buffer = await context.decodeAudioData(await file.arrayBuffer());
    signal?.throwIfAborted();
    return buffer;
  } catch (error) {
    signal?.throwIfAborted();
    if (isMemoryError(error)) throw error;
    try {
      return await decodeWithWorker(scope, context, file, signal);
    } catch (failure) {
      signal?.throwIfAborted();
      if (isMemoryError(failure)) throw failure;
      throw new Error("MP4 could not decode an audio asset. Convert the asset to WAV and try again, or use MKV/WebM.", { cause: failure });
    }
  }
}

module.exports = { decodeAudio, decodeWithWorker };
