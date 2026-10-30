"use strict";
function metadata(bytes) {
  const v = new DataView(bytes), tag = offset => String.fromCharCode(...new Uint8Array(bytes, offset, 4));
  const tables = new Map();
  for (let i = 0; i < v.getUint16(4); i++) {
    const at = 12 + i * 16, offset = v.getUint32(at + 8), length = v.getUint32(at + 12);
    if (offset + length > bytes.byteLength) throw Error("Invalid font table bounds");
    tables.set(tag(at), { offset, length });
  }
  const names = new Map(), table = tables.get("name");
  if (table) {
    const at = table.offset, count = v.getUint16(at + 2), start = at + v.getUint16(at + 4);
    for (let i = 0; i < count; i++) {
      const record = at + 6 + i * 12;
      if (record + 12 > at + table.length) throw Error("Invalid font name record");
      const platform = v.getUint16(record), language = v.getUint16(record + 4), id = v.getUint16(record + 6);
      const length = v.getUint16(record + 8), offset = start + v.getUint16(record + 10);
      if (offset + length > at + table.length) throw Error("Invalid font name bounds");
      if (platform !== 0 && platform !== 3) continue;
      let text = "";
      for (let j = 0; j + 1 < length; j += 2) text += String.fromCharCode(v.getUint16(offset + j));
      if (!names.has(id) || language === 0x409) names.set(id, text);
    }
  }
  const axes = [], instances = [], fvar = tables.get("fvar");
  if (fvar) {
    const at = fvar.offset, first = at + v.getUint16(at + 4), count = v.getUint16(at + 8), size = v.getUint16(at + 10);
    const instanceCount = v.getUint16(at + 12), instanceSize = v.getUint16(at + 14);
    if (count > 64 || size < 20 || instanceSize < 4 + count * 4 || first + count * size + instanceCount * instanceSize > at + fvar.length) throw Error("Invalid font variation records");
    for (let i = 0; i < count; i++) {
      const p = first + i * size;
      axes.push({ tag: tag(p), min: v.getInt32(p + 4) / 65536, default: v.getInt32(p + 8) / 65536,
        max: v.getInt32(p + 12) / 65536, name: names.get(v.getUint16(p + 18)) || tag(p) });
    }
    for (let i = 0; i < instanceCount; i++) {
      const p = first + count * size + i * instanceSize;
      instances.push({ name: names.get(v.getUint16(p)) || "Style " + (i + 1),
        coordinates: Object.fromEntries(axes.map((axis, j) => [axis.tag, v.getInt32(p + 4 + j * 4) / 65536])) });
    }
  }
  return { family: names.get(16) || names.get(1) || "Unnamed font", style: names.get(17) || names.get(2) || "Regular", axes, instances };
}
async function decompress(bytes) {
  const v = new DataView(bytes), magic = v.getUint32(0);
  if (magic === 0x774f4632) throw Error("Unsupported font format: WOFF2. Choose a TTF or OTF font.");
  if (magic !== 0x774f4646) return bytes;
  if (bytes.byteLength < 44) throw Error("Invalid WOFF font header");
  const count = v.getUint16(12), size = v.getUint32(16);
  if (!count || count > 256 || size > 32 * 1024 * 1024 || 44 + 20 * count > bytes.byteLength) throw Error("Invalid WOFF font size");
  const output = new ArrayBuffer(size), out = new DataView(output);
  out.setUint32(0, v.getUint32(4)); out.setUint16(4, count);
  const power = 2 ** Math.floor(Math.log2(count));
  out.setUint16(6, power * 16); out.setUint16(8, Math.log2(power)); out.setUint16(10, count * 16 - power * 16);
  let next = 12 + count * 16;
  for (let i = 0; i < count; i++) {
    const at = 44 + i * 20, offset = v.getUint32(at + 4), compressed = v.getUint32(at + 8), length = v.getUint32(at + 12);
    if (compressed > length || offset + compressed > bytes.byteLength || next + length > size) throw Error("Invalid WOFF font table");
    let data = new Uint8Array(bytes, offset, compressed);
    if (compressed < length) data = new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate"))).arrayBuffer());
    if (data.byteLength !== length) throw Error("Invalid WOFF decompressed size");
    const record = 12 + i * 16;
    out.setUint32(record, v.getUint32(at)); out.setUint32(record + 4, v.getUint32(at + 16));
    out.setUint32(record + 8, next); out.setUint32(record + 12, length);
    new Uint8Array(output, next, length).set(data); next += (length + 3) & ~3;
  }
  return output;
}
module.exports = { metadata, decompress };
