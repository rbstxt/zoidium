"use strict";

// Bridges the WebCodecs streaming video decoder pool into CM3 playback,
// paused scrubbing, preview cache preparation, and sequential video export.

const MEDIABUNNY_ASSET_PATH = "/plugins/mp4-export/vendor/mediabunny-1.62.0.cjs";
const MEDIABUNNY_BUNDLE_ID = "video-decoder";
const DEFAULT_LOOKAHEAD_COUNT = 6;
const DEFAULT_FRAME_RATE = 30;
// A schedule that has not bound a frame for this long while requests stay
// pending is considered stalled and returns to the native video element.
const STALL_FALLBACK_MS = 1500;
// A superseded request keeps its progress guarantee once no frame has bound
// for two frame intervals or this floor, whichever is larger.
const PROGRESS_FLOOR_MS = 100;
const DEBUG_EVENT_INTERVAL_MS = 10000;
const TEXTURE_COPY_KEYS = [
  "flipY", "premultiplyAlpha", "encoding", "format", "type",
  "minFilter", "magFilter", "wrapS", "wrapT",
];

function resolveDecoderModule(context, host) {
  if (host?.ZoidiumVideoFrameDecoder?.createDecoderPool) return host.ZoidiumVideoFrameDecoder;
  const getAsset = context?.getAsset;
  const modules = context?.apis?.modules || host?.ZoidiumPluginApis?.modules ||
    (typeof ZoidiumPluginApis !== "undefined" ? ZoidiumPluginApis.modules : null);
  if (typeof getAsset === "function" && typeof modules?.createRequire === "function") {
    try {
      const loaded = modules.createRequire(getAsset, { root: "/plugins/core" })("./video-frame-decoder.js");
      if (loaded?.createDecoderPool) return loaded;
    } catch (_error) { /* Fall through to Node require when outside a bundle. */ }
  }
  return typeof require === "function" ? require("./video-frame-decoder.js") : null;
}

function createMediabunnyLoader(getAsset) {
  let pending = null;
  return function loadBunny() {
    if (!pending) {
      pending = Promise.resolve().then(async () => {
        if (typeof getAsset !== "function") return null;
        await getAsset.loadOptional?.(MEDIABUNNY_BUNDLE_ID);
        const source = getAsset("text", MEDIABUNNY_ASSET_PATH);
        if (typeof source !== "string" || !source) return null;
        const mod = { exports: {} };
        new Function("module", "exports", source)(mod, mod.exports);
        return mod.exports;
      }).catch(() => { pending = null; return null; });
    }
    return pending;
  };
}

function clampMediaTime(video, requestedTime) {
  let time = Number.isFinite(requestedTime) ? Math.max(0, requestedTime) : 0;
  if (video && Number.isFinite(video.duration) && video.duration > 0) {
    time = Math.min(time, Math.max(0, video.duration - 1e-7));
  }
  return time;
}

function createVideoStream(options = {}) {
  const host = options.window || options.host || (typeof window !== "undefined" ? window : globalThis);
  const decoderModule = options.decoderModule || resolveDecoderModule(options.context, host);
  const loadBunny = typeof options.loadBunny === "function"
    ? options.loadBunny : createMediabunnyLoader(options.context?.getAsset);
  const lookaheadCount = Number.isFinite(options.lookaheadCount) && options.lookaheadCount > 0
    ? Math.floor(options.lookaheadCount) : DEFAULT_LOOKAHEAD_COUNT;

  const pool = options.pool || (decoderModule ? decoderModule.createDecoderPool({
    loadBunny, maxBytes: options.maxBytes, maxFrames: options.maxFrames,
    streamWindowSeconds: options.streamWindowSeconds, lookaheadCount,
    scope: options.scope || host, fetch: options.fetch, gl: options.gl,
    onDiagnostic: (detail) => recordDecoderDiagnostic(detail),
  }) : null);

  const nowMs = typeof options.now === "function" ? options.now : () => Date.now();
  const startTimer = typeof options.setTimer === "function" ? options.setTimer
    : (fn, ms) => (typeof host.setTimeout === "function"
      ? host.setTimeout(fn, ms) : globalThis.setTimeout(fn, ms));
  const stopTimer = typeof options.clearTimer === "function" ? options.clearTimer
    : (id) => (typeof host.clearTimeout === "function"
      ? host.clearTimeout(id) : globalThis.clearTimeout(id));

  let disposed = false, nextScheduleId = 1;
  const scheduleIds = new WeakMap();
  const trackedSchedules = new Set();
  const stalledSources = new Set();
  const watchdogTimers = new Map();
  const debugLogAt = new Map();
  const counters = { stallFallbacks: 0, decoderErrors: 0, supersededRequests: 0 };

  function streamIdOf(schedule, channel) {
    let id = scheduleIds.get(schedule);
    if (!id) { id = nextScheduleId++; scheduleIds.set(schedule, id); }
    return channel + ":" + id;
  }

  function nextScheduleSeq(schedule) {
    const seq = (schedule.__zoidiumWebCodecsSeq || 0) + 1;
    schedule.__zoidiumWebCodecsSeq = seq;
    return seq;
  }

  function sourceKeyOf(media) {
    try { return pool?.sourceKeyFor?.(media) || null; } catch (_error) { return null; }
  }

  function isSourceStalled(media) {
    const key = sourceKeyOf(media);
    return Boolean(key && stalledSources.has(key));
  }

  function stepSecondsOf(schedule) {
    const step = schedule?.__zoidiumWebCodecsStepSeconds;
    return Number.isFinite(step) && step > 0 ? step : 1 / DEFAULT_FRAME_RATE;
  }

  function progressThresholdMs(schedule) {
    return Math.max(2 * stepSecondsOf(schedule) * 1000, PROGRESS_FLOOR_MS);
  }

  function lastProgressAt(schedule) {
    const boundAt = schedule?.__zoidiumWebCodecsLastBindAt;
    if (Number.isFinite(boundAt)) return boundAt;
    const pendingSince = schedule?.__zoidiumWebCodecsPendingSince;
    return Number.isFinite(pendingSince) ? pendingSince : nowMs();
  }

  function clearPendingRequest(schedule) {
    if (schedule) schedule.__zoidiumWebCodecsPendingRequest = null;
  }

  function clearWatchdog(schedule) {
    if (!schedule) return;
    const timer = watchdogTimers.get(schedule);
    if (timer !== undefined) {
      watchdogTimers.delete(schedule);
      stopTimer(timer);
    }
  }

  function armWatchdog(schedule) {
    if (!schedule || watchdogTimers.has(schedule) || disposed) return;
    const remaining = Math.max(0, lastProgressAt(schedule) + STALL_FALLBACK_MS - nowMs());
    const timer = startTimer(() => onWatchdog(schedule), remaining);
    watchdogTimers.set(schedule, timer);
  }

  function onWatchdog(schedule) {
    watchdogTimers.delete(schedule);
    if (disposed || !schedule?.__zoidiumWebCodecsPendingRequest) return;
    const elapsed = nowMs() - lastProgressAt(schedule);
    if (elapsed < STALL_FALLBACK_MS) { armWatchdog(schedule); return; }
    fallbackStalledSchedule(schedule, elapsed);
  }

  function emitDiagnostic(reason, sourceKey, detail, sinceLastBindMs) {
    if (!sourceKey) return;
    const at = nowMs();
    const previous = debugLogAt.get(sourceKey);
    if (previous !== undefined && at - previous < DEBUG_EVENT_INTERVAL_MS) return;
    debugLogAt.set(sourceKey, at);
    let poolStats = null;
    try { poolStats = pool?.stats || null; } catch (_error) { poolStats = null; }
    const entry = {
      reason,
      source: sourceKey,
      codec: detail?.codec || null,
      decoderSupport: detail?.decoderSupport || null,
      pool: detail?.stats || poolStats,
      supersededRequests: counters.supersededRequests,
      sinceLastBindMs: Number.isFinite(sinceLastBindMs) ? Math.round(sinceLastBindMs) : null,
    };
    if (detail?.errorName) entry.errorName = detail.errorName;
    if (detail?.errorMessage) entry.errorMessage = detail.errorMessage;
    try { globalThis.ZOIDIUM_DEBUG_LOG?.record?.("video-decode", entry); }
    catch (_error) { /* Diagnostics must never interrupt playback. */ }
  }

  function recordDecoderDiagnostic(detail) {
    if (!detail) return;
    counters.decoderErrors += 1;
    const schedule = detail.schedule || null;
    emitDiagnostic(
      detail.reason || "decoder-error",
      detail.sourceKey || null,
      detail,
      schedule ? nowMs() - lastProgressAt(schedule) : null,
    );
  }

  function fallbackStalledSchedule(schedule, elapsed) {
    const request = schedule.__zoidiumWebCodecsPendingRequest;
    const media = request?.item?.media || schedule.currentItem?.media || null;
    const sourceKey = sourceKeyOf(media);
    let detail = null;
    try { detail = pool?.sourceInfo?.(media) || null; } catch (_error) { detail = null; }
    counters.stallFallbacks += 1;
    if (sourceKey) stalledSources.add(sourceKey);
    nextScheduleSeq(schedule);
    restoreNative(schedule, { markDirty: true });
    emitDiagnostic("stall-fallback", sourceKey, detail, elapsed);
  }

  function resolveTargetTime(video, mediaTime) {
    const clamped = clampMediaTime(video, mediaTime);
    try {
      const seekTime = host.ZoidiumVideoSeekPolicy?.seekTime;
      if (video && typeof seekTime === "function") {
        const adjusted = seekTime(video, clamped);
        if (typeof adjusted === "number" && Number.isFinite(adjusted)) return Math.max(0, adjusted);
      }
    } catch (_error) { /* Fall back to the clamped media time. */ }
    return clamped;
  }

  function readItemMediaTime(item, frame) {
    if (!item || !item.media || !Number.isFinite(frame)) return null;
    if (frame < item.start || frame >= item.start + item.length) return null;
    const timeProp = item.clip?.properties?.time;
    if (!timeProp || typeof timeProp.get !== "function") return null;
    try {
      const mediaTime = timeProp.get(frame - item.start);
      return typeof mediaTime === "number" && Number.isFinite(mediaTime) ? mediaTime : null;
    } catch (_error) { return null; }
  }

  function estimateStepSeconds(item, playback, frame, currentMediaTime) {
    const timeProp = item?.clip?.properties?.time;
    if (timeProp && typeof timeProp.get === "function") {
      try {
        const nextMediaTime = timeProp.get(frame - item.start + 1);
        const delta = nextMediaTime - currentMediaTime;
        if (Number.isFinite(delta) && delta > 0 && delta <= 0.5) return delta;
      } catch (_error) { /* Fall through to the sequence frame rate estimate. */ }
    }
    const rate = playback?._sequence?.properties?.rate?.get?.();
    return Number.isFinite(rate) && rate > 0 ? 1 / rate : 1 / DEFAULT_FRAME_RATE;
  }

  function pauseNativeElement(schedule) {
    const el = schedule?.el;
    if (el && !el.paused && typeof el.pause === "function") {
      try { el.pause(); } catch (_error) { /* Ignore pause failure. */ }
    }
    if (schedule) schedule.playing = false;
  }

  function bindEntry(schedule, entry, frame) {
    pool.pin(schedule, entry);
    const texture = schedule.texture;
    const changed = Boolean(texture && texture.image !== entry.frame);
    if (texture) {
      texture.image = entry.frame;
      if (changed) texture.needsUpdate = true;
    }
    schedule.__zoidiumWebCodecsActive = true;
    schedule.__zoidiumWebCodecsPending = false;
    schedule.__zoidiumWebCodecsPendingRequest = null;
    schedule.__zoidiumWebCodecsLastBindAt = nowMs();
    schedule.__zoidiumWebCodecsPendingSince = null;
    clearWatchdog(schedule);
    schedule.__zoidiumWebCodecsEntryId = entry.id;
    if (frame !== undefined && frame !== null) schedule.__zoidiumWebCodecsFrame = frame;
    trackedSchedules.add(schedule);
    return changed;
  }

  function restoreNative(schedule, { markDirty = false } = {}) {
    if (!schedule) return;
    pool?.unpinSchedule(schedule);
    clearPendingRequest(schedule);
    clearWatchdog(schedule);
    schedule.__zoidiumWebCodecsActive = false;
    schedule.__zoidiumWebCodecsPending = false;
    schedule.__zoidiumWebCodecsFrame = null;
    schedule.__zoidiumWebCodecsEntryId = null;
    schedule.__zoidiumWebCodecsLastBindAt = null;
    schedule.__zoidiumWebCodecsPendingSince = null;
    schedule.__zoidiumWebCodecsLatest = null;
    if (schedule.texture && schedule.el && schedule.texture.image !== schedule.el) {
      schedule.texture.image = schedule.el;
      schedule.texture.needsUpdate = true;
    }
    trackedSchedules.delete(schedule);
    if (markDirty) host.ZoidiumFramePacing?.markVideoDirty?.(schedule);
  }

  function triggerLookahead(schedule, playback, item, frame, mediaTime, targetTime) {
    if (!playback || !(playback.speed > 0)) return;
    const stepSeconds = estimateStepSeconds(item, playback, frame, mediaTime);
    pool.prefetchAhead(item.media, streamIdOf(schedule, "playback"), targetTime, lookaheadCount, stepSeconds);
  }

  const isSupported = () => !disposed && Boolean(pool && pool.isSupported());
  const isScheduleActive = (schedule) => Boolean(schedule && schedule.__zoidiumWebCodecsActive);

  function isFrameExact(sequence, frame) {
    if (!sequence || !Number.isInteger(frame)) return false;
    const schedules = sequence.videoSchedules;
    if (!Array.isArray(schedules) || !schedules.length) return false;
    let visibleCount = 0;
    for (const schedule of schedules) {
      const item = schedule && schedule.currentItem;
      if (!item || !item.media || frame < item.start || frame >= item.start + item.length) continue;
      visibleCount += 1;
      if (schedule.__zoidiumWebCodecsActive !== true || schedule.__zoidiumWebCodecsFrame !== frame || schedule.__zoidiumWebCodecsPending) {
        return false;
      }
    }
    return visibleCount > 0;
  }

  function discardStaleEntry(schedule, entry) {
    if (!entry || !schedule || disposed) return;
    try {
      // A request that lost its schedule can still return a decoded entry that
      // the pool pinned for it. Release that pin unless the frame is displayed.
      if (pool.pinnedEntry?.(schedule) === entry && schedule.__zoidiumWebCodecsEntryId !== entry.id) {
        pool.unpinSchedule(schedule);
      }
    } catch (_error) { /* Pin bookkeeping is best-effort. */ }
  }

  function finishRequest(schedule, playback, item, request, entry) {
    if (disposed) return;
    const isCurrent = schedule.__zoidiumWebCodecsSeq === request.seq &&
      schedule.__zoidiumWebCodecsPendingRequest === request;
    if (!isCurrent || schedule.currentItem !== item) {
      if (schedule.__zoidiumWebCodecsPendingRequest === request) clearPendingRequest(schedule);
      discardStaleEntry(schedule, entry);
      return;
    }
    clearPendingRequest(schedule);
    if (!entry) { restoreNative(schedule, { markDirty: true }); return; }
    bindEntry(schedule, entry, request.frame);
    pauseNativeElement(schedule);
    host.ZoidiumFramePacing?.markVideoDirty?.(schedule);
    triggerLookahead(schedule, playback, item, request.frame, request.mediaTime, request.targetTime);
    const latest = schedule.__zoidiumWebCodecsLatest;
    if (request.chained && latest && latest.item === schedule.currentItem) {
      syncSchedule(schedule, playback, latest.frame);
    }
  }

  function startRequest(schedule, playback, item, mediaTime, targetTime, evalFrame, stepSeconds) {
    const seq = nextScheduleSeq(schedule);
    const request = {
      item, seq, targetTime, mediaTime, frame: evalFrame, chained: false,
    };
    schedule.__zoidiumWebCodecsPendingRequest = request;
    schedule.__zoidiumWebCodecsPending = true;
    schedule.__zoidiumWebCodecsStepSeconds = stepSeconds;
    if (!Number.isFinite(schedule.__zoidiumWebCodecsPendingSince) &&
      !Number.isFinite(schedule.__zoidiumWebCodecsLastBindAt)) {
      schedule.__zoidiumWebCodecsPendingSince = nowMs();
    }
    trackedSchedules.add(schedule);
    if (schedule.__zoidiumWebCodecsActive) pauseNativeElement(schedule);
    armWatchdog(schedule);
    pool.getFrame(item.media, targetTime, {
      streamId: streamIdOf(schedule, "playback"), schedule,
    }).then(
      (entry) => finishRequest(schedule, playback, item, request, entry),
      () => finishRequest(schedule, playback, item, request, null),
    );
    return Boolean(schedule.__zoidiumWebCodecsActive);
  }

  function syncSchedule(schedule, playback, frame) {
    if (!schedule || !isSupported() || schedule.__zoidiumExactDecodePending) return false;
    const item = schedule.currentItem;
    const evalFrame = Number.isFinite(frame)
      ? frame : (Number.isInteger(playback?.currentFrame) ? playback.currentFrame : playback?._exactFrame);
    const mediaTime = readItemMediaTime(item, evalFrame);
    if (mediaTime === null || pool.isUnsupported(item.media) || isSourceStalled(item.media)) {
      if (schedule.__zoidiumWebCodecsActive || schedule.__zoidiumWebCodecsPending) {
        nextScheduleSeq(schedule);
        restoreNative(schedule);
      }
      return false;
    }

    try { host.ZoidiumVideoSeekPolicy?.ensure?.(schedule.el, item.media); } catch (_error) { /* Best-effort probe. */ }
    const targetTime = resolveTargetTime(schedule.el, mediaTime);
    const stepSeconds = estimateStepSeconds(item, playback, evalFrame, mediaTime);
    schedule.__zoidiumWebCodecsStepSeconds = stepSeconds;
    const cached = pool.peek(item.media, targetTime, { schedule });
    if (cached) {
      nextScheduleSeq(schedule);
      bindEntry(schedule, cached, evalFrame);
      pauseNativeElement(schedule);
      triggerLookahead(schedule, playback, item, evalFrame, mediaTime, targetTime);
      return true;
    }

    const latest = { item, frame: evalFrame, targetTime };
    schedule.__zoidiumWebCodecsLatest = latest;

    const pending = schedule.__zoidiumWebCodecsPendingRequest;
    if (pending && pending.item === item) {
      if (Math.abs(pending.targetTime - targetTime) <= stepSeconds / 2) {
        pending.frame = evalFrame;
        pending.mediaTime = mediaTime;
        armWatchdog(schedule);
        return Boolean(schedule.__zoidiumWebCodecsActive);
      }
      // Progress guarantee: once nothing has bound for the threshold, stop
      // superseding and let the in-flight decode finish, then chain from it.
      if (!pending.chained && nowMs() - lastProgressAt(schedule) > progressThresholdMs(schedule)) {
        pending.chained = true;
      }
      if (pending.chained) {
        pending.frame = evalFrame;
        pending.mediaTime = mediaTime;
        armWatchdog(schedule);
        return Boolean(schedule.__zoidiumWebCodecsActive);
      }
    }
    if (pending) counters.supersededRequests += 1;
    return startRequest(schedule, playback, item, mediaTime, targetTime, evalFrame, stepSeconds);
  }

  async function prepareFrame(schedule, mediaTime, context = {}) {
    if (!schedule || !isSupported() || !Number.isFinite(mediaTime)) return { handled: false };
    const item = schedule.currentItem, media = item?.media;
    if (!media || pool.isUnsupported(media) || isSourceStalled(media)) {
      restoreNative(schedule);
      return { handled: false };
    }
    // Export preparation is not subject to the stall watchdog: it awaits.
    clearPendingRequest(schedule);
    clearWatchdog(schedule);

    context?.exportPolicy?.check?.();
    try { await host.ZoidiumVideoSeekPolicy?.ensure?.(schedule.el, media); } catch (_error) { /* Best-effort probe. */ }
    context?.exportPolicy?.check?.();

    const targetTime = resolveTargetTime(schedule.el, mediaTime);
    const seq = nextScheduleSeq(schedule);
    schedule.__zoidiumWebCodecsPending = true;

    const prevFrame = schedule.texture?.image;
    const entry = await pool.getFrame(media, targetTime, {
      streamId: context?.streamId || streamIdOf(schedule, "playback"), schedule,
    });
    context?.exportPolicy?.check?.();

    if (disposed || schedule.__zoidiumWebCodecsSeq !== seq || schedule.currentItem !== item) {
      return { handled: false, superseded: true };
    }
    if (!entry) { restoreNative(schedule, { markDirty: true }); return { handled: false }; }

    const reused = prevFrame === entry.frame;
    bindEntry(schedule, entry, context?.frame);
    pauseNativeElement(schedule);
    return { handled: true, reused, pts: entry.pts, end: entry.end };
  }

  async function decodeExportFrame(schedule, mediaTime, context = {}) {
    if (!schedule || !isSupported() || !Number.isFinite(mediaTime)) return { handled: false };
    const media = schedule.currentItem?.media;
    if (!media) return { handled: false };

    const sourceKey = pool.sourceKeyFor(media);
    if (!sourceKey || pool.isUnsupported(media) || stalledSources.has(sourceKey)) {
      restoreNative(schedule);
      return { handled: false };
    }
    // Sequential export awaits its own decode and is not stall-timer driven.
    clearWatchdog(schedule);

    const skipParity = context?.skipParityCheck === true;
    const renderer = context?.renderer || null;
    const THREE = context?.THREE || host.THREE;
    if (!skipParity && !renderer) { restoreNative(schedule); return { handled: false }; }

    context?.exportPolicy?.check?.();
    try { await host.ZoidiumVideoSeekPolicy?.ensure?.(schedule.el, media); } catch (_error) { /* Best-effort probe. */ }
    context?.exportPolicy?.check?.();

    const targetTime = resolveTargetTime(schedule.el, mediaTime);
    const prevFrame = schedule.texture?.image;
    const entry = await pool.getFrame(media, targetTime, {
      streamId: context?.streamId || streamIdOf(schedule, "export"), schedule,
    });
    context?.exportPolicy?.check?.();

    if (disposed || !entry) { restoreNative(schedule); return { handled: false }; }

    if (!skipParity) {
      let verdict = pool.getParityVerdict(sourceKey, renderer);
      if (verdict === undefined) {
        if (typeof context?.decodeNative === "function") {
          await context.decodeNative();
          context?.exportPolicy?.check?.();
        }
        let nativeTexture = context?.nativeTexture || null, tempNative = null;
        if (!nativeTexture) {
          if (schedule.texture && schedule.texture.image === schedule.el) {
            nativeTexture = schedule.texture;
          } else if (schedule.el && THREE?.Texture) {
            tempNative = new THREE.Texture(schedule.el);
            for (const key of TEXTURE_COPY_KEYS) if (schedule.texture?.[key] !== undefined) tempNative[key] = schedule.texture[key];
            tempNative.generateMipmaps = false;
            tempNative.needsUpdate = true;
            nativeTexture = tempNative;
          }
        }
        try { verdict = pool.verifyParity(sourceKey, renderer, nativeTexture, entry.frame, schedule.texture, THREE); }
        finally { tempNative?.dispose?.(); }
      }
      if (!verdict) { restoreNative(schedule); return { handled: false }; }
    }

    const reused = prevFrame === entry.frame;
    pool.pin(schedule, entry);
    if (schedule.texture) {
      schedule.texture.image = entry.frame;
      if (!reused) schedule.texture.needsUpdate = true;
    }
    schedule.__zoidiumWebCodecsActive = true;
    schedule.__zoidiumWebCodecsPending = false;
    schedule.__zoidiumWebCodecsEntryId = entry.id;
    if (Number.isInteger(context?.frame)) schedule.__zoidiumWebCodecsFrame = context.frame;
    trackedSchedules.add(schedule);
    return { handled: true, reused, pts: entry.pts, end: entry.end };
  }

  function releaseSchedule(schedule) {
    if (!schedule) return;
    nextScheduleSeq(schedule);
    restoreNative(schedule);
  }

  function invalidateAsset(media) {
    if (!pool || !media) return;
    const key = pool.sourceKeyFor(media);
    if (!key) return;
    // A replaced asset is a new source: allow WebCodecs again.
    stalledSources.delete(key);
    for (const schedule of Array.from(trackedSchedules)) {
      if (pool.sourceKeyFor(schedule.currentItem?.media) === key) releaseSchedule(schedule);
    }
    pool.invalidateSource(key);
  }

  function clearAll() {
    for (const schedule of Array.from(trackedSchedules)) releaseSchedule(schedule);
    pool?.clear();
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    for (const schedule of Array.from(trackedSchedules)) releaseSchedule(schedule);
    for (const schedule of Array.from(watchdogTimers.keys())) clearWatchdog(schedule);
    watchdogTimers.clear();
    trackedSchedules.clear();
    stalledSources.clear();
    debugLogAt.clear();
    pool?.dispose();
  }

  return {
    isSupported, isScheduleActive, isFrameExact, syncSchedule, prepareFrame,
    decodeExportFrame, releaseSchedule, invalidateAsset, clearAll, dispose,
    get stats() {
      const base = pool ? pool.stats : {
        decoded: 0, cacheHits: 0, prefetchHits: 0, fallbacks: 0,
        activeFrames: 0, cachedBytes: 0, evicted: 0,
      };
      return {
        ...base,
        stallFallbacks: counters.stallFallbacks,
        decoderErrors: counters.decoderErrors,
        supersededRequests: counters.supersededRequests,
        stalledSources: stalledSources.size,
        fallbackReasons: {
          stall: counters.stallFallbacks,
          decoderError: counters.decoderErrors,
        },
      };
    },
  };
}

let activeTeardown = null;

function activate(context) {
  if (activeTeardown) activeTeardown();
  const host = context?.window || (typeof window !== "undefined" ? window : globalThis);
  const doc = context?.document || host?.document || null;
  const PZ = context?.PZ || host?.PZ || null;
  const editor = context?.editor || null;

  const streamApi = createVideoStream({
    context, window: host, loadBunny: context?.loadBunny, pool: context?.pool,
    maxBytes: context?.maxBytes, maxFrames: context?.maxFrames, scope: context?.scope || host,
  });

  const previousStream = host.ZoidiumVideoStream;
  host.ZoidiumVideoStream = streamApi;

  const playbackProto = PZ?.ui?.playback?.prototype || null;
  const originalUpdateSchedule = typeof playbackProto?.updateSchedule === "function" ? playbackProto.updateSchedule : null;
  let wrappedUpdateSchedule = null;
  if (originalUpdateSchedule) {
    wrappedUpdateSchedule = function webCodecsUpdateSchedule(schedule) {
      const videoType = PZ.schedule?.type?.VIDEO ?? 0;
      if (schedule && schedule.type === videoType && streamApi.isSupported() && !schedule.__zoidiumExactDecodePending) {
        const frame = Number.isInteger(this.currentFrame) ? this.currentFrame : Math.round(this._exactFrame);
        streamApi.syncSchedule(schedule, this, frame);
        if (schedule.__zoidiumWebCodecsActive) {
          if (schedule.el && !schedule.el.paused && typeof schedule.el.pause === "function") {
            try { schedule.el.pause(); } catch (_error) { /* Ignore pause failure. */ }
          }
          schedule.playing = false;
          return;
        }
      }
      return originalUpdateSchedule.apply(this, arguments);
    };
    playbackProto.updateSchedule = wrappedUpdateSchedule;
  }

  const scheduleProto = PZ?.schedule?.prototype || null;
  const originalUnload = typeof scheduleProto?.unload === "function" ? scheduleProto.unload : null;
  let wrappedUnload = null;
  if (originalUnload) {
    wrappedUnload = function webCodecsScheduleUnload() {
      streamApi.releaseSchedule(this);
      return originalUnload.apply(this, arguments);
    };
    scheduleProto.unload = wrappedUnload;
  }

  const originalReset = typeof scheduleProto?.reset === "function" ? scheduleProto.reset : null;
  let wrappedReset = null;
  if (originalReset) {
    wrappedReset = function webCodecsScheduleReset() {
      streamApi.releaseSchedule(this);
      return originalReset.apply(this, arguments);
    };
    scheduleProto.reset = wrappedReset;
  }

  const onProjectChanged = () => streamApi.clearAll();
  const onAssetReloaded = (event) => {
    const asset = event?.detail;
    if (asset && (asset.sha256 || asset.url || asset.assetKey || asset.key)) streamApi.invalidateAsset(asset);
  };
  const onPageHide = () => streamApi.clearAll();

  editor?.onProjectChanged?.watch?.(onProjectChanged);
  doc?.addEventListener?.("zoidium:asset-reloaded", onAssetReloaded);
  host?.addEventListener?.("pagehide", onPageHide);

  let tornDown = false;
  const teardown = () => {
    if (tornDown) return;
    tornDown = true;
    if (activeTeardown === teardown) activeTeardown = null;
    if (playbackProto && playbackProto.updateSchedule === wrappedUpdateSchedule) playbackProto.updateSchedule = originalUpdateSchedule;
    if (scheduleProto && scheduleProto.unload === wrappedUnload) scheduleProto.unload = originalUnload;
    if (scheduleProto && scheduleProto.reset === wrappedReset) scheduleProto.reset = originalReset;
    editor?.onProjectChanged?.unwatch?.(onProjectChanged);
    doc?.removeEventListener?.("zoidium:asset-reloaded", onAssetReloaded);
    host?.removeEventListener?.("pagehide", onPageHide);
    streamApi.dispose();
    if (host.ZoidiumVideoStream === streamApi) {
      if (previousStream !== undefined) host.ZoidiumVideoStream = previousStream;
      else delete host.ZoidiumVideoStream;
    }
  };

  activeTeardown = teardown;
  context?.lifecycle?.onDispose?.(teardown);
  return streamApi;
}

function deactivate() {
  if (activeTeardown) activeTeardown();
}

module.exports = {
  MEDIABUNNY_ASSET_PATH,
  MEDIABUNNY_BUNDLE_ID,
  createMediabunnyLoader,
  createVideoStream,
  activate,
  deactivate,
};
