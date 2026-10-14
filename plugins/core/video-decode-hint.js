"use strict";

// Imported overlay footage (for example shockwave .mov files) is accepted by
// the native media import, but the probe in PZ.ui.media.prototype.loadVideo
// cannot decode every codec the container allows: ProRes 4444 with alpha and
// HEVC with alpha fail in Chrome/Brave/Windows builds, so the media item
// stays on "Loading..." with no explanation. The native probe has two gaps:
// it trusts canPlayType (which answers "" for video/quicktime even when the
// contained H.264 stream is playable, so playable .mov files never import),
// and it never listens for decode errors or bounds the wait, so an
// undecodable file either hangs the import promise forever or resolves to
// null and crashes PZ.media.load with a TypeError.
//
// This module wraps only loadVideo. The success path keeps the native probe
// sequence byte for byte (metadata, seek to 10% duration, thumbnail, clip
// fields), so supported videos load and render exactly as before. The only
// behavioral changes are: every video/* file is actually probed instead of
// trusting canPlayType, and a probe that fails by element error or by a
// bounded timeout warns once per asset through ZoidiumUI.notify and settles
// as an empty (audio-style) result so the import can continue. Audio files
// passed to loadVideo resolve through the normal zero-dimension path and
// never warn. Video layers and video textures do not share this loader (they
// play through PZ.schedule elements), so they need no handling here.
const DEFAULT_PROBE_TIMEOUT_MS = 15000;

function buildDecodeWarning(filename) {
  return {
    title: "Video cannot be decoded",
    message: "This browser cannot decode \"" + filename +
      "\" (for example ProRes or HEVC .mov). Convert it to WebM (VP9, keeps transparency)" +
      " or MP4 (H.264) and import it again.",
  };
}

function isAudioAsset(asset) {
  return Boolean(asset && asset.file && typeof asset.file.type === "string" &&
    asset.file.type.indexOf("audio/") === 0);
}

function warningKey(asset, filename) {
  if (asset && typeof asset.key === "string" && asset.key) return "key:" + asset.key;
  return "file:" + filename;
}

function displayName(asset) {
  if (asset && typeof asset.filename === "string" && asset.filename) return asset.filename;
  if (asset && typeof asset.key === "string" && asset.key) return asset.key;
  return "Unnamed video";
}

// Creates the loadVideo replacement. Dependencies are injected so node tests
// can drive the probe with a fake video element and fake timers:
// - document: needs createElement("video").
// - schedule/unschedule: setTimeout/clearTimeout equivalents.
// - generateThumbnail: (element, width, height) => Promise<blob>.
// - notify: (detail) => void, the ZoidiumUI.notify path.
// - probeTimeoutMs: bound for a local file that never reports metadata.
function createLoadVideoWithDecodeHint(dependencies) {
  const document = dependencies.document;
  const schedule = dependencies.schedule;
  const unschedule = dependencies.unschedule;
  const generateThumbnail = dependencies.generateThumbnail;
  const notify = dependencies.notify;
  const probeTimeoutMs = dependencies.probeTimeoutMs || DEFAULT_PROBE_TIMEOUT_MS;
  const warned = new Set();
  let disposed = false;

  function markDisposed() {
    disposed = true;
  }

  async function onSeeked(video, asset, finish) {
    const duration = video.duration;
    const frames = Math.floor(30 * duration);
    const width = video.videoWidth;
    const height = video.videoHeight;
    if (width !== 0 && height !== 0) {
      asset.length = duration;
      const scale = Math.min(330 / width, 186 / height);
      const thumbnail = await generateThumbnail(video, Math.round(width * scale), Math.round(height * scale));
      video.onseeked = null;
      finish({
        type: 0,
        start: 0,
        length: frames,
        offset: 0,
        properties: { name: asset.filename, media: asset.key },
        object: { type: 0, effects: [], properties: { resolution: [width, height] } },
        thumbnail,
      });
    } else {
      // Metadata arrived but there are no video dimensions: an audio file
      // offered to the video probe. Not a decode failure, so stay silent.
      finish(undefined);
    }
  }

  function loadVideoWithDecodeHint(asset) {
    if (!asset || !asset.file || !asset.url) return undefined;
    return new Promise((resolve) => {
      const filename = displayName(asset);
      const key = warningKey(asset, filename);
      const audio = isAudioAsset(asset);
      const video = document.createElement("video");
      let settled = false;
      let timer = null;

      function cleanup() {
        if (timer !== null) {
          unschedule(timer);
          timer = null;
        }
        video.onerror = null;
        video.onloadedmetadata = null;
        video.onloadeddata = null;
        video.onseeked = null;
        try {
          video.removeAttribute("src");
          if (typeof video.load === "function") video.load();
        } catch (_error) {
          // Releasing the probe must not change the settled result.
        }
      }

      function finish(value) {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(value);
      }

      function warnOnce() {
        if (settled || disposed || audio || warned.has(key)) return;
        warned.add(key);
        try {
          notify(buildDecodeWarning(filename));
        } catch (_error) {
          // Reporting must not interrupt the import.
        }
      }

      video.onerror = function onVideoError() {
        warnOnce();
        finish(undefined);
      };
      const onMetadata = function onVideoMetadata() {
        video.onseeked = function seeked() {
          onSeeked(video, asset, finish);
        };
        video.currentTime = 0.1 * video.duration;
        video.onloadedmetadata = null;
        video.onloadeddata = null;
      };
      video.onloadedmetadata = onMetadata;
      video.onloadeddata = onMetadata;
      timer = schedule(function onProbeTimeout() {
        timer = null;
        // Metadata already arrived (dimensions known or readyState past
        // HAVE_NOTHING): the native seek path owns the outcome from here, so
        // neither warn nor settle and leave the load unchanged.
        if (video.videoWidth || video.videoHeight || video.readyState >= 1) return;
        warnOnce();
        finish(undefined);
      }, probeTimeoutMs);
      video.preload = "metadata";
      video.src = asset.url;
    });
  }

  return { loadVideoWithDecodeHint, markDisposed, warned };
}

module.exports = {
  DEFAULT_PROBE_TIMEOUT_MS,
  buildDecodeWarning,
  isAudioAsset,
  createLoadVideoWithDecodeHint,
  activate(context) {
    const prototype = context.PZ && context.PZ.ui && context.PZ.ui.media && context.PZ.ui.media.prototype;
    const host = context.window;
    if (!prototype || typeof prototype.loadVideo !== "function" || !host || !host.document) return;
    const original = prototype.loadVideo;
    const generateThumbnail = prototype.generateThumbnail;
    const installed = createLoadVideoWithDecodeHint({
      document: host.document,
      schedule: host.setTimeout.bind(host),
      unschedule: host.clearTimeout.bind(host),
      generateThumbnail: (element, width, height) => generateThumbnail.call(prototype, element, width, height),
      notify: (detail) => host.ZoidiumUI && host.ZoidiumUI.notify && host.ZoidiumUI.notify(detail),
      probeTimeoutMs: DEFAULT_PROBE_TIMEOUT_MS,
    });
    const replacement = function replacementLoadVideo(asset) {
      return installed.loadVideoWithDecodeHint(asset);
    };
    prototype.loadVideo = replacement;
    context.lifecycle.onDispose(() => {
      installed.markDisposed();
      if (prototype.loadVideo === replacement) prototype.loadVideo = original;
    });
  },
};
