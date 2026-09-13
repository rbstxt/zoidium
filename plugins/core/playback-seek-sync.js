(function installPlaybackSeekSync(global) {
  "use strict";

  const PATCH_MARKER = "__zoidiumPlaybackSeekSyncPatch";
  // Per-schedule runtime state. This must not share the prototype patch marker:
  // a prototype property is visible through the instance, so reusing the name
  // would make the marker masquerade as state.
  const STATE_KEY = "__zoidiumPlaybackSeekSyncState";
  // A whole-frame request this far from the engine's current position is a
  // reposition. The playback clock moves at most a couple of frames per
  // animation frame, so anything beyond that is an editor jump.
  const SEEK_FRAMES = 2.5;

  // CM3 only writes el.currentTime when the schedule item changes
  // (PZ.schedule.prototype.update). Seeking inside a clip, or into the 60-frame
  // padding window an item is preloaded in, leaves the media element at its old
  // position. PZ.ui.playback.prototype.update then derives the playhead from
  // that element (it becomes syncSchedule as soon as it plays), so the playhead
  // and the audible position separate. Scrubbing near the end of a clip is the
  // worst case: the element never moves, so the timeline parks while the clip
  // audibly restarts from its beginning.
  //
  // This patch keeps the native clock intact and only adds the missing
  // reposition: when the editor requests a frame away from where playback is,
  // the active schedule's media element is moved to the media time that frame
  // maps to. Normal playback, padding preload, drift handling and the export
  // path keep their native behaviour.

  function stateOf(schedule) {
    let state = schedule[STATE_KEY];
    if (state) return state;
    state = { pendingSeek: false, lastFrame: null, playback: null };
    schedule[STATE_KEY] = state;
    return state;
  }

  // Decide whether the playhead was repositioned rather than advanced.
  //
  // The engine writes currentFrame on every clock tick too, so a raw frame delta
  // cannot separate "the user scrubbed" from "playback is running". The two
  // cases are distinguishable by shape: every editor jump lands on a whole frame
  // (PZ.ui.timeline.setFrame rounds, and the keyframe buttons and marker
  // navigation all move to integer frames), while the playback clock advances by
  // a fractional amount per animation frame. A whole-frame request further than
  // SEEK_FRAMES from the engine's position is therefore a reposition.
  function isSeek(state, frame) {
    const previous = state.lastFrame;
    if (!Number.isFinite(previous)) return false;
    if (!Number.isInteger(frame)) return false;
    return Math.abs(frame - previous) > SEEK_FRAMES;
  }

  function markSchedulesForSeek(playback, frame) {
    const sequence = playback && playback._sequence;
    if (!sequence) return;
    const schedules = [].concat(sequence.audioSchedules || [], sequence.videoSchedules || []);
    for (const schedule of schedules) {
      const state = stateOf(schedule);
      state.playback = playback;
      if (!isSeek(state, frame)) continue;
      state.pendingSeek = true;
    }
  }

  function installPlaybackPatch(playbackPrototype) {
    if (playbackPrototype[PATCH_MARKER]) return false;

    const existing = Object.getOwnPropertyDescriptor(playbackPrototype, "currentFrame");
    if (!existing || typeof existing.set !== "function" || !existing.configurable) return false;

    const originalGet = existing.get;
    const originalSet = existing.set;

    Object.defineProperty(playbackPrototype, "currentFrame", {
      configurable: true,
      enumerable: existing.enumerable,
      get() {
        return typeof originalGet === "function" ? originalGet.call(this) : this._currentFrame;
      },
      set(frame) {
        if (typeof frame === "number" && Number.isFinite(frame)) markSchedulesForSeek(this, frame);
        return originalSet.call(this, frame);
      },
    });

    playbackPrototype[PATCH_MARKER] = true;
    return true;
  }

  function sequenceFrameRate(playback) {
    try {
      const sequence = playback && playback._sequence;
      const property = sequence && sequence.properties && sequence.properties.rate;
      const value = property && typeof property.get === "function" ? property.get() : property;
      return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
    } catch (error) {
      return 0;
    }
  }

  function applyPendingSeek(schedule) {
    const state = stateOf(schedule);
    if (!state.pendingSeek) return;
    if (!schedule.el || !schedule.currentItem) return;

    const item = schedule.currentItem;
    const clip = item.clip;
    if (!clip || !clip.properties || !clip.properties.time) return;

    // PZ.schedule.prototype.update receives the engine's rounded playhead, so
    // prefer the playback's exact frame, the same value update() clocks from.
    const source = state.playback;
    const frame = source && Number.isFinite(source._exactFrame)
      ? source._exactFrame
      : schedule.lastFrame;
    if (!Number.isFinite(frame)) return;

    const localFrame = frame - item.start;
    // Ahead of an item's start the padding preload keeps the element ready, but
    // updateSchedule returns early until the playhead reaches item.start. Leave
    // the element at the item head and keep the seek pending for that moment.
    if (localFrame < 0) return;
    if (clip.length && localFrame > clip.length) return;

    let mediaTime;
    try {
      mediaTime = clip.properties.time.get(localFrame);
    } catch (error) {
      return;
    }
    if (typeof mediaTime !== "number" || !Number.isFinite(mediaTime)) return;

    const element = schedule.el;
    // Half a frame of media time is the tightest gap worth correcting: seeking
    // for less than that would thrash the element, and it is inaudible.
    const frameRate = sequenceFrameRate(source);
    const tolerance = frameRate > 0 ? 0.5 / frameRate : 0;
    if (
      typeof element.currentTime === "number" &&
      Math.abs(element.currentTime - mediaTime) > tolerance
    ) {
      element.currentTime = mediaTime;
    }
    // Keep the engine's own bookkeeping consistent: playbackDebug and
    // updateSchedule both read currentItem.offset as "media time at item.start".
    item.offset = mediaTime;

    state.pendingSeek = false;
  }

  function installSchedulePatch(schedulePrototype) {
    if (schedulePrototype[PATCH_MARKER]) return false;

    const existing = Object.getOwnPropertyDescriptor(schedulePrototype, "update");
    const originalUpdate = existing ? existing.value : schedulePrototype.update;
    if (typeof originalUpdate !== "function") return false;
    if (existing && existing.configurable === false) return false;

    function patchedUpdate(frame, frameRate) {
      this.lastFrame = frame;
      const result = originalUpdate.call(this, frame, frameRate);
      // Record where the engine just moved to. A later currentFrame write is a
      // reposition only if it jumps away from this stored position.
      stateOf(this).lastFrame = frame;
      applyPendingSeek(this);
      return result;
    }

    Object.defineProperty(schedulePrototype, "update", {
      configurable: true,
      enumerable: existing ? existing.enumerable : false,
      writable: true,
      value: patchedUpdate,
    });

    schedulePrototype[PATCH_MARKER] = true;
    return true;
  }

  function install(PZ) {
    const schedule = PZ && PZ.schedule;
    const playback = PZ && PZ.ui && PZ.ui.playback;
    if (!schedule || !schedule.prototype) return false;
    if (!playback || !playback.prototype) return false;

    const playbackReady = playback.prototype[PATCH_MARKER]
      ? true
      : installPlaybackPatch(playback.prototype);
    const scheduleReady = schedule.prototype[PATCH_MARKER]
      ? true
      : installSchedulePatch(schedule.prototype);

    return Boolean(playbackReady && scheduleReady);
  }

  if (typeof module === "object" && module.exports) {
    module.exports = {
      PATCH_MARKER,
      STATE_KEY,
      SEEK_FRAMES,
      install,
      installPlaybackPatch,
      installSchedulePatch,
      markSchedulesForSeek,
      applyPendingSeek,
    };
    return;
  }

  install(global && global.PZ);
})(typeof window !== "undefined" ? window : null);
