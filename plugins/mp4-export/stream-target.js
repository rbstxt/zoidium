"use strict";

// Fragmented MP4 writes monotonically. OPFS bounds page memory; the fallback
// retains Blob chunks without constructing a second contiguous movie buffer.
async function createStorage(scope, bunny) {
  let directory, name, file, writer;
  const parts = [];
  let position = 0;
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
      if (chunk.position !== position) throw new Error("The MP4 writer produced an invalid file offset.");
      if (writer) await writer.write(chunk.data);
      else parts.push(new Blob([chunk.data]));
      position += chunk.data.byteLength;
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
      if (!position) throw new Error("The MP4 export is empty.");
      if (!file) return new Blob(parts, { type: "video/mp4" });
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

module.exports = { createStorage };
