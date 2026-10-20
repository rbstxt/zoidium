"use strict";

const MP4_FORMAT = "mp4_h264";
const SAMPLE_RATE = 48000;

function isMemoryError(error) {
  return error?.name === "QuotaExceededError" || error instanceof RangeError ||
    /out of memory|allocation failed|memory allocation|cannot enlarge memory/i.test(error?.message || "");
}

function isMp4(params) {
  return params?.format === MP4_FORMAT;
}

function frameTiming(index, rate) {
  const timestamp = Math.round(index * 1000000 / rate);
  return { timestamp, duration: Math.round((index + 1) * 1000000 / rate) - timestamp };
}

function frameCount(length) {
  if (!Number.isFinite(length) || length <= 0) throw new Error("The project has no frames to export.");
  return Math.ceil(length);
}

function projectFrame(index, start, projectRate, outputRate) {
  return start + index * projectRate / outputRate;
}

function evenDimension(size) {
  if (!Number.isInteger(size) || size < 1) throw new Error("MP4 needs a positive output size.");
  return size + size % 2;
}

function videoBitrate(params, profiles) {
  const profile = profiles[params.quality] || profiles[2];
  const scale = [1, 2, 4, 8].includes(params.bitrateScale) ? params.bitrateScale : 1;
  return Math.round(params.width / 640 * (params.height / 360) * 1000000 *
    (params.rate > 30 ? 1.5 : 1) * profile.bitrate * scale);
}

async function firstSupported(Encoder, configs) {
  if (!Encoder?.isConfigSupported) return null;
  for (const config of configs) {
    try {
      if ((await Encoder.isConfigSupported(config)).supported) return config;
    } catch (error) {
      if (isMemoryError(error)) throw error;
      // A rejected profile is a capability miss; try the next explicit config.
    }
  }
  return null;
}

async function chooseCodecs(scope, params, profiles, haveAudio) {
  const common = {
    width: evenDimension(params.width), height: evenDimension(params.height),
    bitrate: videoBitrate(params, profiles), framerate: params.rate,
    latencyMode: "quality", avc: { format: "avc" },
  };
  // Probe high before main and baseline. Level 5.2 covers 4K60; level 6.2
  // permits larger output rates on encoders that implement it.
  const video = await firstSupported(scope.VideoEncoder,
    ["640034", "64003e", "640033", "64002a", "4d0034", "4d002a", "420034", "42002a"].map(
      (profile) => ({ ...common, codec: "avc1." + profile }),
    ));
  if (!video) throw new Error(
    "MP4 is unavailable in this browser because it cannot encode H.264 at this size and frame rate. Try a smaller size, Google Chrome, the desktop app, or MKV/WebM.",
  );
  let audio = null;
  if (haveAudio) {
    audio = await firstSupported(scope.AudioEncoder, ["mp4a.40.2", "opus"].map(
      (codec) => ({ codec, sampleRate: SAMPLE_RATE, numberOfChannels: 2, bitrate: 128000 }),
    ));
    if (!audio) throw new Error(
      "MP4 audio is unavailable in this browser because it cannot encode AAC or Opus. Try Google Chrome, the desktop app, or MKV/WebM.",
    );
  }
  return { video, audio };
}

module.exports = {
  MP4_FORMAT, SAMPLE_RATE, chooseCodecs, evenDimension, firstSupported,
  frameCount, frameTiming, isMemoryError, isMp4, projectFrame, videoBitrate,
};
