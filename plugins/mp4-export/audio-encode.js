"use strict";

const { SAMPLE_RATE, isMemoryError } = require("./export-math.js");
const AAC_PREROLL = 4096;
const PROBE_IMPULSE = 8192;
const PROBE_LENGTH = 24576;

function packetTiming(timestamp, duration, shift, end) {
  const start = Math.round(timestamp * SAMPLE_RATE) / SAMPLE_RATE - shift;
  if (start >= end) return null;
  return { timestamp: start, duration: Math.min(duration, end - start) };
}

function planarData(scope, left, right, timestamp) {
  const data = new Float32Array(left.length * 2);
  data.set(left);
  data.set(right, left.length);
  return new scope.AudioData({
    format: "f32-planar", data, sampleRate: SAMPLE_RATE, numberOfChannels: 2,
    numberOfFrames: left.length, timestamp: Math.round(timestamp * 1000000),
  });
}

// AAC's WebCodecs metadata need not expose priming. Measure the selected
// encoder rather than guessing a delay from the browser or operating system.
async function measureAacDelay(scope, config, signal) {
  let encoder, decoder, failure, decoderConfig;
  const packets = [];
  let peak = 0, peakSample = -1;
  const close = () => {
    if (encoder?.state !== "closed") encoder?.close();
    if (decoder?.state !== "closed") decoder?.close();
  };
  signal.addEventListener("abort", close, { once: true });
  try {
    signal.throwIfAborted();
    encoder = new scope.AudioEncoder({
      output(chunk, meta) { packets.push(chunk); decoderConfig ||= meta?.decoderConfig; },
      error(error) { failure = error; },
    });
    encoder.configure(config);
    const impulse = new Float32Array(PROBE_LENGTH);
    impulse[PROBE_IMPULSE] = 0.9;
    const sample = planarData(scope, impulse, impulse, 0);
    try { encoder.encode(sample); } finally { sample.close(); }
    await encoder.flush();
    signal.throwIfAborted();
    if (failure) throw failure;
    if (!decoderConfig) throw new Error("AAC decoder metadata is missing.");
    decoder = new scope.AudioDecoder({
      output(frame) {
        try {
          const pcm = new Float32Array(frame.numberOfFrames);
          frame.copyTo(pcm, { planeIndex: 0, format: "f32-planar" });
          for (let i = 0; i < pcm.length; i++) {
            if (Math.abs(pcm[i]) > peak) {
              peak = Math.abs(pcm[i]);
              peakSample = Math.round(frame.timestamp * SAMPLE_RATE / 1000000) + i;
            }
          }
        } finally { frame.close(); }
      },
      error(error) { failure = error; },
    });
    decoder.configure(decoderConfig);
    for (const packet of packets) decoder.decode(packet);
    await decoder.flush();
    signal.throwIfAborted();
    if (failure) throw failure;
    const delay = peakSample - PROBE_IMPULSE;
    if (peak < 0.05 || delay < 0 || delay > 8192) throw new Error("AAC timing calibration failed.");
    return delay;
  } catch (error) {
    signal.throwIfAborted();
    if (isMemoryError(error)) throw error;
    throw new Error("MP4 could not verify AAC audio timing in this browser. Try the desktop app or MKV/WebM.", { cause: error });
  } finally {
    signal.removeEventListener("abort", close);
    close();
  }
}

async function createAudioEncoding(scope, bunny, config, end, signal) {
  const aac = config.codec !== "opus";
  const delay = aac ? await measureAacDelay(scope, config, signal) : 0;
  const preroll = aac ? AAC_PREROLL : 0;
  const shift = (delay + preroll) / SAMPLE_RATE;
  const source = new bunny.EncodedAudioPacketSource(aac ? "aac" : "opus");
  let failure = null;
  let pending = Promise.resolve();
  let accepted = 0;
  const encoder = new scope.AudioEncoder({
    output(chunk, metadata) {
      const packet = bunny.EncodedPacket.fromEncodedChunk(chunk);
      const duration = chunk.duration == null ? (aac ? 1024 / SAMPLE_RATE : 0.02) : packet.duration;
      const timing = packetTiming(packet.timestamp, duration, shift, end);
      if (!timing) return;
      accepted++;
      pending = pending.then(() => source.add(packet.clone(timing), metadata)).catch((error) => { failure = error; });
    },
    error(error) { failure = error; },
  });
  function close() {
    if (encoder.state !== "closed") encoder.close();
  }
  function check() {
    signal.throwIfAborted();
    if (failure) throw failure;
  }
  signal.addEventListener("abort", close, { once: true });
  try { encoder.configure(config); } catch (error) {
    signal.removeEventListener("abort", close); close(); throw error;
  }
  return {
    source,
    async add(buffer, offset) {
      check();
      if (offset === 0 && preroll) {
        const silence = new Float32Array(preroll);
        const sample = planarData(scope, silence, silence, 0);
        try { encoder.encode(sample); } finally { sample.close(); }
      }
      const sample = planarData(scope, buffer.getChannelData(0), buffer.getChannelData(1), (offset + preroll) / SAMPLE_RATE);
      try { encoder.encode(sample); } finally { sample.close(); }
      // Bound queued PCM while allowing video to catch up with the next
      // audio fragment. Flushing here would add padding between segments.
      while (encoder.encodeQueueSize > 2) {
        await new Promise((resolve) => setTimeout(resolve, 0));
        check();
      }
      check();
    },
    async finish() {
      check();
      await encoder.flush();
      await pending;
      check();
      if (!accepted) throw new Error("The MP4 audio encoder produced no packets.");
      source.close();
    },
    dispose() {
      signal.removeEventListener("abort", close);
      close();
    },
  };
}

module.exports = { AAC_PREROLL, createAudioEncoding, measureAacDelay, packetTiming };
