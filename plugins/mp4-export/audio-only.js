"use strict";

const { SAMPLE_RATE, frameCount, firstSupported, isMemoryError } = require("./export-math.js");
const { createAudioMixer, planAudio } = require("./audio-mix.js");
const { createAudioEncoding } = require("./audio-encode.js");
const { createStorage } = require("./stream-target.js");

const WAV = "audio_wav", M4A = "audio_m4a";
function isAudio(params) { return params?.format === WAV || params?.format === M4A; }
function wavHeader(samples) {
  const bytes = samples * 4;
  if (!Number.isSafeInteger(samples) || samples < 0 || bytes > 0xffffffff - 36) throw new Error("The WAV file is too large.");
  const data = new ArrayBuffer(44), view = new DataView(data);
  const write = (offset, value) => { for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i)); };
  write(0, "RIFF"); view.setUint32(4, bytes + 36, true); write(8, "WAVEfmt ");
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 2, true);
  view.setUint32(24, SAMPLE_RATE, true); view.setUint32(28, SAMPLE_RATE * 4, true);
  view.setUint16(32, 4, true); view.setUint16(34, 16, true); write(36, "data"); view.setUint32(40, bytes, true);
  return data;
}
function wavSamples(buffer) {
  const left = buffer.getChannelData(0), right = buffer.getChannelData(1);
  const data = new ArrayBuffer(left.length * 4), view = new DataView(data);
  for (let i = 0; i < left.length; i++) for (let channel = 0; channel < 2; channel++) {
    const value = Math.max(-1, Math.min(1, (channel ? right : left)[i] || 0));
    view.setInt16(i * 4 + channel * 2, Math.round(value * (value < 0 ? 32768 : 32767)), true);
  }
  return data;
}
function createAudioJob(scope, exporter, loadBunny) {
  const controller = new AbortController();
  let output = null, cancellation = null;
  const check = () => controller.signal.throwIfAborted();
  return {
    cancel() { controller.abort(); if (output) cancellation ||= output.cancel().catch(() => {}); },
    async run() {
      let mixer, audio, storage;
      try {
        const params = exporter.params, count = frameCount(params.length);
        const total = Math.floor(count / params.rate * SAMPLE_RATE);
        const probeAudioTrack = scope.ZoidiumVideoSeekPolicy?.probeAudioTrack;
        const plan = await planAudio(exporter.sequence, probeAudioTrack);
        check();
        mixer = createAudioMixer(scope, exporter, check, controller.signal, { silent: plan.silent, probeAudioTrack });
        const wav = params.format === WAV, parts = wav ? [wavHeader(total)] : null;
        if (!wav) {
          const config = await firstSupported(scope.AudioEncoder, [{ codec: "mp4a.40.2", sampleRate: SAMPLE_RATE, numberOfChannels: 2, bitrate: 128000 }]);
          if (!config) throw new Error("AAC encoding is unavailable in this browser. Select .wav instead.");
          check();
          const bunny = loadBunny();
          storage = await createStorage(scope, bunny, { signal: controller.signal, hasAudio: true });
          output = new bunny.Output({ format: new bunny.Mp4OutputFormat({ fastStart: false }), target: storage.target });
          try {
            audio = await createAudioEncoding(scope, bunny, config, count / params.rate, controller.signal);
          } catch (error) {
            check();
            if (isMemoryError(error)) throw error;
            throw new Error("AAC encoding could not be started in this browser. Select .wav instead.", { cause: error });
          }
          output.addAudioTrack(audio.source);
          await output.start();
        }
        exporter.totalFrames = total; exporter.framesRendered = 0;
        for (let offset = 0; offset < total;) {
          check();
          const size = Math.min(SAMPLE_RATE, total - offset);
          const buffer = await mixer.render(offset, size);
          check();
          if (wav) parts.push(wavSamples(buffer)); else await audio.add(buffer, offset);
          offset += size; exporter.framesRendered = offset;
          await new Promise(resolve => setTimeout(resolve, 0));
        }
        check();
        if (wav) return new Blob(parts, { type: "audio/wav" });
        await audio.finish(); await output.finalize(); check();
        const result = await storage.finish();
        return new Blob([result], { type: "audio/mp4" });
      } finally {
        if (output && output.state !== "finalized") { cancellation ||= output.cancel().catch(() => {}); await cancellation; }
        for (const resource of [audio, mixer, storage]) try { await resource?.dispose(); } catch (error) { console.warn("[Zoidium] Audio export cleanup failed: " + error.message); }
      }
    },
  };
}
module.exports = { WAV, M4A, isAudio, wavHeader, wavSamples, createAudioJob };
