(function installExportAudioTrace(global) {
  "use strict";

  const PATCH_MARKER = "__zoidiumExportAudioTracePatch";
  const SAMPLE_RATE = 48000;
  const MAX_ENTRIES = 20000;
  const STORAGE_KEY = "zoidium:export-audio-trace";

  // Opt-in recorder for the export audio feed. Enable with
  //   localStorage.setItem("zoidium:export-audio-trace", "1")
  // then export, and read the result with
  //   copy(ZoidiumExportAudioTrace.report())
  //
  // It exists because the reported defect is roughly one audio frame at the very
  // end of a render, which is invisible to ordinary logging: PZ.export feeds the
  // encoder from a small ring buffer (worker/av.js `_xfer_ptrs_a`, two channels
  // of a few thousand samples), so anything wrong there is a handful of samples
  // inside a multi-megabyte output.
  //
  // Two seams are recorded:
  //
  // 1. PZ.export.getAudioSamples is wrapped to log every rendered segment: the
  //    sample range requested, the number of samples the renderer produced, and
  //    how much of the sequence was left. A segment shorter than one encoder
  //    frame is the only way the second seam can misfire.
  //
  // 2. PZ.av.worker.onmessage is wrapped after PZ.av.encode installs it. The
  //    "audio" branch is where the ring buffer is refilled; a refill that cannot
  //    cover the frame is what lets stale ring-buffer data reach the encoder.
  //
  // Nothing here changes behaviour: every wrapper forwards its arguments and
  // returns the original result.

  function enabled(scope) {
    const host = scope || global;
    try {
      return Boolean(host.localStorage && host.localStorage.getItem(STORAGE_KEY) === "1");
    } catch (error) {
      return false;
    }
  }

  function push(list, entry) {
    if (list.length < MAX_ENTRIES) list.push(entry);
  }

  function installSampleTrace(PZ, trace) {
    const exportPrototype = PZ.export && PZ.export.prototype;
    if (!exportPrototype || typeof exportPrototype.getAudioSamples !== "function") return false;
    if (exportPrototype[PATCH_MARKER]) return true;

    const original = exportPrototype.getAudioSamples;
    exportPrototype.getAudioSamples = async function tracedGetAudioSamples(num) {
      const startSample = this.sample;
      const totalSamples = this.totalSamples;
      const rendered = await original.call(this, num);
      push(trace.segments, {
        requested: num,
        startSample,
        totalSamples,
        remaining: Math.max(0, totalSamples - startSample),
        renderedSamples: rendered ? rendered.length : 0,
        renderedSeconds: rendered ? rendered.length / SAMPLE_RATE : 0,
        at: Date.now() - trace.startedAt,
      });
      return rendered;
    };
    exportPrototype[PATCH_MARKER] = true;
    return true;
  }

  function wrapWorkerFeed(PZ, trace) {
    const av = PZ.av;
    if (!av || typeof av.encode !== "function") return false;
    if (av[PATCH_MARKER]) return true;

    const original = av.encode;
    av.encode = function tracedEncode(sequenceExport, params) {
      const result = original.call(this, sequenceExport, params);

      // PZ.av.encode assigns PZ.av.worker.onmessage synchronously before it
      // returns, so the feed can be wrapped here.
      const worker = PZ.av.worker;
      if (worker && typeof worker.onmessage === "function" && !worker[PATCH_MARKER]) {
        const originalOnMessage = worker.onmessage;
        worker.onmessage = async function tracedOnMessage(event) {
          const message = event && event.data;
          if (message && message.type === "audio") {
            const audioBuffer = PZ.av.audioBuffer;
            const startSample = PZ.av.bufferStartSample;
            const available = audioBuffer ? audioBuffer.length - startSample : 0;
            const filled = Math.min(available, message.num);
            const entry = {
              num: message.num,
              available,
              filled,
              short: filled < message.num,
              staleTailSamples: Math.max(0, message.num - filled),
              segmentLength: audioBuffer ? audioBuffer.length : 0,
              at: Date.now() - trace.startedAt,
            };
            push(trace.feed, entry);
            if (entry.short) push(trace.shortFeeds, entry);
          }
          return originalOnMessage.call(this, event);
        };
        worker[PATCH_MARKER] = true;
      }

      return result;
    };
    av[PATCH_MARKER] = true;
    return true;
  }

  function install(PZ, scope) {
    const host = scope || global;
    if (!PZ || !PZ.av || !PZ.export) return false;
    if (!enabled(host)) return false;
    if (host.ZoidiumExportAudioTrace) return true;

    const trace = { startedAt: Date.now(), segments: [], feed: [], shortFeeds: [] };
    installSampleTrace(PZ, trace);
    wrapWorkerFeed(PZ, trace);

    host.ZoidiumExportAudioTrace = {
      trace,
      clear() {
        trace.segments.length = 0;
        trace.feed.length = 0;
        trace.shortFeeds.length = 0;
      },
      report() {
        const lines = [];
        lines.push(
          `segments=${trace.segments.length} feeds=${trace.feed.length} shortFeeds=${trace.shortFeeds.length}`
        );
        if (trace.segments.length) {
          lines.push("last segments:");
          for (const entry of trace.segments.slice(-8)) {
            lines.push(
              `  requested=${entry.requested} startSample=${entry.startSample}` +
              ` remaining=${entry.remaining} rendered=${entry.renderedSamples}` +
              ` (${entry.renderedSeconds.toFixed(4)}s)`
            );
          }
        }
        if (trace.shortFeeds.length) {
          lines.push("SHORT FEEDS (stale ring-buffer data reaches the encoder):");
          for (const entry of trace.shortFeeds) lines.push(`  ${JSON.stringify(entry)}`);
        }
        const lastFeed = trace.feed.slice(-3);
        if (lastFeed.length) {
          lines.push("last feeds:");
          for (const entry of lastFeed) lines.push(`  ${JSON.stringify(entry)}`);
        }
        return lines.join("\n");
      },
    };
    return true;
  }

  if (typeof module === "object" && module.exports) {
    module.exports = { PATCH_MARKER, STORAGE_KEY, enabled, install };
    return;
  }

  install(global && global.PZ, global);
})(typeof window !== "undefined" ? window : null);
