"use strict";

const { SAMPLE_RATE } = require("./export-math.js");
const { decodeAudio } = require("./audio-decode.js");

function hasAudio(sequence) {
  return (sequence.audioSchedules || []).some((schedule) => schedule.items?.length > 0);
}

function createAudioMixer(scope, exporter, check, signal) {
  let decoder = null;
  let decoded = new Map();
  return {
    async render(offset, count) {
      check();
      const start = Math.floor(exporter.params.start / exporter.sequence.properties.rate.get() * SAMPLE_RATE);
      const segments = exporter.analyzeSegment(start + offset, count);
      const current = new Map();
      for (const segment of segments) {
        check();
        const media = segment.media;
        if (!media.file) continue; // Native mixer skips missing audio assets.
        let buffer = current.get(media) || decoded.get(media);
        if (!buffer) {
          decoder ||= new scope.AudioContext({ sampleRate: SAMPLE_RATE });
          buffer = await decodeAudio(scope, decoder, media.file, signal);
          check();
        }
        current.set(media, buffer);
        segment.buffer = buffer;
        // Native remuxAudio trims a source before decoding. With a complete
        // decoded source, the same native mixer uses its absolute source offset.
        // renderAudioSegment divides startOffset by playbackRate. A decoded
        // complete source must begin at offset seconds even for speed changes.
        segment.startOffset = segment.offset * segment.playbackRate;
      }
      decoded = current;
      const result = await exporter.renderAudioSegment(segments, start + offset, count);
      check();
      return result;
    },
    async dispose() {
      decoded.clear();
      if (decoder && decoder.state !== "closed") await decoder.close();
    },
  };
}

module.exports = { createAudioMixer, hasAudio };
