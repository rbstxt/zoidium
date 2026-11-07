(function (global) {
  "use strict";
  const prototype = global.PZ?.ui?.waveform?.prototype;
  if (!prototype || prototype.__zoidiumWaveformSamples) return;

  function clearRemuxDelay(buffer) {
    const bytes = new Uint8Array(buffer);
    let frame = 0;
    if (bytes[0] === 73 && bytes[1] === 68 && bytes[2] === 51) {
      if (bytes.length < 10 || bytes.subarray(6, 10).some(value => value > 127)) return;
      frame = 10 + bytes[6] * 2097152 + bytes[7] * 16384 + bytes[8] * 128 + bytes[9];
    }
    if (frame + 4 > bytes.length || bytes[frame] !== 255 || (bytes[frame + 1] & 230) !== 226) return;
    const version = (bytes[frame + 1] >> 3) & 3;
    if (version === 1) return;
    const mono = (bytes[frame + 3] >> 6) === 3;
    const tag = frame + 4 + (version === 3 ? (mono ? 17 : 32) : (mono ? 9 : 17));
    const text = (start, count) => String.fromCharCode(...bytes.subarray(start, start + count));
    if (tag + 8 > bytes.length || !["Info", "Xing"].includes(text(tag, 4))) return;
    const flags = new DataView(buffer).getUint32(tag + 4);
    if (flags > 15) return;
    const encoder = tag + 8 + (flags & 1 ? 4 : 0) + (flags & 2 ? 4 : 0) +
      (flags & 4 ? 100 : 0) + (flags & 8 ? 4 : 0);
    if (encoder + 24 > bytes.length || text(encoder, 4) !== "Lavf") return;
    // The remuxer can carry file-start encoder delay into a later MP3 segment.
    // Keep end padding, but do not discard that delay from a mid-file decode.
    bytes[encoder + 21] = 0;
    bytes[encoder + 22] &= 15;
  }

  prototype.decodeSegment = async function (segment) {
    const remux = await global.PZ.av.remux(segment);
    segment.startOffset = Math.max(segment.startTime - remux.offset, 0);
    if (!remux.buffer) return null;
    if (segment.startTime > 0) clearRemuxDelay(remux.buffer);
    const audio = new global.AudioContext();
    try { return await audio.decodeAudioData(remux.buffer); }
    catch { return undefined; }
    finally { await audio.close(); }
  };

  // Samples per peak need not be integral: 44.1 kHz / 200 is 220.5.
  // Partition channel data at integer boundaries so every read is in range.
  prototype.analyzeBuffer = function (buffer, segment, record) {
    if (!buffer) return;
    const step = buffer.sampleRate / record.pointsPerSec;
    if (!(step > 0) || !Number.isFinite(step)) return;
    const timed = Number.isFinite(segment?.startTime) && segment.startTime >= 0 &&
      Number.isFinite(segment.duration) && segment.duration >= 0;
    const startTime = timed ? segment.startTime : record.minBuf.length / record.pointsPerSec;
    const startOffset = timed && Number.isFinite(segment.startOffset) ? Math.max(0, segment.startOffset) : 0;
    const duration = Math.min(Math.max(0, buffer.length / buffer.sampleRate - startOffset),
      timed ? segment.duration : Math.floor(buffer.length / step) / record.pointsPerSec);
    if (!duration) return;
    // Remuxed segments contain packet padding and may start before the request.
    // Place only the requested interval at its absolute time, never append padding.
    const offset = Math.floor(startTime * record.pointsPerSec);
    const endPoint = Math.ceil((startTime + duration) * record.pointsPerSec - 1e-7);
    const length = Math.max(record.minBuf.length, endPoint);
    const low = new Int8Array(length), high = new Int8Array(length);
    low.set(record.minBuf); high.set(record.maxBuf);
    record.minBuf = low; record.maxBuf = high;
    const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
    if (!channels.length) return;
    const weight = 1 / channels.length;
    for (let point = offset; point < endPoint; point++) {
      let min = 0, max = 0;
      const start = Math.max(0, Math.floor((startOffset + Math.max(0, point / record.pointsPerSec - startTime)) * buffer.sampleRate));
      const end = Math.min(buffer.length, Math.floor((startOffset + Math.min(duration, (point + 1) / record.pointsPerSec - startTime)) * buffer.sampleRate));
      for (let sample = start; sample < end; sample++) {
        let value = 0;
        for (const channel of channels) value += channel[sample] * weight;
        min = Math.min(min, value); max = Math.max(max, value);
      }
      low[point] = Math.min(low[point], 127 * min);
      high[point] = Math.max(high[point], 127 * max);
    }
  };
  // CM3's AV decoder is shared by every timeline. Separate per-window
  // queues can replace its worker while another waveform still uses it.
  const analyses = new WeakMap();
  let pending = Promise.resolve();
  prototype.analyzeMedia = function (asset) {
    if (!asset) return Promise.resolve();
    let analysis = analyses.get(asset);
    if (!analysis) {
      const record = { pointsPerSec: 200, minBuf: new Int8Array(0), maxBuf: new Int8Array(0) };
      analysis = { record, promise: null };
      this.bufferCache.set(asset, record);
      analysis.promise = pending.then(() => this.analyze(asset)).catch(error => {
        console.warn("[Zoidium] Waveform analysis failed", error);
      });
      analyses.set(asset, analysis);
      pending = analysis.promise;
    } else this.bufferCache.set(asset, analysis.record);
    const loading = analysis.promise.then(() => {
      if (this.analyzeLoading === loading) this.analyzeLoading = null;
    });
    this.analyzeLoading = loading;
    return loading;
  };
  prototype.__zoidiumWaveformSamples = true;
})(window);
