"use strict";

const { chooseCodecs, frameCount, frameTiming, projectFrame, SAMPLE_RATE } = require("./export-math.js");
const { createStorage } = require("./stream-target.js");
const { createAudioMixer, hasAudio } = require("./audio-mix.js");

function createJob(scope, PZ, exporter, loadBunny) {
  let cancelled = false;
  let output = null;
  let cancellation = null;
  function check() {
    if (cancelled) throw new DOMException("MP4 export cancelled.", "AbortError");
  }
  return {
    cancel() {
      cancelled = true;
      if (output) cancellation ||= output.cancel().catch(() => {});
    },
    async run() {
      let storage = null, mixer = null;
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
          format: new bunny.Mp4OutputFormat({ fastStart: "fragmented", minimumFragmentDuration: 1 }),
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
        let audio = null;
        if (codecs.audio) {
          audio = new bunny.AudioSampleSource({
            codec: codecs.audio.codec === "opus" ? "opus" : "aac",
            fullCodecString: codecs.audio.codec,
            quality: new bunny.Quality({ bitrate: codecs.audio.bitrate }),
          });
          output.addAudioTrack(audio);
          mixer = createAudioMixer(scope, exporter, check);
        }
        await output.start();
        check();
        const pixels = new Uint8Array(params.width * params.height * 4);
        const totalSamples = Math.floor(count / params.rate * SAMPLE_RATE);
        let audioOffset = 0;
        exporter.totalFrames = count;
        for (let index = 0; index < count; index++) {
          check();
          // Both tracks advance together so the muxer holds only a fragment.
          if (audio && audioOffset < totalSamples && (index + 1) / params.rate > audioOffset / SAMPLE_RATE) {
            const size = Math.min(SAMPLE_RATE, totalSamples - audioOffset);
            const buffer = await mixer.render(audioOffset, size);
            const samples = bunny.AudioSample.fromAudioBuffer(buffer, audioOffset / SAMPLE_RATE);
            try {
              for (const sample of samples) { check(); await audio.add(sample); }
            } finally {
              for (const sample of samples) sample.close();
            }
            audioOffset += size;
            exporter.samplesRendered = audioOffset;
          }
          check();
          exporter.frame = projectFrame(index, params.start, exporter.sequence.properties.rate.get(), params.rate);
          await exporter.getVideoFrame(pixels);
          check();
          if (padding) {
            padding.fillStyle = "black";
            padding.fillRect(0, 0, canvas.width, canvas.height);
            padding.drawImage(exporter.renderer.domElement, 0, 0);
          }
          const timing = frameTiming(index, params.rate);
          await video.add(timing.timestamp / 1000000, timing.duration / 1000000);
          // Yield even if the encoder immediately accepts this frame, so the
          // native Cancel/back button remains responsive on small projects.
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
        check();
        await output.finalize();
        check();
        return await storage.finish();
      } catch (error) {
        if (cancelled) throw new DOMException("MP4 export cancelled.", "AbortError");
        if (error?.name === "QuotaExceededError" || error instanceof RangeError || /out of memory/i.test(error?.message || "")) {
          throw new Error("MP4 ran out of memory or temporary storage. Reduce the output size or close other projects and try again.");
        }
        throw error;
      } finally {
        if (output && output.state !== "finalized") {
          cancellation ||= output.cancel().catch(() => {});
          await cancellation;
        }
        await mixer?.dispose();
        await storage?.dispose();
      }
    },
  };
}

module.exports = { createJob };
