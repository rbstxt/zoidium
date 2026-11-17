"use strict";

const { chooseCodecs, frameCount, frameTiming, isMemoryError, projectFrame, SAMPLE_RATE } = require("./export-math.js");
const { createStorage } = require("./stream-target.js");
const { createAudioMixer, hasAudio, planAudio } = require("./audio-mix.js");
const { createAudioEncoding } = require("./audio-encode.js");
const { createVideoSource } = require("./video-source.js");
const { createPacketTagger } = require("./avc-vui.js");

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
      let storage = null, mixer = null, audio = null, video = null;
      try {
        const params = exporter.params;
        const count = frameCount(params.length);
        // Existing projects can hold audio clips for video-only files. Probe
        // the containers once, so those clips are skipped instead of failing
        // the export, and a project with only such clips exports no audio
        // track, exactly like a project without audio. A project without any
        // audio clip keeps its exact capability-probe timing.
        const probeAudioTrack = scope.ZoidiumVideoSeekPolicy?.probeAudioTrack;
        const audioPlan = hasAudio(exporter.sequence)
          ? await planAudio(exporter.sequence, probeAudioTrack)
          : { present: false, silent: new Set() };
        check();
        const codecs = await chooseCodecs(scope, params, PZ.av.profiles, audioPlan.present);
        check();
        const bunny = loadBunny();
        storage = await createStorage(scope, bunny, {
          signal: controller.signal,
          // The finished-size check needs the encoder target and the duration.
          videoBitrate: codecs.video.bitrate,
          duration: count / params.rate,
          hasAudio: Boolean(codecs.audio),
        });
        check();
        output = new bunny.Output({
          // Metadata at the end keeps memory bounded and gives the audio edit
          // list a known duration, including priming and final packet trimming.
          format: new bunny.Mp4OutputFormat({ fastStart: false }),
          target: storage.target,
        });
        const canvas = exporter.renderer.domElement;
        const tagger = createPacketTagger((message) => console.warn(message));
        video = createVideoSource(scope, bunny, {
          canvas,
          codec: codecs.video.codec,
          width: codecs.video.width,
          height: codecs.video.height,
          bitrate: codecs.video.bitrate,
          onEncodedPacket: tagger.handle,
          // A lost context must be caught after the last draw and before the
          // encoder accepts the frame.
          beforeSubmit: () => exporter.checkExportContext?.("before encoder submission"),
        });
        output.addVideoTrack(video.source, { frameRate: params.rate });
        if (codecs.audio) {
          audio = await createAudioEncoding(scope, bunny, codecs.audio, count / params.rate, controller.signal);
          output.addAudioTrack(audio.source);
          mixer = createAudioMixer(scope, exporter, check, controller.signal,
            { silent: audioPlan.silent, probeAudioTrack });
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
          const timing = frameTiming(index, params.rate);
          await video.add(timing.timestamp / 1000000, timing.duration / 1000000, canvas);
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
          ["video", () => video?.dispose()],
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
