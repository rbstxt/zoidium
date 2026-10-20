"use strict";

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

// OPFS bounds page memory. The fallback retains immutable Blob chunks and
// supports header rewrites without constructing a contiguous movie buffer.
async function createStorage(scope, bunny) {
  let directory, name, file, writer;
  let parts = [];
  let length = 0;
  let closed = false;
  try {
    if (scope.navigator.storage?.getDirectory) {
      directory = await scope.navigator.storage.getDirectory();
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
      return new Response((await file.getFile()).stream(), {
        headers: { "Content-Type": "video/mp4" },
      }).blob();
    },
    async dispose() {
      if (writer && !closed) { closed = true; await writer.abort().catch(() => {}); }
      if (directory && name) await directory.removeEntry(name).catch(() => {});
      parts.length = 0;
    },
  };
}

module.exports = { createStorage, replaceChunks };
