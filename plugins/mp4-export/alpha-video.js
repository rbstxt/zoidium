"use strict";

const { frameCount, frameTiming, projectFrame, SAMPLE_RATE, firstSupported, videoBitrate } = require("./export-math.js");
const { createAudioEncoding } = require("./audio-encode.js");
const { createAudioMixer, planAudio } = require("./audio-mix.js");
const { createStorage } = require("./stream-target.js");

const UNAVAILABLE = "VP8 alpha encoding is unavailable in this browser.";
const MISSING_ALPHA = "The VP8 encoder did not produce an alpha plane.";

async function probeAlphaVideo(scope, loadBunny) {
  if (!scope.VideoEncoder || !scope.VideoFrame) return false;
  let output;
  try {
    const bunny = loadBunny();
    const canvas = scope.document.createElement("canvas");
    canvas.width = canvas.height = 32;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "rgba(255, 0, 0, 0.5)";
    ctx.fillRect(0, 0, 16, 32);
    let alpha = false;
    const video = new bunny.CanvasSource(canvas, {
      codec: "vp8", alpha: "keep", bitrate: 100000,
      onEncodedPacket(packet) { alpha ||= Boolean(packet.sideData.alpha?.length); },
    });
    output = new bunny.Output({ format: new bunny.WebMOutputFormat(), target: new bunny.NullTarget() });
    output.addVideoTrack(video, { frameRate: 30, canBeTransparent: true });
    await output.start();
    await video.add(0, 1 / 30);
    await output.finalize();
    return alpha;
  } catch (_error) {
    return false;
  } finally {
    if (output && output.state !== "finalized") await output.cancel().catch(() => {});
  }
}

async function renderAlphaVideo(scope, PZ, exporter, bunny, signal) {
  const { params, sequence } = exporter;
  const count = frameCount(params.length);
  const duration = count / params.rate;
  const mkv = params.format === "mkv_vp8_opus";
  const format = mkv ? new bunny.MkvOutputFormat() : new bunny.WebMOutputFormat();
  const bitrate = videoBitrate(params, PZ.av.profiles);
  const probeAudioTrack = scope.ZoidiumVideoSeekPolicy?.probeAudioTrack;
  const check = () => { signal.throwIfAborted(); exporter.checkExportContext(); };
  let storage, output, mixer, audio, cancellation;
  const cancel = () => {
    if (output && output.state !== "finalized") cancellation ||= output.cancel().catch(() => {});
  };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    check();
    if (!await bunny.canEncodeVideo("vp8", {
      width: params.width, height: params.height, frameRate: params.rate, bitrate,
    })) {
      throw new Error("VP8 alpha encoding is unavailable at this resolution or frame rate.");
    }
    const audioPlan = await planAudio(sequence, probeAudioTrack);
    check();
    const audioConfig = audioPlan.present && await firstSupported(scope.AudioEncoder, [{
      codec: "opus", sampleRate: SAMPLE_RATE, numberOfChannels: 2,
      bitrate: 64000 * (PZ.av.profiles[params.quality] || PZ.av.profiles[2]).abr,
    }]);
    if (audioPlan.present && !audioConfig) throw new Error("Opus audio encoding is unavailable in this browser.");
    storage = await createStorage(scope, bunny, { signal, formatName: mkv ? "MKV" : "WebM", mimeType: format.mimeType });
    check();
    output = new bunny.Output({ format, target: storage.target });
    let wroteAlpha = false;
    // WebCodecs reads straight color from the premultiplied canvas. Mediabunny
    // encodes a second VP8 stream for alpha when it splits each frame.
    const video = new bunny.CanvasSource(exporter.renderer.domElement, {
      codec: "vp8", alpha: "keep", bitrate,
      onEncodedPacket(packet) { wroteAlpha ||= Boolean(packet.sideData.alpha?.length); },
    });
    output.addVideoTrack(video, { frameRate: params.rate, canBeTransparent: true });
    if (audioConfig) {
      audio = await createAudioEncoding(scope, bunny, audioConfig, duration, signal);
      output.addAudioTrack(audio.source);
      mixer = createAudioMixer(scope, exporter, check, signal, { silent: audioPlan.silent, probeAudioTrack });
    }
    check();
    await output.start();
    const rate = sequence.properties.rate.get();
    const totalSamples = Math.floor(duration * SAMPLE_RATE);
    let audioOffset = 0;
    exporter.totalFrames = count;
    for (let index = 0; index < count; index++) {
      check();
      if (audio && audioOffset < totalSamples && (index + 1) / params.rate > audioOffset / SAMPLE_RATE) {
        const size = Math.min(SAMPLE_RATE, totalSamples - audioOffset);
        const buffer = await mixer.render(audioOffset, size);
        await audio.add(buffer, audioOffset);
        audioOffset += size;
        exporter.samplesRendered = audioOffset;
      }
      check();
      exporter.frame = projectFrame(index, params.start, rate, params.rate);
      await exporter.renderVideoFrame();
      check();
      const timing = frameTiming(index, params.rate);
      await video.add(timing.timestamp / 1000000, timing.duration / 1000000);
      exporter.__zoidiumPendingFrame = null;
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    check();
    await audio?.finish();
    await output.finalize();
    check();
    if (!wroteAlpha) throw new Error(MISSING_ALPHA);
    return await storage.finish();
  } finally {
    signal.removeEventListener("abort", cancel);
    cancel();
    await cancellation;
    const cleanups = [() => audio?.dispose(), () => mixer?.dispose(), () => storage?.dispose()];
    for (const dispose of cleanups) {
      try { await dispose(); }
      catch (error) { console.warn("[Zoidium] Alpha export cleanup failed:", error); }
    }
  }
}

function installAlphaVideo(PZ, loadBunny, onDispose, scope = globalThis) {
  const alphaFormat = PZ.zoidium?.alphaFormat;
  const prototype = PZ.ui?.export?.device?.prototype;
  const original = prototype?.render;
  if (!alphaFormat || typeof original !== "function") return () => false;
  let pending;
  let active = 0;
  const provider = {
    status: undefined,
    probe() {
      return pending ||= probeAlphaVideo(scope, loadBunny).then(status => { provider.status = status; });
    },
  };
  PZ.zoidium.alphaVideo = provider;
  function render(exporter) {
    if (alphaFormat(exporter.params) !== "video") return original.apply(this, arguments);
    active++;
    return Promise.resolve().then(async () => {
      let signal;
      try {
        if (!exporter.__zoidiumAlphaExport) throw new Error(UNAVAILABLE);
        exporter.checkExportContext();
        signal = exporter.exportPolicy.signal;
        await provider.probe();
        signal.throwIfAborted();
        if (!provider.status) throw new Error(UNAVAILABLE);
        return await renderAlphaVideo(scope, PZ, exporter, loadBunny(), signal);
      } catch (error) {
        if (signal?.reason?.name === "AbortError") return new Promise(() => {});
        try { exporter.failExportFrame?.(error); } catch (_error) { /* Keep the original error. */ }
        // The native error page interpolates its message as HTML.
        throw new Error(String(error?.message || error).replace(/[&<>]/g, char =>
          ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[char]));
      } finally {
        active--;
      }
    });
  }
  prototype.render = render;
  onDispose(() => {
    if (PZ.zoidium.alphaVideo === provider) delete PZ.zoidium.alphaVideo;
    if (prototype.render === render) prototype.render = original;
  });
  return () => active > 0;
}

module.exports = { installAlphaVideo, probeAlphaVideo };
