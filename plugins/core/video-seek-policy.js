// Shared seek policy for the native element and exact preview/export decoders.
(function videoSeekPolicyModule(global) {
  "use strict";
  const files = new WeakMap(), elements = new WeakMap();
  const unavailable = new WeakSet();
  const HEADER_BYTES = 256 * 1024;
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
    if (bytes[0] !== 0x1a || bytes[1] !== 0x45 || bytes[2] !== 0xdf || bytes[3] !== 0xa3) return null;
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
        const bias = Math.min(0.0005, timing.quantum / 2, timing.period * 0.249);
        result += bias;
      }
    }
    if (Number.isFinite(duration) && duration > 0) result = Math.min(result, Math.max(0, duration - 1e-7));
    return result;
  }
  function timingFor(media) {
    const file = media?.file;
    if (!file || typeof file !== "object" || typeof file.slice !== "function" || typeof file.arrayBuffer !== "function") return Promise.resolve(null);
    if (!files.has(file)) files.set(file, Promise.resolve().then(async () =>
      readTiming(new Uint8Array(await file.slice(0, HEADER_BYTES).arrayBuffer()))).catch(() => null));
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
      state = { media: null, timing: null };
      try {
        Object.defineProperty(video, "currentTime", { configurable: true,
          get() { return descriptor.get.call(this); },
          set(time) { descriptor.set.call(this, target(time, this.duration, state.timing)); },
        });
      } catch (_error) {
        unavailable.add(video);
        return Promise.resolve();
      }
      elements.set(video, state);
    }
    const file = media?.file;
    if (state.media !== media || state.file !== file || !state.pending) {
      state.media = media; state.file = file; state.timing = null;
      state.pending = timingFor(media).then(timing => { if (state.media === media && state.file === file) state.timing = timing; });
    }
    return state.pending;
  }
  const api = { readTiming, target, ensure,
    seekTime(video, time) { return target(time, video.duration, elements.get(video)?.timing); } };
  global.ZoidiumVideoSeekPolicy = api;
  const prototype = global.PZ?.schedule?.prototype;
  if (prototype && !prototype.__zoidiumSeekPolicy) {
    const original = prototype.update;
    prototype.update = function updateWithSeekPolicy() {
      const result = original.apply(this, arguments);
      if (this.type === global.PZ.schedule.type.VIDEO) ensure(this.el, this.currentItem?.media);
      return result;
    };
    prototype.__zoidiumSeekPolicy = true;
  }
  if (typeof module === "object" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
