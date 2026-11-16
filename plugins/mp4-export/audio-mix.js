"use strict";

const { SAMPLE_RATE } = require("./export-math.js");
const { decodeAudio } = require("./audio-decode.js");

function hasAudio(sequence) {
  return (sequence.audioSchedules || []).some((schedule) => schedule.items?.length > 0);
}

// The media each scheduled audio clip plays. Native schedule items carry it as
// item.media; an item shaped like a clip keeps it in the animated media
// property, read at the clip start. An item that yields no media leaves the
// plan undecided, so an unusual clip shape never drops a real audio stream.
function scheduledMedias(sequence) {
  const medias = new Set();
  let undecided = false;
  for (const schedule of sequence.audioSchedules || []) {
    if (!Array.isArray(schedule.items)) {
      if (schedule.items?.length > 0) undecided = true;
      continue;
    }
    for (const item of schedule.items) {
      let media = item && item.media && typeof item.media === "object" ? item.media : null;
      if (!media) try {
        const property = item && item.properties && item.properties.media;
        media = property && typeof property.get === "function" ? property.get(item.start || 0) : property;
      } catch (_error) {
        media = null;
      }
      const usable = media && typeof media === "object";
      if (usable) medias.add(media);
      else undecided = true;
    }
  }
  return { medias, undecided };
}

// Decides whether the export needs an audio track at all, and which sources
// carry no audio stream. A project that only references video-only containers
// exports exactly like a project without audio: no audio track, no decode.
async function planAudio(sequence, probeAudioTrack) {
  const silent = new Set();
  if (!hasAudio(sequence)) return { present: false, silent };
  if (typeof probeAudioTrack !== "function") return { present: true, silent };
  const { medias, undecided } = scheduledMedias(sequence);
  let audible = 0;
  for (const media of medias) {
    let state = null;
    try {
      state = await probeAudioTrack(media.file);
    } catch (_error) {
      state = null;
    }
    if (state === false) silent.add(media);
    else audible += 1;
  }
  // Keep the audio track unless every identified source is positively silent.
  return { present: undecided || audible > 0, silent };
}

function createAudioMixer(scope, exporter, check, signal, plan = {}) {
  let decoder = null;
  let decoded = new Map();
  const silent = plan.silent instanceof Set ? plan.silent : new Set();
  const probe = plan.probeAudioTrack;
  async function carriesAudio(media) {
    if (silent.has(media)) return false;
    if (typeof probe !== "function") return true;
    let state = null;
    try {
      state = await probe(media.file);
    } catch (_error) {
      state = null;
    }
    if (state !== false) return true;
    silent.add(media);
    return false;
  }
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
        // A video-only source contributes silence, exactly like a muted clip.
        if (!(await carriesAudio(media))) continue;
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

module.exports = { createAudioMixer, hasAudio, planAudio, scheduledMedias };
