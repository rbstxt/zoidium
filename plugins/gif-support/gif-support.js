"use strict";

// Animated GIF support for Zoidium.
//
// Decoder design is a port of the gif.js decoder from DaviFX's OpenZoid
// (https://www.youtube.com/@davifxarts): GIF87a/89a, LZW, interlace,
// palettes, transparency and disposal modes 0-3 composited on a scratch
// buffer, per-frame canvases, delay clamped to a minimum of 100 ms, and caps
// of 512 frames / 64 megapixels. The integration below is a Zoidium rewrite:
// instead of seeking every GIF by project-global time, each consumer texture
// is driven by the time local to the clip that uses it.
//
// Time base: the shown frame is a pure function of media time. For a texture
// used inside a clip, media time is clip.properties.time.get(localFrame),
// where localFrame is the frame already relative to the clip start that CM3
// passes down through layer/object/material update() (the same mapping CM3
// expressions use). This includes the clip offset, trims and retime
// keyframes. Where no clip ancestor exists, media time falls back to project
// time (project frame / sequence rate). GIFs loop. No wall clock, no frame
// counters and no Math.random are involved, so seeking any frame in any
// order renders the same image.
//
// Export safety: decoding replaces data.loading with the decode promise, so
// the existing material/layer prepare() chains await the decoded frames and
// an exported frame never contains the 1x1 placeholder.

const GifSupport = (() => {
  const MAX_FRAMES = 512;
  const MAX_PIXELS = 67108864;
  const MIN_FRAME_SECONDS = 0.1;
  const DEFAULT_RATE = 30;

  const state = {
    active: false,
    installation: null,
    PZ: null,
    ImageAsset: null,
    Clip: null,
    originals: null,
    patched: null,
    records: new Set(),
    wrappers: new Set(),
    clock: null,
  };

  function defaultCreateCanvas(width, height, doc) {
    const target = doc || (typeof document !== "undefined" ? document : null);
    if (!target || typeof target.createElement !== "function") return null;
    const canvas = target.createElement("canvas");
    if (!canvas) return null;
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }

  function hasCanvas2D(doc) {
    try {
      const canvas = defaultCreateCanvas(1, 1, doc);
      const ctx = canvas && canvas.getContext && canvas.getContext("2d");
      return Boolean(ctx && typeof ctx.createImageData === "function" && typeof ctx.putImageData === "function");
    } catch (_error) {
      return false;
    }
  }

  function lzwDecode(minCodeSize, data, pixelCount) {
    const clearCode = 1 << minCodeSize;
    const endCode = clearCode + 1;
    let codeSize = minCodeSize + 1;
    let nextCode = endCode + 1;
    let dictionary = [];
    for (let i = 0; i < clearCode; i++) dictionary[i] = [i];
    const output = new Uint8Array(pixelCount);
    let outputIndex = 0;
    let previous = null;
    let bitBuffer = 0;
    let bitCount = 0;
    let byteIndex = 0;

    function readCode() {
      while (bitCount < codeSize) {
        if (byteIndex >= data.length) return -1;
        bitBuffer |= data[byteIndex++] << bitCount;
        bitCount += 8;
      }
      const code = bitBuffer & ((1 << codeSize) - 1);
      bitBuffer >>= codeSize;
      bitCount -= codeSize;
      return code;
    }

    while (outputIndex < pixelCount) {
      const code = readCode();
      if (code < 0) break;
      if (code === clearCode) {
        codeSize = minCodeSize + 1;
        nextCode = endCode + 1;
        dictionary = [];
        for (let i = 0; i < clearCode; i++) dictionary[i] = [i];
        previous = null;
        continue;
      }
      if (code === endCode) break;
      let entry;
      if (code < nextCode && dictionary[code]) {
        entry = dictionary[code];
      } else if (previous) {
        entry = previous.concat(previous[0]);
      } else {
        break;
      }
      for (let i = 0; i < entry.length && outputIndex < pixelCount; i++) {
        output[outputIndex++] = entry[i];
      }
      if (previous) {
        dictionary[nextCode] = previous.concat(entry[0]);
        nextCode++;
        if (nextCode === (1 << codeSize) && codeSize < 12) codeSize++;
      }
      previous = entry;
    }
    return output;
  }

  // Note: OpenZoid used a step of 8 for every pass, which drops rows for
  // most heights. The GIF89a spec steps are 8, 8, 4, 2 per pass.
  function deinterlace(indices, width, height) {
    const output = new Uint8Array(width * height);
    const starts = [0, 4, 2, 1];
    const steps = [8, 8, 4, 2];
    let line = 0;
    for (let pass = 0; pass < starts.length; pass++) {
      for (let row = starts[pass]; row < height; row += steps[pass]) {
        if (line >= height) break;
        output.set(indices.subarray(row * width, row * width + width), line * width);
        line++;
      }
    }
    return output;
  }

  // Decodes a GIF87a/89a buffer into composited per-frame canvases.
  // Returns { width, height, frames, cumulative, total } or null.
  // createCanvas is injectable so tests can supply a fake 2D canvas.
  function decode(buffer, createCanvas) {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    if (bytes.length < 13) return null;
    const signature = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5]);
    if (signature !== "GIF87a" && signature !== "GIF89a") return null;

    let position = 6;
    const length = bytes.length;
    const width = bytes[position] | (bytes[position + 1] << 8);
    const height = bytes[position + 2] | (bytes[position + 3] << 8);
    position += 4;
    const packed = bytes[position++];
    position += 2;
    if (width < 1 || height < 1) return null;
    if (width * height > MAX_PIXELS) return null;

    let globalTable = null;
    if (packed & 0x80) {
      const globalSize = 1 << ((packed & 0x07) + 1);
      if (position + globalSize * 3 > length) return null;
      globalTable = bytes.subarray(position, position + globalSize * 3);
      position += globalSize * 3;
    }

    const makeCanvas = createCanvas || defaultCreateCanvas;
    const scratch = makeCanvas(width, height);
    if (!scratch) return null;
    const scratchContext = scratch.getContext("2d");
    if (!scratchContext) return null;
    const imageData = scratchContext.createImageData(width, height);
    const pixels = imageData.data;
    const frames = [];
    const cumulative = [];
    let total = 0;
    let budget = MAX_PIXELS;
    let delay = 0;
    let disposal = 0;
    let transparent = -1;

    function readByte() {
      return position < length ? bytes[position++] : -1;
    }

    function readUint16() {
      if (position + 1 >= length) return 0;
      const value = bytes[position] | (bytes[position + 1] << 8);
      position += 2;
      return value;
    }

    function skipSubBlocks() {
      while (position < length) {
        const size = readByte();
        if (size <= 0) break;
        position += size;
      }
    }

    function readSubBlocks() {
      const chunks = [];
      let totalSize = 0;
      while (position < length) {
        const size = readByte();
        if (size <= 0) break;
        const end = Math.min(position + size, length);
        chunks.push(bytes.subarray(position, end));
        totalSize += end - position;
        position = end;
      }
      const data = new Uint8Array(totalSize);
      let offset = 0;
      for (const chunk of chunks) {
        data.set(chunk, offset);
        offset += chunk.length;
      }
      return data;
    }

    while (position < length && frames.length < MAX_FRAMES && budget > 0) {
      const block = readByte();
      if (block < 0 || block === 0x3b) break;
      if (block === 0x21) {
        const label = readByte();
        if (label === 0xf9) {
          readByte();
          const flags = readByte();
          delay = readUint16();
          const transparentIndex = readByte();
          readByte();
          disposal = (flags >> 2) & 0x07;
          transparent = flags & 0x01 ? transparentIndex : -1;
        } else {
          skipSubBlocks();
        }
        continue;
      }
      if (block !== 0x2c) break;

      const left = readUint16();
      const top = readUint16();
      const frameWidth = readUint16();
      const frameHeight = readUint16();
      if (frameWidth < 1 || frameHeight < 1) return null;
      const imageFlags = readByte();
      let localTable = null;
      if (imageFlags & 0x80) {
        const localSize = 1 << ((imageFlags & 0x07) + 1);
        if (position + localSize * 3 > length) return null;
        localTable = bytes.subarray(position, position + localSize * 3);
        position += localSize * 3;
      }
      const interlaced = (imageFlags & 0x40) !== 0;
      const table = localTable || globalTable;
      const minCodeSize = readByte();
      if (minCodeSize < 1 || minCodeSize > 8) return null;
      const data = readSubBlocks();
      let indices = lzwDecode(minCodeSize, data, frameWidth * frameHeight);
      if (interlaced) indices = deinterlace(indices, frameWidth, frameHeight);

      const snapshot = disposal === 3 ? pixels.slice() : null;
      if (table) {
        for (let y = 0; y < frameHeight; y++) {
          const targetY = top + y;
          if (targetY < 0 || targetY >= height) continue;
          for (let x = 0; x < frameWidth; x++) {
            const targetX = left + x;
            if (targetX < 0 || targetX >= width) continue;
            const index = indices[y * frameWidth + x];
            if (index === transparent) continue;
            const target = (targetY * width + targetX) * 4;
            const color = index * 3;
            if (color + 2 >= table.length) continue;
            pixels[target] = table[color];
            pixels[target + 1] = table[color + 1];
            pixels[target + 2] = table[color + 2];
            pixels[target + 3] = 255;
          }
        }
      }

      const frameCanvas = makeCanvas(width, height);
      if (!frameCanvas) return null;
      frameCanvas.getContext("2d").putImageData(imageData, 0, 0);
      const seconds = (delay < 2 ? 10 : delay) / 100;
      frames.push({ canvas: frameCanvas, seconds });
      total += seconds;
      cumulative.push(total);
      budget -= width * height;

      if (disposal === 2) {
        for (let clearY = top; clearY < top + frameHeight; clearY++) {
          if (clearY < 0 || clearY >= height) continue;
          for (let clearX = left; clearX < left + frameWidth; clearX++) {
            if (clearX < 0 || clearX >= width) continue;
            const clearTarget = (clearY * width + clearX) * 4;
            pixels[clearTarget] = 0;
            pixels[clearTarget + 1] = 0;
            pixels[clearTarget + 2] = 0;
            pixels[clearTarget + 3] = 0;
          }
        }
      } else if (disposal === 3 && snapshot) {
        pixels.set(snapshot);
      }
      disposal = 0;
      transparent = -1;
      delay = 0;
    }

    if (frames.length === 0) return null;
    if (total <= 0) {
      total = 0;
      cumulative.length = 0;
      for (const frame of frames) {
        total += frame.seconds;
        cumulative.push(total);
      }
    }
    return { width, height, frames, cumulative, total };
  }

  // Pure frame picker: loops time into [0, total) and returns the first
  // frame whose cumulative end exceeds it (matches OpenZoid seek).
  function pickFrameIndex(cumulative, total, time) {
    if (!cumulative || cumulative.length === 0 || !(total > 0)) return 0;
    let t = time % total;
    if (t < 0) t += total;
    // Guard against -0 and rounding at the loop seam.
    if (t < 0) t = 0;
    for (let i = 0; i < cumulative.length; i++) {
      if (t < cumulative[i]) return i;
    }
    return cumulative.length - 1;
  }

  function isGifAsset(asset) {
    if (!asset) return false;
    const filename = asset.filename || "";
    const url = asset.url || "";
    return /\.gif([?#].*)?$/i.test(filename) || /\.gif([?#].*)?$/i.test(url);
  }

  // Same URL adjustment the stock image decoder uses for hosted assets.
  function assetURL(asset) {
    const url = asset.url;
    if (typeof url !== "string" || !url) return null;
    return url.startsWith("/assets") ? url.substring(1) : url;
  }

  function fetchBytes(url) {
    if (typeof fetch === "function") {
      return fetch(url).then((response) => {
        if (!response.ok) throw new Error("HTTP " + response.status);
        return response.arrayBuffer();
      });
    }
    return new Promise((resolve, reject) => {
      const request = new XMLHttpRequest();
      request.open("GET", url);
      request.responseType = "arraybuffer";
      request.onload = () => {
        if (request.status !== 0 && (request.status < 200 || request.status >= 300)) {
          reject(new Error("HTTP " + request.status));
          return;
        }
        resolve(request.response);
      };
      request.onerror = () => reject(new Error("network error"));
      request.send();
    });
  }

  function currentFrameIndex(wrapper) {
    return typeof wrapper.__gifFrame === "number" ? wrapper.__gifFrame : 0;
  }

  function applyFrameToWrapper(wrapper, index) {
    const record = wrapper.data && wrapper.data.gif;
    if (!record || !record.frames || index < 0 || index >= record.frames.length) return;
    if (wrapper.__gifFrame === index && wrapper.__gifApplied) return;
    wrapper.__gifFrame = index;
    wrapper.__gifApplied = true;
    const canvas = record.frames[index].canvas;
    const textures = wrapper.__gifTextures;
    if (!textures) return;
    for (let i = textures.length - 1; i >= 0; i--) {
      try {
        textures[i].image = canvas;
        textures[i].needsUpdate = true;
      } catch (_error) {
        textures.splice(i, 1);
      }
    }
  }

  function refreshWrappersForRecord(record) {
    for (const wrapper of state.wrappers) {
      try {
        if (wrapper.data && wrapper.data.gif === record) {
          wrapper.__gifApplied = false;
          applyFrameToWrapper(wrapper, Math.min(currentFrameIndex(wrapper), record.frames.length - 1));
        }
      } catch (_error) {
        // A dead consumer must never break decoding for the rest.
      }
    }
  }

  function decodeGifBrowser() {
    const source = this;
    const data = this.data;
    const doc = state.PZ && state.PZ.__gifDocument ? state.PZ.__gifDocument : undefined;
    const placeholder = defaultCreateCanvas(1, 1, doc);
    const record = { data, frames: null, cumulative: null, total: 0 };
    data.image = placeholder;
    data.gif = record;
    data.loading = new Promise((resolve) => {
      const finishEmpty = (message) => {
        if (message) console.warn(message);
        resolve();
      };
      const asset = source.asset || {};
      const url = assetURL(asset);
      if (!url) {
        finishEmpty("Missing texture asset: " + (asset.filename || asset.sha256 || "unknown"));
        return;
      }
      fetchBytes(url).then(
        (buffer) => {
          let decoded = null;
          try {
            decoded = decode(buffer, (w, h) => defaultCreateCanvas(w, h, doc));
          } catch (error) {
            finishEmpty("Failed to decode GIF: " + (asset.filename || asset.sha256 || "unknown"));
            return;
          }
          if (!decoded) {
            finishEmpty("Failed to decode GIF: " + (asset.filename || asset.sha256 || "unknown"));
            return;
          }
          record.frames = decoded.frames;
          record.cumulative = decoded.cumulative;
          record.total = decoded.total;
          state.records.add(record);
          data.image = decoded.frames[0].canvas;
          refreshWrappersForRecord(record);
          resolve();
        },
        () => finishEmpty("Failed to load GIF: " + (asset.filename || asset.sha256 || "unknown"))
      );
    });
  }

  const SKIP_KEYS = {
    parent: true,
    parentObject: true,
    parentProject: true,
    parentLayer: true,
    threeObj: true,
    composite: true,
    pass: true,
    __gifTextures: true,
  };

  // Collects every live PZ.asset.image wrapper under a layer without any
  // per-material-type knowledge. Bounded (depth + node budget) and skips
  // host back-pointers and THREE subtrees.
  function collectImageWrappers(root) {
    const found = [];
    if (!root || !state.ImageAsset) return found;
    const seen = new Set();
    const stack = [{ value: root, depth: 0 }];
    let budget = 5000;
    while (stack.length && budget > 0) {
      const { value, depth } = stack.pop();
      if (!value || (typeof value !== "object" && typeof value !== "function")) continue;
      if (seen.has(value)) continue;
      seen.add(value);
      budget--;
      if (value instanceof state.ImageAsset) {
        found.push(value);
        continue;
      }
      if (depth >= 16) continue;
      if (ArrayBuffer.isView(value)) continue;
      if (typeof value.length === "number" && typeof value !== "string") {
        // Array or array-like list (PZ.objectList included).
        const length = value.length;
        if (length >= 0 && length <= 100000) {
          for (let i = length - 1; i >= 0; i--) {
            try {
              stack.push({ value: value[i], depth: depth + 1 });
            } catch (_error) {
              break;
            }
          }
        }
        continue;
      }
      if (value instanceof Map || value instanceof Set || value instanceof Promise) continue;
      const isPlainish = value.constructor === Object || value.constructor === undefined;
      if (!isPlainish && typeof value !== "function") {
        // Still descend into CM3 host objects (layers, materials, effects,
        // property lists) but never into DOM nodes or canvases.
        const tag = typeof value.nodeType === "number" ? value.nodeType : -1;
        if (tag >= 0) continue;
      }
      let keys = null;
      try {
        keys = Object.keys(value);
      } catch (_error) {
        continue;
      }
      for (let i = keys.length - 1; i >= 0; i--) {
        const key = keys[i];
        if (SKIP_KEYS[key]) continue;
        let child = null;
        try {
          child = value[key];
        } catch (_error) {
          continue;
        }
        if (child && (typeof child === "object" || typeof child === "function")) {
          stack.push({ value: child, depth: depth + 1 });
        }
      }
    }
    return found;
  }

  function projectMediaTime() {
    const clock = state.clock;
    if (!clock || !(clock.rate > 0) || typeof clock.frame !== "number") return null;
    return clock.frame / clock.rate;
  }

  function layerMediaTime(layer, localFrame) {
    try {
      if (state.Clip && typeof layer.tryGetParentOfType === "function") {
        const clip = layer.tryGetParentOfType(state.Clip);
        if (clip && clip.properties && clip.properties.time && typeof clip.properties.time.get === "function") {
          const mediaTime = clip.properties.time.get(localFrame);
          if (typeof mediaTime === "number" && isFinite(mediaTime)) return mediaTime;
        }
      }
    } catch (_error) {
      // Fall through to project time.
    }
    return projectMediaTime();
  }

  function seekLayerWrappers(layer, localFrame) {
    const mediaTime = layerMediaTime(layer, localFrame);
    if (mediaTime === null || mediaTime === undefined || !isFinite(mediaTime)) return;
    const wrappers = collectImageWrappers(layer);
    for (const wrapper of wrappers) {
      try {
        const record = wrapper.data && wrapper.data.gif;
        if (!record || !record.frames || record.frames.length < 2 || !(record.total > 0)) continue;
        applyFrameToWrapper(wrapper, pickFrameIndex(record.cumulative, record.total, mediaTime));
      } catch (_error) {
        // One bad consumer must never break the frame.
      }
    }
  }

  function readRate(sequence) {
    try {
      const rate = sequence.properties.rate.get();
      if (typeof rate === "number" && rate > 0 && isFinite(rate)) return rate;
    } catch (_error) {
      // Use the default below.
    }
    return DEFAULT_RATE;
  }

  function restoreOriginals() {
    const originals = state.originals;
    const patched = state.patched;
    if (!originals || !patched) return;
    try {
      if (originals.ImageAsset && state.ImageAsset === originals.ImageAsset) {
        const prototype = originals.ImageAsset.prototype;
        if (prototype.decodeBrowser === patched.decodeBrowser) {
          prototype.decodeBrowser = originals.decodeBrowser;
        }
        if (prototype.getTexture === patched.getTexture) {
          prototype.getTexture = originals.getTexture;
        }
      }
      if (originals.Layer && originals.Layer.prototype.update === patched.layerUpdate) {
        originals.Layer.prototype.update = originals.layerUpdate;
      }
      if (originals.compositor && originals.compositor.prototype.renderSequence === patched.renderSequence) {
        originals.compositor.prototype.renderSequence = originals.renderSequence;
      }
    } catch (_error) {
      // Restore is best-effort; the host keeps working either way.
    }
  }

  async function activate(context) {
    if (state.active) return;
    const installation = { active: true };
    state.installation = installation;
    context.lifecycle.onDispose(() => {
      if (state.installation === installation) deactivate();
    });

    const host = (context.PZ || (typeof window !== "undefined" ? window.PZ : null) || {});
    const doc = context.document || (typeof document !== "undefined" ? document : null);
    state.PZ = host;
    try {
      host.__gifDocument = doc;
    } catch (_error) {
      // Non-extensible host; fall back to the global document at call time.
    }

    const ImageAsset = host.asset && host.asset.image;
    if (!ImageAsset || !ImageAsset.prototype ||
        typeof ImageAsset.prototype.decodeBrowser !== "function" ||
        typeof ImageAsset.prototype.getTexture !== "function") {
      throw new Error("Animated GIF requires PZ.asset.image with decodeBrowser/getTexture.");
    }
    if (!hasCanvas2D(doc)) {
      throw new Error("Animated GIF requires a 2D canvas context.");
    }
    const Layer = host.layer;
    if (!Layer || !Layer.prototype || typeof Layer.prototype.update !== "function") {
      throw new Error("Animated GIF requires PZ.layer with update().");
    }
    const compositor = host.compositor;
    const hasRenderSequence = Boolean(
      compositor && compositor.prototype && typeof compositor.prototype.renderSequence === "function"
    );

    state.ImageAsset = ImageAsset;
    state.Clip = host.clip || null;
    state.originals = {
      ImageAsset,
      Layer,
      compositor: hasRenderSequence ? compositor : null,
      decodeBrowser: ImageAsset.prototype.decodeBrowser,
      getTexture: ImageAsset.prototype.getTexture,
      layerUpdate: Layer.prototype.update,
      renderSequence: hasRenderSequence ? compositor.prototype.renderSequence : null,
    };
    state.patched = {};

    const originalDecodeBrowser = state.originals.decodeBrowser;
    const originalGetTexture = state.originals.getTexture;
    const originalLayerUpdate = state.originals.layerUpdate;
    const originalRenderSequence = state.originals.renderSequence;

    function patchedDecodeBrowser() {
      if (!installation.active) {
        return originalDecodeBrowser.apply(this, arguments);
      }
      let asset = null;
      try {
        asset = this.asset;
      } catch (_error) {
        asset = null;
      }
      if (!isGifAsset(asset)) {
        return originalDecodeBrowser.apply(this, arguments);
      }
      return decodeGifBrowser.call(this);
    }

    function patchedGetTexture() {
      const texture = originalGetTexture.apply(this, arguments);
      if (!installation.active) return texture;
      try {
        const record = this.data && this.data.gif;
        if (!record) return texture;
        if (!this.__gifTextures) this.__gifTextures = [];
        if (this.__gifTextures.indexOf(texture) < 0) this.__gifTextures.push(texture);
        state.wrappers.add(this);
        if (record.frames && record.frames.length) {
          const index = Math.min(currentFrameIndex(this), record.frames.length - 1);
          this.__gifApplied = false;
          applyFrameToWrapper(this, index);
        }
        if (texture && typeof texture.addEventListener === "function") {
          const wrapper = this;
          texture.addEventListener("dispose", function onGifTextureDispose() {
            try {
              const list = wrapper.__gifTextures;
              if (list) {
                const at = list.indexOf(texture);
                if (at >= 0) list.splice(at, 1);
                if (list.length === 0 && state.wrappers.has(wrapper)) state.wrappers.delete(wrapper);
              }
            } catch (_error) {
              // Disposal cleanup is best-effort.
            }
          });
        }
      } catch (_error) {
        // Texture bookkeeping must never break material creation.
      }
      return texture;
    }

    function patchedLayerUpdate() {
      const frame = arguments.length ? arguments[0] : undefined;
      const result = originalLayerUpdate.apply(this, arguments);
      if (!installation.active) return result;
      try {
        if (typeof frame === "number" && isFinite(frame)) seekLayerWrappers(this, frame);
      } catch (_error) {
        // Seeking must never break layer updates.
      }
      return result;
    }

    function patchedRenderSequence() {
      if (installation.active) {
        try {
          const sequence = this._sequence;
          if (sequence) {
            const rate = readRate(sequence);
            const frame = arguments.length ? arguments[0] : NaN;
            if (typeof frame === "number" && isFinite(frame)) {
              state.clock = { frame, rate };
              // Fallback for direct data.image readers (no clip context):
              // project-time frame, deterministic per exported frame.
              const mediaTime = frame / rate;
              for (const record of state.records) {
                try {
                  if (record.frames && record.frames.length > 1 && record.total > 0) {
                    record.data.image = record.frames[
                      pickFrameIndex(record.cumulative, record.total, mediaTime)
                    ].canvas;
                  }
                } catch (_error) {
                  // One bad record must never break the render.
                }
              }
            }
          }
        } catch (_error) {
          // Clock capture must never break rendering.
        }
      }
      return originalRenderSequence.apply(this, arguments);
    }

    state.patched.decodeBrowser = patchedDecodeBrowser;
    state.patched.getTexture = patchedGetTexture;
    state.patched.layerUpdate = patchedLayerUpdate;
    state.patched.renderSequence = hasRenderSequence ? patchedRenderSequence : null;

    try {
      ImageAsset.prototype.decodeBrowser = patchedDecodeBrowser;
      ImageAsset.prototype.getTexture = patchedGetTexture;
      Layer.prototype.update = patchedLayerUpdate;
      if (hasRenderSequence) compositor.prototype.renderSequence = patchedRenderSequence;
    } catch (error) {
      restoreOriginals();
      throw error;
    }
    state.active = true;
  }

  function deactivate() {
    if (!state.active && !state.originals) return;
    state.active = false;
    if (state.installation) state.installation.active = false;
    restoreOriginals();
    state.records.clear();
    state.wrappers.clear();
    state.clock = null;
    state.originals = null;
    state.patched = null;
    state.ImageAsset = null;
    state.Clip = null;
    if (state.PZ) {
      try {
        if (state.PZ.__gifDocument) delete state.PZ.__gifDocument;
      } catch (_error) {
        // Best-effort host cleanup.
      }
    }
    state.PZ = null;
  }

  return {
    activate,
    deactivate,
    MAX_FRAMES,
    MAX_PIXELS,
    decode,
    pickFrameIndex,
    isGifAsset,
  };
})();

module.exports = GifSupport;
