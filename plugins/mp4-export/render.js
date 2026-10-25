"use strict";

const { chooseCodecs, frameCount, frameTiming, isMemoryError, projectFrame, SAMPLE_RATE } = require("./export-math.js");
const { createStorage } = require("./stream-target.js");
const { createAudioMixer, hasAudio } = require("./audio-mix.js");
const { createAudioEncoding } = require("./audio-encode.js");

function createJob(scope, PZ, exporter, loadBunny) {
  let cancelled = false;
  let output = null;
  let cancellation = null;
  const controller = new AbortController();
  function check() {
    exporter.checkExportContext?.();
    if (cancelled) throw new DOMException("MP4 export cancelled.", "AbortError");
  }
  return {
    cancel() {
      cancelled = true;
      controller.abort();
      if (output) cancellation ||= output.cancel().catch(() => {});
    },
    async run() {
      let storage = null, mixer = null, audio = null;
      try {
        const params = exporter.params;
        const count = frameCount(params.length);
        const audioPresent = hasAudio(exporter.sequence);
        const codecs = await chooseCodecs(scope, params, PZ.av.profiles, audioPresent);
        check();
        const bunny = loadBunny();
        storage = await createStorage(scope, bunny);
        check();
        output = new bunny.Output({
          // Metadata at the end keeps memory bounded and gives the audio edit
          // list a known duration, including priming and final packet trimming.
          format: new bunny.Mp4OutputFormat({ fastStart: false }),
          target: storage.target,
        });
        let canvas = exporter.renderer.domElement;
        let padding = null;
        if (canvas.width !== codecs.video.width || canvas.height !== codecs.video.height) {
          const padded = scope.document.createElement("canvas");
          padded.width = codecs.video.width;
          padded.height = codecs.video.height;
          padding = padded.getContext("2d");
          canvas = padded;
        }
        const video = new bunny.CanvasSource(canvas, {
          codec: "avc", fullCodecString: codecs.video.codec,
          quality: new bunny.Quality({ bitrate: codecs.video.bitrate }),
          latencyMode: "quality", keyFrameInterval: 2,
        });
        output.addVideoTrack(video, { frameRate: params.rate });
        if (codecs.audio) {
          audio = await createAudioEncoding(scope, bunny, codecs.audio, count / params.rate, controller.signal);
          output.addAudioTrack(audio.source);
          mixer = createAudioMixer(scope, exporter, check, controller.signal);
        }
        await output.start();
        check();
        const totalSamples = Math.floor(count / params.rate * SAMPLE_RATE);
        let audioOffset = 0;
        exporter.totalFrames = count;
        for (let index = 0; index < count; index++) {
          check();
          // Both tracks advance together so the muxer holds only a fragment.
          if (audio && audioOffset < totalSamples && (index + 1) / params.rate > audioOffset / SAMPLE_RATE) {
            const size = Math.min(SAMPLE_RATE, totalSamples - audioOffset);
            const buffer = await mixer.render(audioOffset, size);
            await audio.add(buffer, audioOffset);
            audioOffset += size;
            exporter.samplesRendered = audioOffset;
          }
          check();
          exporter.frame = projectFrame(index, params.start, exporter.sequence.properties.rate.get(), params.rate);
          await exporter.renderVideoFrame();
          check();
          if (padding) {
            padding.fillStyle = "black";
            padding.fillRect(0, 0, canvas.width, canvas.height);
            padding.drawImage(exporter.renderer.domElement, 0, 0);
          }
          exporter.checkExportContext?.("before encoder submission");
          const timing = frameTiming(index, params.rate);
          await video.add(timing.timestamp / 1000000, timing.duration / 1000000);
          exporter.__zoidiumPendingFrame = null;
          // Yield even if the encoder immediately accepts this frame, so the
          // native Cancel/back button remains responsive on small projects.
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
        check();
        await audio?.finish();
        await output.finalize();
        check();
        return await storage.finish();
      } catch (error) {
        const failure = cancelled ? new DOMException("MP4 export cancelled.", "AbortError") : error;
        try { exporter.failExportFrame?.(failure); } catch (_cleanupError) { /* Preserve the export failure. */ }
        if (cancelled) throw failure;
        if (isMemoryError(error)) {
          throw new Error("MP4 ran out of memory or temporary storage. Reduce the output size or close other projects and try again.");
        }
        throw error;
      } finally {
        if (output && output.state !== "finalized") {
          cancellation ||= output.cancel().catch(() => {});
          await cancellation;
        }
        // Cleanup failures must never replace the export result: a file that
        // was written stays a success even when a dispose step later fails.
        // Every step still runs, and each failure is reported once.
        const cleanups = [
          ["audio", () => audio?.dispose()],
          ["mixer", () => mixer?.dispose()],
          ["storage", () => storage?.dispose()],
        ];
        for (const [name, dispose] of cleanups) {
          try {
            await dispose();
          } catch (cleanupError) {
            console.warn("[Zoidium] MP4 export cleanup failed (" + name + "): " +
              (cleanupError && cleanupError.message ? cleanupError.message : String(cleanupError)));
          }
        }
      }
    },
  };
}

module.exports = { createJob };
