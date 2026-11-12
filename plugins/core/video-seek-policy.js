// Shared seek policy for the native element and exact preview/export decoders.
(function videoSeekPolicyModule(global) {
  "use strict";
  const files = new WeakMap(), elements = new WeakMap();
  const unavailable = new WeakSet();
  const HEADER_BYTES = 256 * 1024;
  const MOOV_MAX_BYTES = 16 * 1024 * 1024;
  const MOOV_SCAN_BOXES = 64;
  const masters = new Set([0x1a45dfa3, 0x18538067, 0x1549a966, 0x1654ae6b, 0xae]);

  function vint(bytes, at, id = false) {
    const first = bytes[at];
    if (!first) return null;
    let length = 1, mask = 128;
    while (!(first & mask)) { length++; mask /= 2; }
    if (length > (id ? 4 : 8) || at + length > bytes.length) return null;
    let value = id ? first : first & (mask - 1);
    let unknown = !id && value === mask - 1;
    for (let i = 1; i < length; i++) {
      value = value * 256 + bytes[at + i];
      unknown &&= bytes[at + i] === 255;
    }
    return { length, value, unknown };
  }
  function unsigned(bytes, start, end) {
    if (end - start > 6) return NaN;
    let value = 0;
    for (let i = start; i < end; i++) value = value * 256 + bytes[i];
    return value;
  }
  function readTiming(bytes) {
    if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return readWebmTiming(bytes);
    return readMp4Timing(bytes);
  }
  function readWebmTiming(bytes) {
    let scale = 1000000, duration = 0, webm = false;
    function walk(start, end, track = null, depth = 0) {
      if (depth > 8) return;
      for (let at = start; at < end;) {
        const id = vint(bytes, at, true);
        if (!id) break;
        const size = vint(bytes, at + id.length);
        if (!size) break;
        const body = at + id.length + size.length;
        const stop = size.unknown ? end : Math.min(end, body + size.value);
        if (stop < body) break;
        if (id.value === 0xae) {
          const entry = {};
          walk(body, stop, entry, depth + 1);
          if (entry.type === 1 && entry.duration > 0) duration = entry.duration;
        } else if (masters.has(id.value)) walk(body, stop, track, depth + 1);
        else if (id.value === 0x4282) webm = String.fromCharCode(...bytes.subarray(body, Math.min(stop, body + 8))) === "webm";
        else if (id.value === 0x2ad7b1) scale = unsigned(bytes, body, stop);
        else if (track && id.value === 0x83) track.type = unsigned(bytes, body, stop);
        else if (track && id.value === 0x23e383) track.duration = unsigned(bytes, body, stop);
        if (size.unknown) break;
        at = body + size.value;
      }
    }
    walk(0, bytes.length);
    if (!webm || !(duration > 0) || !(scale > 0)) return null;
    // DefaultDuration is integral nanoseconds. Recover conventional rational
    // rates only when their duration differs by at most one nanosecond.
    let period = duration / 1e9;
    for (const denominator of [1, 1001]) {
      const rate = Math.round(1e9 / duration * denominator) / denominator;
      if (rate > 0 && Math.abs(1e9 / rate - duration) <= 1) { period = 1 / rate; break; }
    }
    return { period, quantum: scale / 1e9 };
  }
  function ascii(bytes, at, length) {
    let text = "";
    for (let i = 0; i < length; i++) text += String.fromCharCode(bytes[at + i]);
    return text;
  }
  function u32be(bytes, at) {
    if (at < 0 || at + 4 > bytes.length) throw new RangeError("box field outside the buffer");
    return bytes[at] * 16777216 + bytes[at + 1] * 65536 + bytes[at + 2] * 256 + bytes[at + 3];
  }
  // Reads one ISO BMFF box header. A size of 0 means "to the end of the
  // container". Returns null when the box is malformed or truncated, so
  // every caller degrades to uncorrected seeks instead of throwing.
  function readBox(bytes, at, containerEnd) {
    if (at + 8 > containerEnd || at + 8 > bytes.length) return null;
    let size = u32be(bytes, at);
    const type = ascii(bytes, at + 4, 4);
    let body = at + 8;
    if (size === 1) {
      if (at + 16 > containerEnd || at + 16 > bytes.length) return null;
      size = u32be(bytes, at + 8) * 4294967296 + u32be(bytes, at + 12);
      if (!Number.isSafeInteger(size) || size < 16) return null;
      body = at + 16;
    } else if (size === 0) {
      size = containerEnd - at;
    } else if (size < 8) return null;
    const end = at + size;
    if (end > containerEnd || end > bytes.length || end < body) return null;
    return { type, body, end };
  }
  function eachBox(bytes, start, end, visit) {
    let count = 0;
    for (let at = start; at < end;) {
      const box = readBox(bytes, at, end);
      if (!box || ++count > 4096) return false;
      if (visit(box.type, box.body, box.end)) return true;
      at = box.end;
    }
    return false;
  }
  function readMdhdTimescale(bytes, body, end) {
    if (body + 4 > end || body + 4 > bytes.length) return 0;
    const version = bytes[body];
    if (version === 0) {
      if (body + 16 > end || body + 16 > bytes.length) return 0;
      return u32be(bytes, body + 12);
    }
    if (version === 1) {
      if (body + 24 > end || body + 24 > bytes.length) return 0;
      return u32be(bytes, body + 20);
    }
    return 0;
  }
  function readHandler(bytes, body, end) {
    if (body + 12 > end || body + 12 > bytes.length) return "";
    return ascii(bytes, body + 8, 4);
  }
  // Collects the single sample delta of a constant-rate track with its total
  // sample count, or null for variable rates and malformed tables. Variable
  // rates keep today's behaviour: no correction.
  function readSttsGrid(bytes, body, end) {
    if (body + 8 > end || body + 8 > bytes.length) return null;
    const count = u32be(bytes, body + 4);
    if (count < 1 || body + 8 + count * 8 > end || body + 8 + count * 8 > bytes.length) return null;
    let delta = 0, total = 0;
    for (let i = 0; i < count; i++) {
      const run = u32be(bytes, body + 8 + i * 8), step = u32be(bytes, body + 8 + i * 8 + 4);
      if (run < 1 || step < 1) return null;
      if (!delta) delta = step;
      else if (step !== delta) return null;
      total += run;
      if (total > 1e9) return null;
    }
    return { delta, total };
  }
  // Composition offsets per sample run: [count, offset] with signed v1
  // offsets. Returns null for malformed or versioned-out tables.
  function readCttsRuns(bytes, body, end) {
    if (body + 8 > end || body + 8 > bytes.length) return null;
    const version = bytes[body], count = u32be(bytes, body + 4);
    if (version !== 0 && version !== 1) return null;
    if (body + 8 + count * 8 > end || body + 8 + count * 8 > bytes.length) return null;
    const runs = [];
    for (let i = 0; i < count; i++) {
      const run = u32be(bytes, body + 8 + i * 8);
      let offset = u32be(bytes, body + 8 + i * 8 + 4);
      if (run < 1) return null;
      if (version === 1 && offset >= 0x80000000) offset -= 4294967296;
      runs.push([run, offset]);
    }
    return runs;
  }
  function tickMod(value, delta) {
    return ((value % delta) + delta) % delta;
  }
  // The presentation grid over the first samples: PTS is DTS plus the ctts
  // offset. The prefix covers at least two GOP-ish windows (1024 samples),
  // or the whole table when it is smaller. Returns the sample delta with the
  // smallest composition timestamp, or null when offsets leave the delta
  // grid or the tables disagree.
  const GRID_PREFIX_SAMPLES = 1024;
  function readPresentationGrid(bytes, stts, ctts) {
    const grid = stts && readSttsGrid(bytes, stts.body, stts.end);
    if (!grid) return null;
    if (!ctts) return { delta: grid.delta, minCts: 0 };
    const runs = readCttsRuns(bytes, ctts.body, ctts.end);
    if (!runs) return null;
    if (!runs.length) return { delta: grid.delta, minCts: 0 };
    let covered = 0;
    for (const [run] of runs) {
      covered += run;
      if (covered > 1e9) return null;
    }
    if (covered !== grid.total) return null;
    let remaining = Math.min(grid.total, GRID_PREFIX_SAMPLES), dts = 0, minCts = Infinity;
    const prefix = [];
    for (const [run, offset] of runs) {
      if (remaining <= 0) break;
      const take = Math.min(run, remaining);
      prefix.push([dts, offset]);
      if (dts + offset < minCts) minCts = dts + offset;
      dts += run * grid.delta;
      remaining -= take;
    }
    for (const [start, offset] of prefix) {
      if (tickMod(start + offset - minCts, grid.delta) !== 0) return null;
    }
    return { delta: grid.delta, minCts };
  }
  // Reads the first edit-list entry's media time in media ticks. Absent and
  // empty lists mean zero. A single non-zero entry is returned for the phase
  // check; empty edits, several non-trivial entries, non-unit rates, and
  // malformed lists keep uncorrected seeks.
  function readEditMediaTime(bytes, body, end) {
    if (body + 8 > end || body + 8 > bytes.length) return null;
    const version = bytes[body], count = u32be(bytes, body + 4);
    const entrySize = version === 0 ? 12 : version === 1 ? 20 : 0;
    if (!entrySize || body + 8 + count * entrySize > end || body + 8 + count * entrySize > bytes.length) return null;
    if (!count) return { mediaTime: 0 };
    let mediaTime = 0;
    for (let i = 0; i < count; i++) {
      const at = body + 8 + i * entrySize;
      let media = 0;
      if (version === 0) {
        media = u32be(bytes, at + 4);
        if (media === 0xFFFFFFFF) return null;
      } else {
        const high = u32be(bytes, at + 8), low = u32be(bytes, at + 12);
        if (high === 0xFFFFFFFF && low === 0xFFFFFFFF) return null;
        if (high > 0x1FFFFF) return null;
        media = high * 4294967296 + low;
      }
      const integer = version === 0 ? at + 8 : at + 16;
      if (bytes[integer] * 256 + bytes[integer + 1] !== 1 || bytes[integer + 2] * 256 + bytes[integer + 3] !== 0) return null;
      if (count > 1) {
        if (media !== 0) return null;
      } else mediaTime = media;
    }
    return { mediaTime };
  }
  function readVideoTrack(bytes, start, end) {
    let mdia = null, editBox = null;
    eachBox(bytes, start, end, (type, body, boxEnd) => {
      if (type === "mdia") mdia = { body, end: boxEnd };
      else if (type === "edts") eachBox(bytes, body, boxEnd, (innerType, innerBody, innerEnd) => {
        if (innerType === "elst") { editBox = { body: innerBody, end: innerEnd }; return true; }
        return false;
      });
      return false;
    });
    if (!mdia) return null;
    let timescale = 0, handler = "", stts = null, ctts = null;
    eachBox(bytes, mdia.body, mdia.end, (type, body, boxEnd) => {
      if (type === "mdhd") timescale = readMdhdTimescale(bytes, body, boxEnd);
      else if (type === "hdlr") handler = readHandler(bytes, body, boxEnd);
      else if (type === "minf") eachBox(bytes, body, boxEnd, (innerType, innerBody, innerEnd) => {
        if (innerType === "stbl") eachBox(bytes, innerBody, innerEnd, (tableType, tableBody, tableEnd) => {
          if (tableType === "stts") stts = { body: tableBody, end: tableEnd };
          else if (tableType === "ctts") ctts = { body: tableBody, end: tableEnd };
          return false;
        });
        return false;
      });
      return false;
    });
    if (handler !== "vide" || !(timescale > 0)) return null;
    const grid = readPresentationGrid(bytes, stts, ctts);
    if (!grid) return null;
    const edit = !editBox ? { mediaTime: 0 } : readEditMediaTime(bytes, editBox.body, editBox.end);
    if (!edit) return null;
    // The nominal boundaries stay at n * period only when the presentation
    // grid (earliest composition timestamp minus the edit-list media time)
    // lands on a whole multiple of the sample delta. Anything else keeps
    // uncorrected seeks: shifting the grid cannot be done safely without
    // knowing the caller's intended frame mapping.
    if (tickMod(grid.minCts - edit.mediaTime, grid.delta) !== 0) return null;
    const delta = grid.delta;
    // Sample deltas are integral ticks. Recover conventional rational rates
    // only when they match the grid to within one nanosecond, mirroring the
    // WebM branch. Anything coarser keeps the exact tick grid, which simply
    // misses the boundary guard instead of biasing a wrong frame.
    let period = delta / timescale;
    for (const denominator of [1, 1001]) {
      const rate = Math.round(timescale / delta * denominator) / denominator;
      if (rate > 0 && Math.abs(timescale / rate - delta) <= timescale * 1e-9) { period = 1 / rate; break; }
    }
    return { period, quantum: 1 / timescale, phase: (grid.minCts - edit.mediaTime) / timescale };
  }
  function readMp4Timing(bytes) {
    try {
      let moov = null;
      eachBox(bytes, 0, bytes.length, (type, body, end) => {
        if (type === "moov") { moov = { body, end }; return true; }
        return false;
      });
      if (!moov) return null;
      let video = null;
      eachBox(bytes, moov.body, moov.end, (type, body, end) => {
        if (type !== "trak") return false;
        const timing = readVideoTrack(bytes, body, end);
        if (timing) { video = timing; return true; }
        return false;
      });
      return video;
    } catch (_error) {
      return null;
    }
  }
  function target(time, duration, timing) {
    const requested = Number.isFinite(time) ? time : 0;
    let result = Math.max(0, requested);
    // This assumes muxers round nominal PTS to the nearest timestamp tick.
    // Sub-millisecond periods can have colliding or truncated PTS instead.
    if (timing && timing.period >= 0.001 && requested > 0) {
      const boundary = Math.round(requested / timing.period) * timing.period;
      // Restrict correction to nominal frame boundaries. Fractional shutter
      // samples, even ones just before a boundary, must retain their frame.
      if (Math.abs(requested - boundary) <= 1e-9) {
        let bias = Math.min(0.0005, timing.quantum / 2, timing.period * 0.249);
        // Decoder comparisons below one microsecond are unreliable, so keep
        // the bias above the observed precision without leaving the frame.
        if (bias < 2e-6) bias = Math.min(2e-6, timing.quantum / 2);
        result += bias;
      }
    }
    if (Number.isFinite(duration) && duration > 0) result = Math.min(result, Math.max(0, duration - 1e-7));
    return result;
  }
  // Finds the moov box without reading media data: only 8- or 16-byte
  // headers are read until moov starts. Returns null when moov is missing,
  // oversized, malformed, or truncated.
  async function locateMoov(file) {
    let offset = 0;
    for (let boxes = 0; boxes < MOOV_SCAN_BOXES; boxes++) {
      let header;
      try {
        header = new Uint8Array(await file.slice(offset, offset + 16).arrayBuffer());
      } catch (_error) {
        return null;
      }
      if (header.length < 8) return null;
      const type = ascii(header, 4, 4);
      let size = header[0] * 16777216 + header[1] * 65536 + header[2] * 256 + header[3];
      if (size === 1) {
        if (header.length < 16) return null;
        size = (header[8] * 16777216 + header[9] * 65536 + header[10] * 256 + header[11]) * 4294967296 +
          header[12] * 16777216 + header[13] * 65536 + header[14] * 256 + header[15];
        if (!Number.isSafeInteger(size) || size < 16) return null;
      } else if (size === 0) {
        if (!Number.isFinite(file.size)) return null;
        size = file.size - offset;
        if (!(size >= 8)) return null;
      } else if (size < 8) return null;
      if (type === "moov") {
        if (size > MOOV_MAX_BYTES) return null;
        return { start: offset, size };
      }
      offset += size;
    }
    return null;
  }
  function timingFor(media) {
    const file = media?.file;
    if (!file || typeof file !== "object" || typeof file.slice !== "function" || typeof file.arrayBuffer !== "function") return Promise.resolve(null);
    if (!files.has(file)) files.set(file, Promise.resolve().then(async () => {
      const head = new Uint8Array(await file.slice(0, HEADER_BYTES).arrayBuffer());
      if (head.length >= 4 && head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) {
        return readTiming(head);
      }
      // Many MP4s keep moov after mdat, past the header window. Read only
      // the box headers to find it, then read moov alone.
      const moov = await locateMoov(file);
      if (!moov) return null;
      return readTiming(new Uint8Array(await file.slice(moov.start, moov.start + moov.size).arrayBuffer()));
    }).catch(() => null));
    return files.get(file);
  }
  function ensure(video, media) {
    if (!video || unavailable.has(video)) return Promise.resolve();
    let state = elements.get(video);
    if (!state) {
      let owner = video, descriptor;
      while (owner && !descriptor) {
        descriptor = Object.getOwnPropertyDescriptor(owner, "currentTime");
        owner = Object.getPrototypeOf(owner);
      }
      if (!descriptor?.get || !descriptor?.set) return Promise.resolve();
      state = { media: null, timing: null, resolved: false };
      try {
        Object.defineProperty(video, "currentTime", { configurable: true,
          get() { return descriptor.get.call(this); },
          set(time) {
            descriptor.set.call(this, target(time, this.duration, state.timing));
            state.unadjusted = false;
            state.lastSeek = { requested: time, observed: descriptor.get.call(this), source: this.src || this.currentSrc };
          },
        });
      } catch (_error) {
        unavailable.add(video);
        return Promise.resolve();
      }
      elements.set(video, state);
    }
    const file = media?.file;
    if (state.media !== media || state.file !== file || !state.pending) {
      state.media = media; state.file = file; state.timing = null; state.resolved = false; state.unadjusted = false;
      state.pending = timingFor(media).then(timing => {
        if (state.media !== media || state.file !== file) return;
        state.timing = timing; state.resolved = true;
        const seek = state.lastSeek;
        if (!seek || !timing || seek.source !== (video.src || video.currentSrc)) return;
        const corrected = target(seek.requested, video.duration, timing);
        if (corrected === target(seek.requested, video.duration, null)) return;
        state.unadjusted = true;
        try {
          // Correct only the still-current paused request, once per resolution.
          // A later seek or a playing clock must never be pulled backwards.
          if (video.paused && Math.abs(video.currentTime - seek.observed) <= 1e-7) video.currentTime = seek.requested;
        } catch (_error) { /* Leave this frame ineligible for cache capture. */ }
      });
    }
    return state.pending;
  }
  function isReady(video, media) {
    const state = video && elements.get(video);
    return !!state && state.media === media && state.file === media?.file && state.resolved &&
      !state.unadjusted && video.paused === true && !video.seeking && video.readyState >= 2;
  }
  const api = { readTiming, target, ensure, isReady,
    canCapture(sequence, frame) {
      return (sequence.videoSchedules || []).every(schedule => {
        const item = schedule.currentItem;
        return !item?.media || frame < item.start || frame >= item.start + item.length || isReady(schedule.el, item.media);
      });
    },
    seekTime(video, time) { return target(time, video.duration, elements.get(video)?.timing); } };
  global.ZoidiumVideoSeekPolicy = api;
  const prototype = global.PZ?.schedule?.prototype;
  if (prototype && !prototype.__zoidiumSeekPolicy) {
    const original = prototype.update;
    prototype.update = function updateWithSeekPolicy() {
      // Install before the native update's initial seek so its logical time
      // is retained even if the media clock rounds the observable value.
      if (this.type === global.PZ.schedule.type.VIDEO) ensure(this.el, this.currentItem?.media);
      const result = original.apply(this, arguments);
      if (this.type === global.PZ.schedule.type.VIDEO) ensure(this.el, this.currentItem?.media);
      return result;
    };
    prototype.__zoidiumSeekPolicy = true;
  }
  if (typeof module === "object" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
