// Paused plain-video seek preview: while paused, hold the viewport draw until a
// plain video schedule's pending seek has settled, then redraw exactly once.
// Playback, export, temporal video and projects without video are unchanged.
(function installPausedVideoSeek(global) {
  "use strict";

  const PATCH_MARKER = "__zoidiumPausedVideoSeekPatch";
  const PENDING_KEY = "__zoidiumPausedSeek";
  const EXPIRED_KEY = "__zoidiumPausedSeekExpired";
  const EPSILON = 1e-6;

  const api = {
    timeoutMs: 1500,
    install,
    expectedMediaTime,
    correctedTarget,
    needsWait,
  };

  // Media time the schedule's current item maps to at this project frame, or
  // null when the schedule has no active plain item here.
  function expectedMediaTime(schedule, frame) {
    const item = schedule && schedule.currentItem;
    if (!item || !item.media) return null;
    if (!Number.isInteger(frame) || frame < item.start || frame >= item.start + item.length) return null;
    const clip = item.clip;
    if (!clip || !clip.properties || !clip.properties.time) return null;
    try {
      const mediaTime = clip.properties.time.get(frame - item.start);
      return typeof mediaTime === "number" && Number.isFinite(mediaTime) ? mediaTime : null;
    } catch (_error) {
      return null;
    }
  }

  function correctedTarget(video, mediaTime) {
    try {
      const seekTime = global.ZoidiumVideoSeekPolicy &&
        global.ZoidiumVideoSeekPolicy.seekTime;
      if (typeof seekTime === "function") return seekTime(video, mediaTime);
    } catch (_error) { /* Fall back to the uncorrected request. */ }
    return mediaTime;
  }

  function isVideoSchedule(PZ, schedule) {
    const videoType = PZ && PZ.schedule && PZ.schedule.type && PZ.schedule.type.VIDEO;
    if (videoType !== undefined && videoType !== null) return schedule.type === videoType;
    return Boolean(schedule.el && schedule.currentItem);
  }

  // Temporal video owns its own exact preview preparation; leave it alone.
  function isTemporalSchedule(PZ, schedule, frame) {
    if (schedule.__zoidiumExactDecodePending) return true;
    if (schedule.__zoidiumTemporalPlayback) return true;
    try {
      const map = PZ && PZ.zoidium && PZ.zoidium.temporal &&
        PZ.zoidium.temporal.mapScheduleClip;
      if (typeof map === "function" && schedule.currentItem && schedule.currentItem.clip) {
        const mapped = map(schedule.currentItem.clip, frame);
        if (mapped && Math.abs(mapped.sourceFrame - mapped.localFrame) > 1e-9) return true;
      }
    } catch (_error) { /* A failed mapping check must not block the preview. */ }
    return false;
  }

  // A bounded-timeout fallback already presented this target: keep drawing the
  // available frame instead of holding the preview forever.
  function expiredFor(schedule, target, frame) {
    const expired = schedule && schedule[EXPIRED_KEY];
    return Boolean(expired && expired.frame === frame &&
      Math.abs(expired.target - target) <= EPSILON);
  }

  // True while the element cannot yet present the target time.
  function needsWait(schedule, target, frame) {
    const video = schedule && schedule.el;
    if (!video) return false;
    if (typeof target !== "number" || !Number.isFinite(target)) return false;
    if (expiredFor(schedule, target, frame)) return false;
    try {
      if (video.seeking) return true;
      if (typeof video.readyState === "number" && video.readyState < 2) return true;
      if (typeof video.currentTime !== "number") return true;
      return Math.abs(video.currentTime - target) > EPSILON;
    } catch (_error) {
      return true;
    }
  }

  function cancelPending(schedule) {
    const pending = schedule && schedule[PENDING_KEY];
    if (!pending) return;
    try {
      if (pending.timer != null) clearTimeout(pending.timer);
    } catch (_error) { /* A cleared timer must not block the preview. */ }
    try {
      pending.video.removeEventListener("seeked", pending.onSeeked);
      pending.video.removeEventListener("error", pending.onError);
    } catch (_error) { /* Detached elements may reject listener removal. */ }
    try {
      if (pending.rvfcId != null && typeof pending.video.cancelVideoFrameCallback === "function") {
        pending.video.cancelVideoFrameCallback(pending.rvfcId);
      }
    } catch (_error) { /* Cancellation is best-effort. */ }
    if (schedule[PENDING_KEY] === pending) delete schedule[PENDING_KEY];
  }

  function currentFrameOf(viewport) {
    const frame = viewport && viewport.editor && viewport.editor.playback &&
      viewport.editor.playback.currentFrame;
    return Number.isInteger(frame) && frame >= 0 ? frame : null;
  }

  function pausedViewport(viewport) {
    if (!viewport || viewport.renderMode) return false;
    const playback = viewport.editor && viewport.editor.playback;
    if (!playback) return false;
    if (playback.speed !== 0) return false;
    const sequence = viewport.editor.project && viewport.editor.project.sequence;
    return Boolean(sequence);
  }

  function pendingSchedules(PZ, viewport, frame) {
    const sequence = viewport.editor.project.sequence;
    const schedules = sequence.videoSchedules || [];
    const pending = [];
    for (const schedule of schedules) {
      if (!schedule || !schedule.el) continue;
      if (!isVideoSchedule(PZ, schedule)) continue;
      if (isTemporalSchedule(PZ, schedule, frame)) continue;
      const mediaTime = expectedMediaTime(schedule, frame);
      if (mediaTime === null) continue;
      const target = correctedTarget(schedule.el, mediaTime);
      if (needsWait(schedule, target, frame)) pending.push({ schedule, target });
    }
    return pending;
  }

  // A switched project must not receive a late redraw, and a removed layer's
  // schedule must not be touched; the other waiters for the frame still redraw.
  function sequenceOf(viewport) {
    try {
      return viewport.editor.project.sequence;
    } catch (_error) {
      return undefined;
    }
  }

  function settle(PZ, viewport, schedule, frame, fallback = false, sequence = null) {
    const wasPending = Boolean(schedule[PENDING_KEY]);
    cancelPending(schedule);
    if (sequence && sequenceOf(viewport) !== sequence) return;
    const removed = Boolean(sequence) && !(sequence.videoSchedules || []).includes(schedule);
    if (fallback || !wasPending) {
      // The bounded fallback (or an untracked error) presents the available
      // frame: later ticks at this target must draw live, not re-arm the gate.
      try {
        schedule[EXPIRED_KEY] = { target: correctedTarget(schedule.el,
          expectedMediaTime(schedule, frame) ?? NaN), frame };
      } catch (_error) { /* The redraw still proceeds. */ }
    } else {
      try {
        delete schedule[EXPIRED_KEY];
      } catch (_error) { /* A stale flag only costs one extra redraw. */ }
    }
    try {
      if (schedule.texture && !removed) schedule.texture.needsUpdate = true;
    } catch (_error) { /* The redraw still presents the settled frame. */ }
    // A newer request supersedes this one: only the current frame redraws,
    // and only once every plain schedule for it has settled.
    if (currentFrameOf(viewport) !== frame) return;
    const PZRoot = (global && global.PZ) || PZ;
    for (const { schedule: other, target } of pendingSchedules(PZRoot, viewport, frame)) {
      if (other === schedule) continue;
      if (needsWait(other, target, frame)) return;
      // A schedule that settled without our tracking still blocks the redraw
      // until its own pending entry settles below.
      if (other[PENDING_KEY]) return;
    }
    for (const other of (viewport.editor.project.sequence.videoSchedules || [])) {
      if (other && other[PENDING_KEY]) return;
    }
    try {
      viewport.lastFrame = -1;
      viewport._render();
    } catch (_error) { /* A torn-down viewport cannot redraw. */ }
  }

  function trackPending(PZ, viewport, schedule, target, frame) {
    const existing = schedule[PENDING_KEY];
    // Coalesce: a repeated tick for the same target frame keeps one waiter.
    if (existing && existing.frame === frame && Math.abs(existing.target - target) <= EPSILON) return;
    cancelPending(schedule);
    try {
      delete schedule[EXPIRED_KEY];
    } catch (_error) { /* A stale flag only costs one extra redraw. */ }
    const video = schedule.el;
    const sequence = sequenceOf(viewport) || null;
    const pending = { video, target, frame, timer: null, rvfcId: null };
    pending.onSeeked = () => {
      // A queued completion from an older seek cannot settle the new target.
      if (schedule[PENDING_KEY] !== pending) return;
      if (video.seeking) return;
      if (typeof video.requestVideoFrameCallback === "function") {
        try {
          pending.rvfcId = video.requestVideoFrameCallback(() => {
            pending.rvfcId = null;
            if (schedule[PENDING_KEY] !== pending) return;
            settle(PZ, viewport, schedule, frame, false, sequence);
          });
          return;
        } catch (_error) { /* Fall through to the immediate settle. */ }
      }
      settle(PZ, viewport, schedule, frame, false, sequence);
    };
    pending.onError = () => {
      if (schedule[PENDING_KEY] !== pending) return;
      settle(PZ, viewport, schedule, frame, true, sequence);
    };
    try {
      video.addEventListener("seeked", pending.onSeeked);
      video.addEventListener("error", pending.onError);
    } catch (_error) {
      settle(PZ, viewport, schedule, frame, true, sequence);
      return;
    }
    try {
      pending.timer = setTimeout(() => settle(PZ, viewport, schedule, frame, true, sequence), api.timeoutMs);
    } catch (_error) {
      settle(PZ, viewport, schedule, frame, true, sequence);
      return;
    }
    schedule[PENDING_KEY] = pending;
  }

  function shouldGate(PZ, viewport, frame) {
    let pending;
    try {
      pending = pendingSchedules(PZ, viewport, frame);
    } catch (_error) {
      return false;
    }
    if (!pending.length) {
      // Synchronously settled schedules release their waiters without a redraw:
      // the draw about to happen already presents the settled frame.
      for (const schedule of (viewport.editor.project.sequence.videoSchedules || [])) {
        if (schedule && schedule[PENDING_KEY] &&
          !needsWait(schedule, schedule[PENDING_KEY].target, frame)) {
          cancelPending(schedule);
          try {
            if (schedule.texture) schedule.texture.needsUpdate = true;
          } catch (_cleanupError) { /* The live draw proceeds regardless. */ }
        }
      }
      return false;
    }
    for (const { schedule, target } of pending) trackPending(PZ, viewport, schedule, target, frame);
    return true;
  }

  function install(host) {
    const root = host || global;
    const PZ = root && root.PZ;
    const viewportType = PZ && PZ.ui && PZ.ui.viewport;
    if (!viewportType || !viewportType.prototype) return false;
    let prototype = viewportType.prototype;
    while (prototype && !Object.prototype.hasOwnProperty.call(prototype, "_render")) {
      prototype = Object.getPrototypeOf(prototype);
    }
    if (!prototype || typeof prototype._render !== "function") return false;
    if (prototype[PATCH_MARKER]) return true;
    const originalRender = prototype._render;
    prototype._render = function pausedSeekViewportRender() {
      const frame = currentFrameOf(this);
      if (frame === null || !pausedViewport(this)) {
        // Playback owns the media clock: release any stale paused waiter so a
        // late seeked event or timeout cannot inject an extra redraw.
        if (frame !== null) {
          try {
            const sequence = this.editor.project.sequence;
            for (const schedule of (sequence.videoSchedules || [])) {
              if (schedule && schedule[PENDING_KEY]) cancelPending(schedule);
              if (schedule && schedule[EXPIRED_KEY]) {
                try {
                  delete schedule[EXPIRED_KEY];
                } catch (_cleanupError) { /* Playback proceeds without the gate. */ }
              }
            }
          } catch (_error) { /* Playback proceeds without the gate. */ }
        }
        return originalRender.apply(this, arguments);
      }
      const PZRoot = (root && root.PZ) || (typeof PZ !== "undefined" ? PZ : null);
      if (shouldGate(PZRoot || root, this, frame)) return;
      return originalRender.apply(this, arguments);
    };
    Object.defineProperty(prototype, PATCH_MARKER, { configurable: true, value: true });
    return true;
  }

  if (typeof module === "object" && module.exports) {
    module.exports = api;
    return;
  }

  install(global);
})(typeof window !== "undefined" ? window : globalThis);
