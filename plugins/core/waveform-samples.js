(function (global) {
  "use strict";
  const prototype = global.PZ?.ui?.waveform?.prototype;
  if (!prototype || prototype.__zoidiumWaveformSamples) return;

  // Samples per peak need not be integral: 44.1 kHz / 200 is 220.5.
  // Partition channel data at integer boundaries so every read is in range.
  prototype.analyzeBuffer = function (buffer, _segment, record) {
    if (!buffer) return;
    const step = buffer.sampleRate / record.pointsPerSec;
    if (!(step > 0) || !Number.isFinite(step)) return;
    const count = Math.floor(buffer.length / step), offset = record.minBuf.length;
    const low = new Int8Array(offset + count), high = new Int8Array(offset + count);
    low.set(record.minBuf); high.set(record.maxBuf);
    record.minBuf = low; record.maxBuf = high;
    const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
    if (!channels.length) return;
    const weight = 1 / channels.length;
    for (let point = 0; point < count; point++) {
      let min = 0, max = 0;
      const start = Math.floor(point * step), end = Math.min(buffer.length, Math.floor((point + 1) * step));
      for (let sample = start; sample < end; sample++) {
        let value = 0;
        for (const channel of channels) value += channel[sample] * weight;
        min = Math.min(min, value); max = Math.max(max, value);
      }
      low[offset + point] = 127 * min;
      high[offset + point] = 127 * max;
    }
  };
  prototype.__zoidiumWaveformSamples = true;
})(window);
