// WebCodecs + mediabunny streaming video frame decoder and global
// memory-bounded PTS-interval LRU cache.
(function initializeVideoFrameDecoder(global) {
  "use strict";

  const DEFAULT_MAX_BYTES = 192 * 1024 * 1024;
  const DEFAULT_MAX_FRAMES = 64;
  const DEFAULT_MAX_SOURCES = 16;
  const DEFAULT_LOOKAHEAD_COUNT = 6;
  const DEFAULT_STREAM_WINDOW_SECONDS = 1.0;
  const PTS_EPSILON = 1e-6;
  const DEFAULT_FRAME_DURATION = 1 / 30;
  const TEXTURE_COPY_KEYS = [
    "flipY", "premultiplyAlpha", "encoding", "format", "type",
    "minFilter", "magFilter", "wrapS", "wrapT",
  ];

  const fallbackObjectIds = new WeakMap();
  let nextFallbackObjectId = 1;

  function objectIdentityKey(obj) {
    if (!obj || typeof obj !== "object") return null;
    let id = fallbackObjectIds.get(obj);
    if (!id) {
      id = "obj:" + nextFallbackObjectId++;
      fallbackObjectIds.set(obj, id);
    }
    return id;
  }

  function sourceKeyFor(media, explicitKey) {
    if (typeof explicitKey === "string" && explicitKey) return explicitKey;
    if (typeof media === "string" && media) return media;
    if (!media || typeof media !== "object") return null;
    if (typeof media.sha256 === "string" && media.sha256) return media.sha256;
    if (typeof media.url === "string" && media.url) return media.url;
    if (typeof media.assetKey === "string" && media.assetKey) return media.assetKey;
    if (typeof media.key === "string" && media.key) return media.key;
    if (media.file && typeof media.file === "object") return objectIdentityKey(media.file);
    return null;
  }

  function patchFrameDimensions(frame) {
    if (!frame || typeof frame !== "object") return frame;
    const width = Number.isFinite(frame.displayWidth) && frame.displayWidth > 0 ? frame.displayWidth : frame.codedWidth;
    const height = Number.isFinite(frame.displayHeight) && frame.displayHeight > 0 ? frame.displayHeight : frame.codedHeight;
    if (Number.isFinite(width) && width > 0 && frame.width !== width) {
      try { Object.defineProperty(frame, "width", { configurable: true, enumerable: true, value: width }); }
      catch (_error) { /* Leave non-configurable native width untouched. */ }
    }
    if (Number.isFinite(height) && height > 0 && frame.height !== height) {
      try { Object.defineProperty(frame, "height", { configurable: true, enumerable: true, value: height }); }
      catch (_error) { /* Leave non-configurable native height untouched. */ }
    }
    return frame;
  }

  function estimateFrameBytes(frame) {
    const w = Number.isFinite(frame?.displayWidth) && frame.displayWidth > 0
      ? frame.displayWidth : (Number.isFinite(frame?.width) && frame.width > 0 ? frame.width : 1);
    const h = Number.isFinite(frame?.displayHeight) && frame.displayHeight > 0
      ? frame.displayHeight : (Number.isFinite(frame?.height) && frame.height > 0 ? frame.height : 1);
    return Math.max(4, Math.round(w * h * 4));
  }

  function closeIterator(iterator) {
    if (!iterator || typeof iterator.return !== "function") return Promise.resolve();
    try { return Promise.resolve(iterator.return()).catch(() => {}); }
    catch (_error) { return Promise.resolve(); }
  }

  function safeClose(resource) {
    if (!resource || typeof resource.close !== "function") return;
    try { resource.close(); }
    catch (_error) { /* Closing an already-closed sample or frame is harmless. */ }
  }

  function matchesInterval(entry, targetTime) {
    const lower = entry.coverStart !== undefined ? entry.coverStart : entry.pts;
    if (targetTime < lower - PTS_EPSILON) return false;
    return entry.isLast ? targetTime <= entry.end + PTS_EPSILON : targetTime < entry.end - PTS_EPSILON;
  }

  function createDecoderPool(options = {}) {
    const scope = options.scope || global;
    const maxBytes = Number.isFinite(options.maxBytes) && options.maxBytes > 0 ? options.maxBytes : DEFAULT_MAX_BYTES;
    const maxFrames = Number.isFinite(options.maxFrames) && options.maxFrames > 0 ? Math.floor(options.maxFrames) : DEFAULT_MAX_FRAMES;
    const maxSources = Number.isFinite(options.maxSources) && options.maxSources > 0 ? Math.floor(options.maxSources) : DEFAULT_MAX_SOURCES;
    const streamWindowSeconds = Number.isFinite(options.streamWindowSeconds) && options.streamWindowSeconds >= 0
      ? options.streamWindowSeconds : DEFAULT_STREAM_WINDOW_SECONDS;
    const defaultLookahead = Number.isFinite(options.lookaheadCount) && options.lookaheadCount > 0
      ? Math.floor(options.lookaheadCount) : DEFAULT_LOOKAHEAD_COUNT;
    const loadBunnyFn = typeof options.loadBunny === "function" ? options.loadBunny : null;

    let disposed = false, bunnyPromise = null, nextEntryId = 1, nextScheduleSeq = 1;
    let cachedBytes = 0, activeFrames = 0;
    const counters = { decoded: 0, cacheHits: 0, prefetchHits: 0, fallbacks: 0, evicted: 0 };

    const lru = new Map(), bySource = new Map(), evictedPinned = new Set();
    const pinsBySchedule = new Map(), scheduleSeqs = new WeakMap();
    const sources = new Map(), unsupportedSources = new Set();
    const parityBySource = new Map(), parityResources = new Map();

    const isSupported = () => !disposed && typeof scope.VideoDecoder !== "undefined" && typeof scope.VideoFrame !== "undefined";
    const isUnsupported = (media, explicitKey) => { const k = sourceKeyFor(media, explicitKey); return Boolean(k && unsupportedSources.has(k)); };
    const getGl = () => options.gl || scope.ZoidiumPluginApis?.gl || global.ZoidiumPluginApis?.gl || null;

    async function ensureBunny() {
      if (disposed || !loadBunnyFn) return null;
      if (!bunnyPromise) {
        bunnyPromise = Promise.resolve().then(() => loadBunnyFn()).catch(() => { bunnyPromise = null; return null; });
      }
      return bunnyPromise;
    }

    function closeEntry(entry) {
      if (!entry || entry.closed) return;
      entry.closed = true;
      evictedPinned.delete(entry);
      activeFrames = Math.max(0, activeFrames - 1);
      safeClose(entry.frame);
    }

    function removeEntryFromCache(entry, countEviction) {
      if (!lru.has(entry.id)) return;
      lru.delete(entry.id);
      cachedBytes = Math.max(0, cachedBytes - entry.bytes);
      const list = bySource.get(entry.sourceKey);
      if (list) {
        const idx = list.indexOf(entry);
        if (idx !== -1) list.splice(idx, 1);
        if (!list.length) bySource.delete(entry.sourceKey);
      }
      entry.evicted = true;
      if (countEviction) counters.evicted += 1;
      if (entry.pinnedBy.size === 0) closeEntry(entry);
      else evictedPinned.add(entry);
    }

    function touchEntry(entry) {
      if (!entry || !lru.has(entry.id)) return;
      lru.delete(entry.id);
      lru.set(entry.id, entry);
    }

    function pickEvictionVictim(protectedEntries) {
      let oldestPinned = null;
      for (const entry of lru.values()) {
        if (protectedEntries && protectedEntries.has(entry)) continue;
        if (entry.pinnedBy.size === 0) return entry;
        if (!oldestPinned) oldestPinned = entry;
      }
      return oldestPinned;
    }

    function evictIfNeeded(incomingBytes, protectedEntries) {
      while (lru.size > 0 && (lru.size >= maxFrames || cachedBytes + incomingBytes > maxBytes)) {
        const victim = pickEvictionVictim(protectedEntries);
        if (!victim) break;
        removeEntryFromCache(victim, true);
      }
    }

    function insertEntry({ sourceKey, pts, end, coverStart, isLast, frame, prefetched, protectedEntries }) {
      patchFrameDimensions(frame);
      const bytes = estimateFrameBytes(frame);
      evictIfNeeded(bytes, protectedEntries);

      const entry = {
        id: nextEntryId++, sourceKey, pts, end, coverStart, isLast: Boolean(isLast),
        frame, bytes, pinnedBy: new Set(), evicted: false, closed: false,
        prefetched: Boolean(prefetched), consumed: false,
      };
      activeFrames += 1;
      lru.set(entry.id, entry);
      cachedBytes += bytes;

      let list = bySource.get(sourceKey);
      if (!list) { list = []; bySource.set(sourceKey, list); }
      let insertAt = list.length;
      while (insertAt > 0 && list[insertAt - 1].pts > pts) insertAt -= 1;
      list.splice(insertAt, 0, entry);
      return entry;
    }

    function findCachedEntry(sourceKey, targetTime) {
      const list = bySource.get(sourceKey);
      if (!list || !list.length) return null;
      for (let i = 0; i < list.length; i++) {
        if (!list[i].closed && matchesInterval(list[i], targetTime)) return list[i];
      }
      return null;
    }

    function pin(schedule, entry) {
      if (!schedule) return;
      const previous = pinsBySchedule.get(schedule);
      if (previous === entry) return;
      if (previous) {
        previous.pinnedBy.delete(schedule);
        if (previous.evicted && previous.pinnedBy.size === 0) closeEntry(previous);
      }
      if (entry && !entry.closed) {
        entry.pinnedBy.add(schedule);
        pinsBySchedule.set(schedule, entry);
      } else {
        pinsBySchedule.delete(schedule);
      }
    }

    const unpinSchedule = (schedule) => pin(schedule, null);

    function recordCacheHit(entry, schedule) {
      touchEntry(entry);
      counters.cacheHits += 1;
      if (entry.prefetched && !entry.consumed) { entry.consumed = true; counters.prefetchHits += 1; }
      if (schedule) pin(schedule, entry);
      return entry;
    }

    function peek(media, targetTime, opts = {}) {
      if (disposed || !Number.isFinite(targetTime)) return null;
      const key = sourceKeyFor(media, opts.sourceKey);
      if (!key || unsupportedSources.has(key)) return null;
      const entry = findCachedEntry(key, targetTime);
      return entry ? recordCacheHit(entry, opts.schedule) : null;
    }

    function closeStream(stream) {
      if (!stream) return;
      stream.prefetchSeq += 1;
      safeClose(stream.peek);
      stream.peek = null;
      const iter = stream.iterator;
      stream.iterator = null;
      stream.streamTime = -Infinity;
      closeIterator(iter);
    }

    function closeSourceRecord(source) {
      if (!source) return;
      source.generation += 1;
      for (const stream of source.streams.values()) closeStream(stream);
      source.streams.clear();
      try { source.input?.dispose?.(); } catch (_error) { /* Best-effort disposal. */ }
    }

    function markUnsupported(key, source) {
      unsupportedSources.add(key);
      if (source) {
        source.unsupported = true;
        closeSourceRecord(source);
        if (sources.get(key) === source) sources.delete(key);
      }
    }

    function getStream(source, streamId) {
      const id = String(streamId || "default");
      let stream = source.streams.get(id);
      if (!stream) {
        stream = {
          id, iterator: null, peek: null, streamTime: -Infinity,
          queue: Promise.resolve(), requestSeq: 0, prefetchSeq: 0,
          prefetchActive: false, prefetchTarget: null,
        };
        source.streams.set(id, stream);
      }
      return stream;
    }

    function evictIdleSource(keepKey) {
      if (sources.size <= maxSources) return;
      for (const [key, candidate] of sources.entries()) {
        if (key === keepKey) continue;
        const entries = bySource.get(key);
        if (entries && entries.some(entry => entry.pinnedBy.size > 0)) continue;
        sources.delete(key);
        closeSourceRecord(candidate);
        if (sources.size <= maxSources) break;
      }
    }

    async function resolveBlob(media) {
      const BlobCtor = scope.Blob || global.Blob;
      if (media?.file && (typeof BlobCtor !== "function" || media.file instanceof BlobCtor || typeof media.file.arrayBuffer === "function")) {
        return media.file;
      }
      const url = typeof media === "string" ? media : media?.url;
      if (!url) return null;
      const fetchFn = options.fetch || scope.fetch || global.fetch;
      if (typeof fetchFn !== "function") return null;
      const response = await fetchFn(url);
      return (!response || response.ok === false) ? null : response.blob();
    }

    function getOrCreateSourceShell(key, media) {
      let source = sources.get(key);
      if (!source) {
        source = { key, media, input: null, track: null, sink: null, streams: new Map(), opening: null, unsupported: false, generation: 1 };
        sources.set(key, source);
      } else if (media && !source.media) {
        source.media = media;
      }
      return source;
    }

    async function ensureSourceOpen(source, media) {
      if (disposed || source.unsupported || unsupportedSources.has(source.key)) return null;
      if (source.sink) return source;
      if (source.opening) return source.opening;
      const openGen = source.generation;
      source.opening = (async () => {
        const bunny = await ensureBunny();
        if (disposed || !bunny || source.generation !== openGen) return null;
        const blob = await resolveBlob(media || source.media);
        if (disposed || !blob || source.generation !== openGen) return null;
        const input = new bunny.Input({ formats: bunny.ALL_FORMATS, source: new bunny.BlobSource(blob) });
        let track = null;
        try {
          track = await input.getPrimaryVideoTrack();
          const decodable = track ? await track.canDecode() : false;
          if (disposed || source.generation !== openGen) { input.dispose?.(); return null; }
          if (!track || !decodable) { input.dispose?.(); markUnsupported(source.key, source); return null; }
        } catch (_error) {
          try { input.dispose?.(); } catch (_disposeError) { /* Best-effort cleanup. */ }
          markUnsupported(source.key, source);
          return null;
        }
        source.input = input;
        source.track = track;
        source.sink = new bunny.VideoSampleSink(track);
        evictIdleSource(source.key);
        return source;
      })().finally(() => { source.opening = null; });
      return source.opening;
    }

    async function advanceStreamTo(source, stream, targetTime, isCancelled) {
      const canContinue = Boolean(
        stream.iterator &&
        targetTime >= stream.streamTime - PTS_EPSILON &&
        targetTime <= stream.streamTime + streamWindowSeconds &&
        (!stream.peek || stream.peek.timestamp <= targetTime + PTS_EPSILON)
      );
      if (!canContinue) {
        safeClose(stream.peek);
        stream.peek = null;
        const oldIter = stream.iterator;
        stream.iterator = null;
        await closeIterator(oldIter);
        if (isCancelled()) return null;
        stream.iterator = source.sink.samples(targetTime);
        stream.streamTime = targetTime;
      }

      let sample = stream.peek;
      stream.peek = null;
      if (!sample) {
        const first = await stream.iterator.next();
        if (isCancelled()) { if (!first.done) safeClose(first.value); return null; }
        if (first.done || !first.value) { stream.iterator = null; return null; }
        sample = first.value;
      }

      for (;;) {
        const next = await stream.iterator.next();
        if (isCancelled()) { safeClose(sample); if (!next.done) safeClose(next.value); return null; }
        if (next.done || !next.value) {
          const duration = Number.isFinite(sample.duration) && sample.duration > 0 ? sample.duration : DEFAULT_FRAME_DURATION;
          stream.iterator = null;
          stream.streamTime = Math.max(targetTime, sample.timestamp);
          return { sample, pts: sample.timestamp, end: sample.timestamp + duration, coverStart: Math.min(sample.timestamp, targetTime), isLast: true };
        }
        if (next.value.timestamp > targetTime + PTS_EPSILON) {
          stream.peek = next.value;
          stream.streamTime = Math.max(targetTime, sample.timestamp);
          return { sample, pts: sample.timestamp, end: next.value.timestamp, coverStart: Math.min(sample.timestamp, targetTime), isLast: false };
        }
        safeClose(sample);
        sample = next.value;
      }
    }

    function getFrame(media, targetTime, opts = {}) {
      if (!isSupported() || !Number.isFinite(targetTime)) return Promise.resolve(null);
      const key = sourceKeyFor(media, opts.sourceKey);
      if (!key) return Promise.resolve(null);
      if (unsupportedSources.has(key)) { counters.fallbacks += 1; return Promise.resolve(null); }

      const clampedTime = Math.max(0, targetTime);
      const schedule = opts.schedule || null;
      const existing = findCachedEntry(key, clampedTime);
      if (existing) return Promise.resolve(recordCacheHit(existing, schedule));

      const source = getOrCreateSourceShell(key, media);
      const stream = getStream(source, opts.streamId);
      const mySeq = ++stream.requestSeq;
      stream.prefetchSeq += 1;
      const myScheduleSeq = schedule ? nextScheduleSeq++ : 0;
      if (schedule) scheduleSeqs.set(schedule, myScheduleSeq);
      const openGen = source.generation;

      const isSuperseded = () => disposed || stream.requestSeq !== mySeq || (schedule ? scheduleSeqs.get(schedule) !== myScheduleSeq : false);
      const isAborted = () => isSuperseded() || source.unsupported || source.generation !== openGen;

      const task = async () => {
        if (isSuperseded()) return null;
        if (source.unsupported || unsupportedSources.has(key)) { counters.fallbacks += 1; return null; }
        if (source.generation !== openGen) return null;
        const cached = findCachedEntry(key, clampedTime);
        if (cached) return recordCacheHit(cached, schedule);

        try {
          const opened = await ensureSourceOpen(source, media);
          if (isSuperseded()) return null;
          if (!opened || source.unsupported || unsupportedSources.has(key)) { counters.fallbacks += 1; return null; }
          if (source.generation !== openGen) return null;

          const decoded = await advanceStreamTo(opened, stream, clampedTime, isAborted);
          if (isAborted()) {
            safeClose(decoded?.sample);
            if (!isSuperseded() && (source.unsupported || unsupportedSources.has(key))) counters.fallbacks += 1;
            return null;
          }
          if (!decoded || !decoded.sample) return null;

          const sample = decoded.sample;
          if (sample.rotation || sample.flip) {
            safeClose(sample);
            markUnsupported(key, opened);
            counters.fallbacks += 1;
            return null;
          }

          const frame = sample.toVideoFrame();
          safeClose(sample);
          if (isAborted()) { safeClose(frame); return null; }

          const entry = insertEntry({
            sourceKey: key, pts: decoded.pts, end: decoded.end,
            coverStart: decoded.coverStart, isLast: decoded.isLast, frame, prefetched: false,
          });
          counters.decoded += 1;
          if (schedule) pin(schedule, entry);
          return entry;
        } catch (_error) {
          markUnsupported(key, source);
          counters.fallbacks += 1;
          return null;
        }
      };

      const pending = stream.queue.then(task);
      stream.queue = pending.catch(() => {});
      return pending;
    }

    function prefetchAhead(media, streamId, fromTime, count = defaultLookahead, stepSeconds = DEFAULT_FRAME_DURATION, opts = {}) {
      if (!isSupported() || !Number.isFinite(fromTime)) return Promise.resolve(0);
      const steps = Math.max(0, Math.min(Math.floor(count), Math.max(1, maxFrames - 1)));
      if (steps <= 0 || !Number.isFinite(stepSeconds) || stepSeconds <= 0) return Promise.resolve(0);
      const key = sourceKeyFor(media, opts.sourceKey);
      if (!key || unsupportedSources.has(key)) return Promise.resolve(0);

      const source = getOrCreateSourceShell(key, media);
      const stream = getStream(source, streamId);
      stream.prefetchTarget = { fromTime: Math.max(0, fromTime), count: steps, stepSeconds };
      if (stream.prefetchActive) return stream.prefetchPromise || Promise.resolve(0);

      const myRequestSeq = stream.requestSeq, myPrefetchSeq = stream.prefetchSeq, openGen = source.generation;
      const isCancelled = () => (
        disposed || source.unsupported || unsupportedSources.has(key) ||
        source.generation !== openGen || stream.requestSeq !== myRequestSeq || stream.prefetchSeq !== myPrefetchSeq
      );

      stream.prefetchActive = true;
      const task = async () => {
        let decodedCount = 0, batchBytes = 0;
        const batchProtected = new Set();
        try {
          if (isCancelled()) return 0;
          const opened = await ensureSourceOpen(source, media);
          if (!opened || isCancelled()) return 0;
          while (!isCancelled() && stream.prefetchTarget) {
            const targetSpec = stream.prefetchTarget;
            stream.prefetchTarget = null;
            for (let i = 1; i <= targetSpec.count; i++) {
              if (isCancelled()) return decodedCount;
              const targetTime = targetSpec.fromTime + i * targetSpec.stepSeconds;
              const hit = findCachedEntry(key, targetTime);
              if (hit) { batchProtected.add(hit); continue; }
              if (batchProtected.size >= Math.max(1, maxFrames - 1) || batchBytes >= maxBytes) return decodedCount;

              const decoded = await advanceStreamTo(opened, stream, targetTime, isCancelled);
              if (isCancelled()) { safeClose(decoded?.sample); return decodedCount; }
              if (!decoded || !decoded.sample) return decodedCount;
              if (decoded.sample.rotation || decoded.sample.flip) {
                safeClose(decoded.sample);
                markUnsupported(key, opened);
                return decodedCount;
              }
              const frame = decoded.sample.toVideoFrame();
              safeClose(decoded.sample);
              if (isCancelled()) { safeClose(frame); return decodedCount; }
              const frameBytes = estimateFrameBytes(frame);
              if (batchBytes + frameBytes > maxBytes && batchProtected.size > 0) { safeClose(frame); return decodedCount; }

              const entry = insertEntry({
                sourceKey: key, pts: decoded.pts, end: decoded.end, coverStart: decoded.coverStart,
                isLast: decoded.isLast, frame, prefetched: true, protectedEntries: batchProtected,
              });
              batchProtected.add(entry);
              batchBytes += entry.bytes;
              counters.decoded += 1;
              decodedCount += 1;
              if (decoded.isLast) break;
            }
          }
          return decodedCount;
        } catch (_error) {
          markUnsupported(key, source);
          return decodedCount;
        } finally {
          stream.prefetchActive = false;
          stream.prefetchPromise = null;
        }
      };

      const pending = stream.queue.then(task);
      stream.prefetchPromise = pending;
      stream.queue = pending.catch(() => {});
      return pending;
    }

    function getParityVerdict(sourceKey, renderer) {
      return (sourceKey && renderer) ? parityBySource.get(sourceKey)?.get(renderer) : undefined;
    }

    function setParityVerdict(sourceKey, renderer, verdict) {
      let map = parityBySource.get(sourceKey);
      if (!map) { map = new WeakMap(); parityBySource.set(sourceKey, map); }
      map.set(renderer, Boolean(verdict));
      return Boolean(verdict);
    }

    function verifyParity(sourceKey, renderer, nativeTexture, decodedFrame, originalTexture, THREE) {
      if (!sourceKey || !renderer) return false;
      const existing = getParityVerdict(sourceKey, renderer);
      if (existing !== undefined) return existing;
      const gl = getGl();
      if (!nativeTexture || !decodedFrame || !THREE || !gl) return setParityVerdict(sourceKey, renderer, false);

      patchFrameDimensions(decodedFrame);
      const width = Number.isFinite(decodedFrame.displayWidth) && decodedFrame.displayWidth > 0 ? decodedFrame.displayWidth : decodedFrame.width;
      const height = Number.isFinite(decodedFrame.displayHeight) && decodedFrame.displayHeight > 0 ? decodedFrame.displayHeight : decodedFrame.height;
      if (!(width > 0 && height > 0)) return setParityVerdict(sourceKey, renderer, false);

      let tempTexture = null;
      try {
        tempTexture = new THREE.Texture(decodedFrame);
        const refTexture = originalTexture || nativeTexture;
        for (const key of TEXTURE_COPY_KEYS) if (refTexture && refTexture[key] !== undefined) tempTexture[key] = refTexture[key];
        tempTexture.generateMipmaps = false;
        tempTexture.needsUpdate = true;

        let resource = parityResources.get(renderer);
        if (!resource) {
          const pass = gl.createCopyPass(THREE);
          if (pass.material && THREE.NoBlending !== undefined) pass.material.blending = THREE.NoBlending;
          resource = { pass, target: null };
          parityResources.set(renderer, resource);
        }
        if (!resource.target || resource.target.width !== width || resource.target.height !== height) {
          resource.target?.dispose?.();
          resource.target = gl.createRenderTarget(THREE, width, height, {
            format: THREE.RGBAFormat, type: THREE.UnsignedByteType, depthBuffer: false, stencilBuffer: false,
          });
        }

        const nativePixels = new Uint8Array(width * height * 4);
        const decodedPixels = new Uint8Array(nativePixels.length);
        resource.pass.renderToScreen = false;
        resource.pass.uniforms?.uvScale?.value?.set?.(1, 1);
        resource.pass.uniforms?.uvOffset?.value?.set?.(0, 0);
        if (resource.pass.uniforms?.opacity) resource.pass.uniforms.opacity.value = 1;

        resource.pass.render(renderer, resource.target, { texture: nativeTexture }, true);
        renderer.readRenderTargetPixels(resource.target, 0, 0, width, height, nativePixels);
        resource.pass.render(renderer, resource.target, { texture: tempTexture }, true);
        renderer.readRenderTargetPixels(resource.target, 0, 0, width, height, decodedPixels);

        for (let i = 0; i < nativePixels.length; i++) {
          if (nativePixels[i] !== decodedPixels[i]) return setParityVerdict(sourceKey, renderer, false);
        }
        return setParityVerdict(sourceKey, renderer, true);
      } catch (_error) {
        return setParityVerdict(sourceKey, renderer, false);
      } finally {
        tempTexture?.dispose?.();
      }
    }

    function invalidateSource(sourceKey) {
      if (!sourceKey) return;
      const source = sources.get(sourceKey);
      if (source) { sources.delete(sourceKey); closeSourceRecord(source); }
      unsupportedSources.delete(sourceKey);
      parityBySource.delete(sourceKey);
      const list = bySource.get(sourceKey);
      if (list) for (const entry of list.slice()) removeEntryFromCache(entry, false);
    }

    function clear() {
      for (const source of sources.values()) closeSourceRecord(source);
      sources.clear();
      unsupportedSources.clear();
      parityBySource.clear();
      for (const schedule of Array.from(pinsBySchedule.keys())) unpinSchedule(schedule);
      pinsBySchedule.clear();
      for (const entry of Array.from(lru.values())) { lru.delete(entry.id); entry.evicted = true; closeEntry(entry); }
      for (const entry of Array.from(evictedPinned.values())) closeEntry(entry);
      evictedPinned.clear();
      bySource.clear();
      cachedBytes = 0;
    }

    function dispose() {
      if (disposed) return;
      disposed = true;
      clear();
      const gl = getGl();
      for (const resource of parityResources.values()) {
        try { resource.target?.dispose?.(); } catch (_error) { /* Best-effort disposal. */ }
        try { gl?.disposePass?.(resource.pass); } catch (_error) { /* Best-effort disposal. */ }
      }
      parityResources.clear();
    }

    return {
      isSupported, isUnsupported, sourceKeyFor, peek, pin, unpinSchedule, getFrame,
      prefetchAhead, getParityVerdict, verifyParity, invalidateSource, clear, dispose,
      get stats() {
        return {
          decoded: counters.decoded, cacheHits: counters.cacheHits,
          prefetchHits: counters.prefetchHits, fallbacks: counters.fallbacks,
          activeFrames, cachedBytes, evicted: counters.evicted,
        };
      },
    };
  }

  const api = {
    DEFAULT_MAX_BYTES, DEFAULT_MAX_FRAMES, DEFAULT_MAX_SOURCES,
    DEFAULT_LOOKAHEAD_COUNT, DEFAULT_STREAM_WINDOW_SECONDS, PTS_EPSILON,
    sourceKeyFor, patchFrameDimensions, createDecoderPool,
  };

  if (global) global.ZoidiumVideoFrameDecoder = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
