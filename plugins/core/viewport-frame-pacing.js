// Zoidium Core — viewport frame pacing and video texture upload gating.
// Avoids redundant compositor draws when the rAF cadence (60-240 Hz) outpaces
// the project frame rate or when the editor is paused and completely idle.
// Also gates native <video> texture uploads in PZ.ui.playback.prototype.updateSchedule
// so unchanged frames do not force per-rAF gl.texImage2D uploads and 60 fps clips
// respect the project frame rate during playback.
(function installViewportFramePacing(global) {
  "use strict";

  if (global.ZoidiumFramePacing) {
    if (typeof module === "object" && module.exports) {
      module.exports = global.ZoidiumFramePacing;
    }
    return;
  }

  const VIEWPORT_RENDER_PATCH = "__zoidiumFramePacingRender";
  const VIEWPORT_RESIZE_PATCH = "__zoidiumFramePacingResize";
  const PLAYBACK_SCHEDULE_PATCH = "__zoidiumFramePacingUpdateSchedule";
  const TIME_EPSILON = 1e-6;
  const EMPTY_ARRAY = Object.freeze([]);
  const hasWeakRef = typeof WeakRef === "function";

  let enabled = true;
  let globalInvalidationEpoch = 0;
  let nextIdentity = 0;
  let installedPZ = null;
  let subscribedEditSignals = null;
  let editSubscription = null;

  const stats = {
    renders: 0,
    skippedRenders: 0,
    videoUploads: 0,
    skippedVideoUploads: 0,
  };

  const identities = new WeakMap();
  const viewportStates = new WeakMap();
  const scheduleStates = new WeakMap();
  const watchedProjectChanges = new WeakSet();
  const watchedEventTargets = new WeakSet();
  const trackedViewports = new Set();

  function identity(value) {
    if (!value || (typeof value !== "object" && typeof value !== "function")) {
      return value == null ? 0 : value;
    }
    let id = identities.get(value);
    if (id === undefined) {
      id = ++nextIdentity;
      identities.set(value, id);
    }
    return id;
  }

  function isPacingActive() {
    return enabled === true && global.__zoidiumDisableFramePacing !== true;
  }

  function trackViewport(viewport) {
    if (!viewport || typeof viewport !== "object") return;
    if (viewportStates.has(viewport)) return;
    viewportStates.set(viewport, {
      dirty: true,
      dirtyVersion: 0,
      lastRenderedFrame: null,
      lastEditEpoch: -1,
      lastSignature: null,
      lastVideoSnapshots: null,
      lastInvalidationEpoch: -1,
      lastInvalidReason: "init",
    });
    trackedViewports.add(hasWeakRef ? new WeakRef(viewport) : viewport);
  }

  function ensureViewportState(viewport) {
    trackViewport(viewport);
    return viewportStates.get(viewport);
  }

  function ensureScheduleState(schedule) {
    let state = scheduleStates.get(schedule);
    if (!state) {
      state = {
        lastFrame: null,
        lastItem: null,
        lastTime: null,
        lastReadyState: null,
        forcedDirty: false,
      };
      scheduleStates.set(schedule, state);
    }
    return state;
  }

  function forEachTrackedViewport(visitor) {
    for (const entry of trackedViewports) {
      const viewport = hasWeakRef ? entry.deref() : entry;
      if (!viewport) {
        trackedViewports.delete(entry);
        continue;
      }
      visitor(viewport);
    }
  }

  function invalidate(viewport, reason) {
    const label = reason || "manual";
    if (viewport && typeof viewport === "object") {
      const state = ensureViewportState(viewport);
      state.dirty = true;
      state.dirtyVersion += 1;
      state.lastInvalidReason = label;
      return;
    }
    globalInvalidationEpoch += 1;
    forEachTrackedViewport((tracked) => {
      const state = viewportStates.get(tracked);
      if (state) {
        state.dirty = true;
        state.dirtyVersion += 1;
        state.lastInvalidReason = label;
      }
    });
  }

  function markVideoDirty(schedule) {
    if (schedule && typeof schedule === "object") {
      const state = ensureScheduleState(schedule);
      state.forcedDirty = true;
      if (schedule.texture) {
        try {
          schedule.texture.needsUpdate = true;
        } catch (_error) { /* Texture updates are best-effort. */ }
      }
    }
    invalidate(null, "video-dirty");
  }

  function attachAssetEventTarget(target) {
    if (!target || typeof target.addEventListener !== "function") return;
    if (watchedEventTargets.has(target)) return;
    watchedEventTargets.add(target);
    try {
      target.addEventListener("zoidium:asset-status", () => invalidate(null, "asset-status"));
      target.addEventListener("zoidium:asset-reloaded", () => invalidate(null, "asset-reloaded"));
    } catch (_error) { /* Event listeners are best-effort. */ }
  }

  function ensureGlobalSubscriptions() {
    const currentSignals = global.ZoidiumEditSignals || null;
    if (currentSignals !== subscribedEditSignals) {
      try {
        editSubscription?.unwatch?.();
      } catch (_error) { /* Unwatch is best-effort. */ }
      subscribedEditSignals = currentSignals;
      editSubscription = null;
      if (currentSignals && typeof currentSignals.subscribe === "function") {
        try {
          editSubscription = currentSignals.subscribe((reason) => {
            invalidate(null, reason ? "edit:" + reason : "edit");
          });
        } catch (_error) { /* Subscription is best-effort. */ }
      }
    }
    attachAssetEventTarget(global);
    attachAssetEventTarget(global.document);
  }

  function ensureProjectChangeWatch(editor) {
    const observable = editor?.onProjectChanged;
    if (!observable || typeof observable.watch !== "function") return;
    if (watchedProjectChanges.has(observable)) return;
    watchedProjectChanges.add(observable);
    try {
      observable.watch(() => invalidate(null, "project-changed"));
    } catch (_error) { /* Project change watch is best-effort. */ }
  }

  function currentFrameOf(viewport) {
    const frame = viewport?.editor?.playback?.currentFrame;
    return typeof frame === "number" && Number.isInteger(frame) && frame >= 0 ? frame : null;
  }

  function serializeRenderSettings(settings) {
    if (settings == null) return "";
    if (typeof settings !== "object") return String(settings);
    try {
      return JSON.stringify(settings);
    } catch (_error) {
      return "#" + identity(settings);
    }
  }

  function computeSignature(viewport) {
    const editor = viewport?.editor;
    const project = editor?.project || null;
    const sequence = project?.sequence || null;
    const renderer = viewport?.renderer || null;
    const gl = renderer?.context ||
      (typeof renderer?.getContext === "function" ? renderer.getContext() : null);
    const width = gl?.drawingBufferWidth ?? renderer?.drawingBufferWidth ?? viewport?.canvas?.width ?? "";
    const height = gl?.drawingBufferHeight ?? renderer?.drawingBufferHeight ?? viewport?.canvas?.height ?? "";
    const shadowEnabled = renderer?.shadowMap?.enabled ?? "";
    const shadowType = renderer?.shadowMap?.type ?? "";
    const toneMapping = renderer?.toneMapping ?? "";
    const toneMappingExposure = renderer?.toneMappingExposure ?? "";
    const fontsStatus = global.document?.fonts?.status ?? "";
    const tracks = sequence?.videoTracks;
    let enabledFlags = "";
    let soloFlags = "";
    if (Array.isArray(tracks)) {
      for (let i = 0; i < tracks.length; i += 1) {
        const track = tracks[i];
        enabledFlags += track ? (track.enabled !== false ? "1" : "0") : "_";
        soloFlags += track && (track.zoidiumSolo === true || track.solo === true) ? "1" : "0";
      }
    }
    const renderSettings = serializeRenderSettings(viewport?.compositor?.__zoidiumRenderSettings);
    return [
      identity(project),
      identity(sequence),
      width,
      height,
      shadowEnabled,
      shadowType,
      toneMapping,
      toneMappingExposure,
      fontsStatus,
      enabledFlags,
      soloFlags,
      renderSettings,
    ].join("\x1f");
  }

  function isTemporalPreviewPending(viewport) {
    const compositor = viewport?.compositor;
    if (!compositor) return false;
    const globalRuntime = global.PZ?.zoidium?.temporal?.frameSamplerRuntimes?.get?.(compositor);
    if (globalRuntime?.previewPending) return true;
    if (installedPZ && installedPZ !== global.PZ) {
      const localRuntime = installedPZ.zoidium?.temporal?.frameSamplerRuntimes?.get?.(compositor);
      if (localRuntime?.previewPending) return true;
    }
    return false;
  }

  function areAssetsComplete(project) {
    if (!project) return true;
    const fn = global.ZoidiumOutputFrameStore?.assetsComplete;
    if (typeof fn !== "function") return true;
    try {
      return fn(project) !== false;
    } catch (_error) {
      return false;
    }
  }

  function visibleVideoSchedules(sequence, frame) {
    const schedules = sequence?.videoSchedules;
    if (!Array.isArray(schedules) || schedules.length === 0) return EMPTY_ARRAY;
    const tracks = sequence?.videoTracks;
    let anySolo = false;
    if (Array.isArray(tracks)) {
      for (let i = 0; i < tracks.length; i += 1) {
        const track = tracks[i];
        if (track && (track.zoidiumSolo === true || track.solo === true)) {
          anySolo = true;
          break;
        }
      }
    }
    const visible = [];
    for (let i = 0; i < schedules.length; i += 1) {
      const schedule = schedules[i];
      if (!schedule) continue;
      const item = schedule.currentItem;
      if (!item) continue;
      if (Number.isFinite(item.start) && Number.isFinite(item.length) && Number.isInteger(frame)) {
        if (frame < item.start || frame >= item.start + item.length) continue;
      }
      const clip = item.clip;
      if (clip && Array.isArray(tracks)) {
        let track = null;
        if (tracks.includes(clip.parent)) track = clip.parent;
        else if (tracks.includes(clip.parent?.parent)) track = clip.parent.parent;
        if (track) {
          if (track.enabled === false) continue;
          if (global.ZoidiumTrackSwitches?.excludedBySolo?.(track, tracks)) continue;
          if (anySolo && !(track.zoidiumSolo === true || track.solo === true)) continue;
        }
      }
      visible.push(schedule);
    }
    return visible;
  }

  function hasPendingVideoSchedule(visible) {
    for (let i = 0; i < visible.length; i += 1) {
      const schedule = visible[i];
      if (
        schedule.__zoidiumPausedSeek ||
        schedule.el?.seeking ||
        schedule.__zoidiumExactDecodePending ||
        schedule.__zoidiumWebCodecsPending
      ) {
        return true;
      }
    }
    return false;
  }

  function snapshotVisibleVideos(visible) {
    if (visible.length === 0) return EMPTY_ARRAY;
    const snapshots = new Array(visible.length);
    for (let i = 0; i < visible.length; i += 1) {
      const schedule = visible[i];
      const el = schedule.el;
      snapshots[i] = {
        schedule,
        currentItem: schedule.currentItem || null,
        readyState: el ? el.readyState : undefined,
        currentTime: el ? el.currentTime : undefined,
      };
    }
    return snapshots;
  }

  function videoSnapshotsMatch(previous, visible, isPaused) {
    if (!previous || previous.length !== visible.length) return false;
    for (let i = 0; i < visible.length; i += 1) {
      const prev = previous[i];
      const curr = visible[i];
      if (curr !== prev.schedule) return false;
      if ((curr.currentItem || null) !== prev.currentItem) return false;
      const el = curr.el;
      const readyState = el ? el.readyState : undefined;
      if (readyState !== prev.readyState) return false;
      if (isPaused && !curr.__zoidiumWebCodecsActive) {
        const currentTime = el ? el.currentTime : undefined;
        if (typeof currentTime === "number" && typeof prev.currentTime === "number") {
          if (Math.abs(currentTime - prev.currentTime) > TIME_EPSILON) return false;
        } else if (currentTime !== prev.currentTime) {
          return false;
        }
      }
    }
    return true;
  }

  function shouldSkipRender(viewport, state, frame) {
    if (!isPacingActive()) return false;
    if (viewport.renderMode) return false;
    if (viewport.__zoidiumImmediateOutput || viewport.__zoidiumLivePreviewGrid) return false;
    if (viewport.__zoidiumPlayerPlusPaused) return false;
    if (frame === null) return false;
    if (viewport.lastFrame !== frame || state.lastRenderedFrame !== frame) return false;
    if (state.dirty || state.lastInvalidationEpoch !== globalInvalidationEpoch) return false;

    const editSignals = global.ZoidiumEditSignals;
    if (editSignals) {
      if (editSignals.isHot?.()) return false;
      if (editSignals.gestureActive?.()) return false;
      if (editSignals.epoch !== state.lastEditEpoch) return false;
    } else if (state.lastEditEpoch !== undefined) {
      return false;
    }
    if (viewport.editor?.history?.operation) return false;

    const signature = computeSignature(viewport);
    if (signature !== state.lastSignature) return false;

    if (isTemporalPreviewPending(viewport)) return false;

    const project = viewport.editor?.project || null;
    if (!areAssetsComplete(project)) return false;

    const sequence = project?.sequence || null;
    const visible = visibleVideoSchedules(sequence, frame);
    if (hasPendingVideoSchedule(visible)) return false;

    const isPaused = viewport.editor?.playback?.speed === 0;
    if (!videoSnapshotsMatch(state.lastVideoSnapshots, visible, isPaused)) return false;

    return true;
  }

  function recordRenderedState(viewport, state, frame, beforeDirtyVersion, beforeGlobalEpoch, beforeEditEpoch) {
    if (
      frame === null ||
      viewport.renderMode ||
      viewport.__zoidiumImmediateOutput ||
      viewport.__zoidiumLivePreviewGrid ||
      viewport.__zoidiumRenderFailed
    ) {
      state.dirty = true;
      state.lastRenderedFrame = null;
      return;
    }
    const afterFrame = currentFrameOf(viewport);
    if (afterFrame !== frame || viewport.lastFrame !== frame) {
      state.dirty = true;
      state.lastRenderedFrame = null;
      return;
    }
    const editEpoch = global.ZoidiumEditSignals ? global.ZoidiumEditSignals.epoch : undefined;
    const invalidatedDuringRender =
      state.dirtyVersion !== beforeDirtyVersion ||
      globalInvalidationEpoch !== beforeGlobalEpoch ||
      editEpoch !== beforeEditEpoch;
    const project = viewport.editor?.project || null;
    const visible = visibleVideoSchedules(project?.sequence || null, frame);
    state.lastRenderedFrame = viewport.lastFrame;
    state.lastInvalidationEpoch = globalInvalidationEpoch;
    state.lastEditEpoch = editEpoch;
    state.lastSignature = computeSignature(viewport);
    state.lastVideoSnapshots = snapshotVisibleVideos(visible);
    state.dirty = invalidatedDuringRender || isTemporalPreviewPending(viewport) || hasPendingVideoSchedule(visible);
  }

  function hasPatchInChain(prototype, marker) {
    let current = prototype;
    while (current) {
      if (Object.prototype.hasOwnProperty.call(current, marker)) return true;
      current = Object.getPrototypeOf(current);
    }
    return false;
  }

  function findMethodOwner(prototype, methodName) {
    let current = prototype;
    while (current && !Object.prototype.hasOwnProperty.call(current, methodName)) {
      current = Object.getPrototypeOf(current);
    }
    return current && typeof current[methodName] === "function" ? current : null;
  }

  function installViewportHooks(PZ) {
    const viewportCtor = PZ?.ui?.viewport;
    if (!viewportCtor || !viewportCtor.prototype) return false;
    let patched = false;

    const renderProto = findMethodOwner(viewportCtor.prototype, "render");
    if (renderProto) {
      if (!hasPatchInChain(viewportCtor.prototype, VIEWPORT_RENDER_PATCH)) {
        const originalRender = renderProto.render;
        renderProto.render = function pacedViewportRender() {
          const viewport = this;
          ensureGlobalSubscriptions();
          ensureProjectChangeWatch(viewport.editor);
          const state = ensureViewportState(viewport);
          const frame = currentFrameOf(viewport);

          if (shouldSkipRender(viewport, state, frame)) {
            const ownDesc = Object.getOwnPropertyDescriptor(viewport, "_render");
            const canShadow = !ownDesc || ownDesc.configurable || ownDesc.writable;
            if (canShadow) {
              let suppressed = false;
              Object.defineProperty(viewport, "_render", {
                configurable: true,
                writable: true,
                value: function skippedViewportDraw() {
                  suppressed = true;
                },
              });
              try {
                return originalRender.apply(viewport, arguments);
              } finally {
                if (ownDesc) Object.defineProperty(viewport, "_render", ownDesc);
                else delete viewport._render;
                if (suppressed) stats.skippedRenders += 1;
              }
            }
          }

          const beforeDirtyVersion = state.dirtyVersion;
          const beforeGlobalEpoch = globalInvalidationEpoch;
          const beforeEditEpoch = global.ZoidiumEditSignals ? global.ZoidiumEditSignals.epoch : undefined;
          const result = originalRender.apply(viewport, arguments);
          if (!viewport.__zoidiumRenderFailed) {
            stats.renders += 1;
          }
          recordRenderedState(viewport, state, frame, beforeDirtyVersion, beforeGlobalEpoch, beforeEditEpoch);
          return result;
        };
        Object.defineProperty(renderProto, VIEWPORT_RENDER_PATCH, { configurable: true, value: true });
      }
      patched = true;
    }

    const resizeProto = findMethodOwner(viewportCtor.prototype, "resize");
    if (resizeProto) {
      if (!hasPatchInChain(viewportCtor.prototype, VIEWPORT_RESIZE_PATCH)) {
        const originalResize = resizeProto.resize;
        resizeProto.resize = function pacedViewportResize() {
          invalidate(this, "resize");
          try {
            return originalResize.apply(this, arguments);
          } finally {
            invalidate(this, "resize");
          }
        };
        Object.defineProperty(resizeProto, VIEWPORT_RESIZE_PATCH, { configurable: true, value: true });
      }
      patched = true;
    }

    return patched;
  }

  function installPlaybackHooks(PZ) {
    const playbackCtor = PZ?.ui?.playback;
    if (!playbackCtor || !playbackCtor.prototype) return false;
    const scheduleProto = findMethodOwner(playbackCtor.prototype, "updateSchedule");
    if (!scheduleProto) return false;
    if (hasPatchInChain(playbackCtor.prototype, PLAYBACK_SCHEDULE_PATCH)) return true;

    const originalUpdateSchedule = scheduleProto.updateSchedule;
    scheduleProto.updateSchedule = function pacedUpdateSchedule(schedule) {
      if (!schedule || schedule.type !== 0 || !schedule.texture) {
        return originalUpdateSchedule.apply(this, arguments);
      }

      if (schedule.__zoidiumWebCodecsActive) {
        if (schedule.el && !schedule.el.paused) {
          try {
            schedule.el.pause();
          } catch (_error) { /* Pause is best-effort. */ }
        }
        schedule.playing = false;
        if (this.syncSchedule === schedule) this.syncSchedule = null;
        return;
      }

      const state = ensureScheduleState(schedule);
      const wasDirty = Boolean(schedule.texture.needsUpdate);
      const result = originalUpdateSchedule.apply(this, arguments);

      if (!schedule.texture.needsUpdate) {
        if (schedule.el) state.lastReadyState = schedule.el.readyState;
        return result;
      }

      const frame = this.currentFrame;
      const item = schedule.currentItem || null;
      const el = schedule.el || null;
      const readyState = el ? el.readyState : undefined;
      const currentTime = el ? (el.currentTime || 0) : 0;

      if (isPacingActive()) {
        const frameChanged = frame !== state.lastFrame;
        const itemChanged = item !== state.lastItem;
        const forced = state.forcedDirty === true;
        const readyStateChanged = Boolean(el) && readyState !== state.lastReadyState;
        let allowUpload;
        if (this.speed !== 0) {
          allowUpload = frameChanged || itemChanged || forced || readyStateChanged;
        } else {
          const timeChanged = Boolean(el) &&
            (typeof state.lastTime !== "number" || Math.abs(currentTime - state.lastTime) > TIME_EPSILON);
          allowUpload = frameChanged || itemChanged || forced || timeChanged || readyStateChanged;
        }

        if (!allowUpload && !wasDirty) {
          schedule.texture.needsUpdate = false;
          stats.skippedVideoUploads += 1;
          return result;
        }
      }

      state.lastFrame = frame;
      state.lastItem = item;
      state.lastTime = el ? currentTime : null;
      state.lastReadyState = readyState;
      state.forcedDirty = false;
      stats.videoUploads += 1;
      return result;
    };

    Object.defineProperty(scheduleProto, PLAYBACK_SCHEDULE_PATCH, { configurable: true, value: true });
    return true;
  }

  function install(pzOrHost) {
    const PZ = pzOrHost && pzOrHost.ui ? pzOrHost : (pzOrHost?.PZ || global.PZ);
    ensureGlobalSubscriptions();
    if (!PZ || !PZ.ui) return false;
    installedPZ = PZ;
    const viewportPatched = installViewportHooks(PZ);
    const playbackPatched = installPlaybackHooks(PZ);
    return Boolean(viewportPatched || playbackPatched);
  }

  const api = {
    get enabled() { return enabled; },
    set enabled(value) { enabled = Boolean(value); },
    stats,
    invalidate,
    markVideoDirty,
    install,
  };

  global.ZoidiumFramePacing = api;
  ensureGlobalSubscriptions();
  if (global.PZ) install(global.PZ);
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
