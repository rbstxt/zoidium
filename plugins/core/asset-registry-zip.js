(function (global) {
  "use strict";
  const parts = global.ZoidiumAssetRegistryParts = global.ZoidiumAssetRegistryParts || {};
  // A minimal ZIP writer for Collect Files. Entries are stored without
  // compression (footage is already compressed) and the output Blob reuses
  // the source Blobs, so only a CRC pass reads the bytes. A fixed timestamp
  // (1980-01-01) keeps archives of the same files identical.
  const CHUNK = 16 * 1024 * 1024;
  const LIMIT = 0xffffffff;
  const DOS_DATE = (1 << 5) | 1;
  let table = null;

  function crcTable() {
    if (table) return table;
    table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
    return table;
  }
  function crc32(bytes, crc = 0) {
    const t = crcTable();
    let c = (crc ^ 0xffffffff) >>> 0;
    for (let i = 0; i < bytes.length; i++) c = t[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }
  async function crcOfBlob(blob) {
    let crc = 0;
    for (let offset = 0; offset < blob.size; offset += CHUNK) {
      crc = crc32(new Uint8Array(await blob.slice(offset, offset + CHUNK).arrayBuffer()), crc);
    }
    return crc;
  }
  function header(signature, fields, name) {
    const size = fields.reduce((sum, [bytes]) => sum + bytes, 4);
    const buffer = new ArrayBuffer(size + name.length), view = new DataView(buffer);
    view.setUint32(0, signature, true);
    let offset = 4;
    for (const [bytes, value] of fields) {
      if (bytes === 2) view.setUint16(offset, value, true); else view.setUint32(offset, value >>> 0, true);
      offset += bytes;
    }
    new Uint8Array(buffer, size).set(name);
    return new Uint8Array(buffer);
  }

  // `entries`: [{ path, blob }] for files and [{ path }] (ending in "/") for
  // folders. Returns a Blob of type application/zip.
  async function create(entries) {
    if (entries.length >= 0xffff) throw new Error("Too many files for one archive.");
    const encoder = new global.TextEncoder(), chunks = [], central = [];
    let offset = 0;
    for (const entry of entries) {
      const name = encoder.encode(entry.path), folder = entry.path.endsWith("/");
      const blob = folder ? null : entry.blob;
      const size = blob ? blob.size : 0, crc = blob ? await crcOfBlob(blob) : 0;
      if (size > LIMIT || offset > LIMIT) throw new Error("The collected files are larger than 4 GB.");
      const common = [[2, 20], [2, 0x0800], [2, 0], [2, 0], [2, DOS_DATE], [4, crc], [4, size], [4, size], [2, name.length], [2, 0]];
      const local = header(0x04034b50, common, name);
      chunks.push(local);
      if (blob) chunks.push(blob);
      central.push(header(0x02014b50, [[2, 20], ...common, [2, 0], [2, 0], [2, 0], [4, folder ? 0x10 : 0], [4, offset]], name));
      offset += local.length + size;
    }
    const directorySize = central.reduce((sum, chunk) => sum + chunk.length, 0);
    if (offset + directorySize > LIMIT) throw new Error("The collected files are larger than 4 GB.");
    const end = header(0x06054b50, [[2, 0], [2, 0], [2, entries.length], [2, entries.length],
      [4, directorySize], [4, offset], [2, 0]], new Uint8Array(0));
    return new global.Blob([...chunks, ...central, end], { type: "application/zip" });
  }
  parts.zip = { crc32, create };
})(globalThis);
