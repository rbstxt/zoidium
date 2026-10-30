"use strict";

// No WASM compilation or font I/O until load() is called. The owner supplies
// bytes through its bundle asset API, never a URL into the plugin source tree.
function createLoader(getAsset, loadModule = require) {
  let pending;
  return function load() {
    if (!pending) pending = (async () => {
      const encoded = getAsset("text", "./plugins/shape-plus/vendor/harfbuzz.wasm.base64");
      if (typeof encoded !== "string") throw new Error("The Shape+ text engine is missing from the bundle.");
      const binary = Uint8Array.from(atob(encoded.trim()), char => char.charCodeAt(0));
      const createHarfBuzz = loadModule("./vendor/harfbuzz.js");
      const api = loadModule("./vendor/harfbuzz-api.js");
      const module = await createHarfBuzz({ wasmBinary: binary });
      return createEngine(api(module), () => module.HEAPU8.buffer.byteLength);
    })().catch(error => { pending = null; throw error; });
    return pending;
  };
}

function createEngine(hb, memoryBytes = () => 0, maxOutlineBytes = 4 * 1024 * 1024) {
  const outlines = new Map();
  let cachedBytes = 0, nextFont = 0;
  function drop(key) {
    cachedBytes -= outlines.get(key).bytes;
    outlines.delete(key);
  }
  function open(bytes, reference) {
    if (!(bytes instanceof ArrayBuffer) || bytes.byteLength < 12) throw new Error("The font file is invalid.");
    const magic = new DataView(bytes).getUint32(0);
    if (magic === 0x774f4646 || magic === 0x774f4632) throw new Error("Shape+ text requires an uncompressed OpenType font.");
    if (magic !== 0x00010000 && magic !== 0x4f54544f) throw new Error("The font format is not supported by Shape+ text.");
    const view = new DataView(bytes), count = view.getUint16(4);
    if (12 + count * 16 > bytes.byteLength) throw new Error("The font table directory is invalid.");
    let hasHead = false;
    for (let i = 0; i < count; i++) {
      const pos = 12 + i * 16, offset = view.getUint32(pos + 8), length = view.getUint32(pos + 12);
      if (offset + length > bytes.byteLength) throw new Error("A font table is outside the file.");
      if (view.getUint32(pos) === 0x68656164 && length >= 54) hasHead = true;
    }
    if (!hasHead) throw new Error("The font has no valid OpenType header.");
    const blob = hb.createBlob(bytes), face = hb.createFace(blob, 0), font = hb.createFont(face);
    const id = ++nextFont, axes = face.getAxisInfos();
    let disposed = false;
    function live() { if (disposed) throw new Error("The Shape+ text font has been released."); }
    function coordinates(values = {}) {
      const coords = {};
      for (const tag of Object.keys(axes).sort()) {
        const axis = axes[tag], value = Number(values[tag] ?? axis.default);
        coords[tag] = Math.min(axis.max, Math.max(axis.min, Number.isFinite(value) ? value : axis.default));
      }
      return coords;
    }
    function shape(text, values, options = {}) {
      live();
      const coords = coordinates(values);
      font.setVariations(coords);
      font.setScale(face.upem, face.upem);
      const buffer = hb.createBuffer();
      try {
        buffer.addText(String(text));
        buffer.guessSegmentProperties();
        if (options.direction) buffer.setDirection(options.direction);
        if (options.script) buffer.setScript(options.script);
        if (options.language) buffer.setLanguage(options.language);
        hb.shape(font, buffer, options.features || "");
        return buffer.json();
      } finally { buffer.destroy(); }
    }
    function outline(glyph, values) {
      live();
      const coords = coordinates(values), key = id + ":" + glyph + ":" + JSON.stringify(coords);
      if (outlines.has(key)) {
        const entry = outlines.get(key);
        outlines.delete(key); outlines.set(key, entry);
        return entry.path;
      }
      font.setVariations(coords);
      font.setScale(face.upem, face.upem);
      const path = Object.freeze(font.glyphToJson(glyph).map(command => Object.freeze({
        type: command.type, values: Object.freeze(command.values),
      })));
      // Account for JS objects and numeric channels conservatively. WASM and
      // loaded font memory are reported separately and are not cache entries.
      const bytes = 128 + key.length * 2 + path.reduce((sum, command) => sum + 96 + 8 * command.values.length, 0);
      if (bytes <= maxOutlineBytes) {
        while (cachedBytes + bytes > maxOutlineBytes) drop(outlines.keys().next().value);
        outlines.set(key, { path, bytes }); cachedBytes += bytes;
      }
      return path;
    }
    return {
      reference, upem: face.upem, axes, shape, outline, coordinates,
      dispose() {
        if (disposed) return;
        disposed = true;
        for (const key of outlines.keys()) if (key.startsWith(id + ":")) drop(key);
        font.destroy(); face.destroy(); blob.destroy();
      },
    };
  }
  return { open, stats: () => ({ outlineEntries: outlines.size, outlineBytes: cachedBytes,
    maxOutlineBytes, wasmBytes: memoryBytes() }) };
}

// The caller persists the native asset reference. Missing fonts remain missing;
// this function never substitutes another family or consults system fonts.
async function openAsset(engine, wrapper, reference) {
  if (!wrapper?.asset) return { state: "missing", reference, message: "The text font is missing from the project." };
  try {
    const bytes = wrapper.asset.file ? await wrapper.asset.file.arrayBuffer() : await wrapper.readFileRemote();
    return { state: "ready", reference, font: engine.open(bytes, reference) };
  } catch (error) {
    return { state: "error", reference, message: error.message || "The text font could not be loaded." };
  }
}

module.exports = { createLoader, createEngine, openAsset };
