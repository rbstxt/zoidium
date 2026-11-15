(function installPlaybackMediaClock(global) {
  "use strict";

  // CM3 clocks playback from the first media element that started playing
  // (PZ.ui.playback.prototype.update reads syncSchedule.el.currentTime). When
  // that element stops advancing while playback runs, the playhead stops with
  // it: Chrome pauses muted video and suspends media in background tabs, a
  // play() can be interrupted, and a starving element waits for data. The
  // editor then stayed frozen or crawled at about 1 fps after alt-tab until
  // the user stopped and restarted playback (Discord, 2026-11-14).
  //
  // This patch keeps the native media clock while its element can run, clocks
  // a tick from the frame time while it cannot, and asks a paused element that
  // CM3 still counts as playing to play again. Export does not use this path.
  const MARKER = "__zoidiumPlaybackMediaClock";
  const STATE = "__zoidiumPlaybackMediaClockState";
  // HTMLMediaElement.HAVE_FUTURE_DATA: below it currentTime does not advance.
  const HAVE_FUTURE_DATA = 3;
  // A rejected play() (autoplay policy, interrupted load) is retried at most
  // this often, so a refusing element never turns into a per-tick loop.
  const RETRY_MS = 500;

  function now() {
    return typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();
  }

  // Whether an element's currentTime can clock playback right now.
  function canClock(schedule) {
    const element = schedule && schedule.el;
    if (!element || !schedule.playing || !schedule.currentItem) return false;
    return !element.paused && !element.seeking && !element.ended &&
      !(element.readyState < HAVE_FUTURE_DATA);
  }

  function schedulesOf(playback) {
    const sequence = playback && playback._sequence;
    if (!sequence) return [];
    return [].concat(sequence.audioSchedules || [], sequence.videoSchedules || []);
  }

  // The native anchor when it runs; otherwise another running element, or
  // none (frame-time clock) until one runs again.
  function chooseAnchor(playback) {
    const current = playback.syncSchedule;
    if (!current || canClock(current)) return current;
    for (const schedule of schedulesOf(playback)) if (canClock(schedule)) return schedule;
    return null;
  }

  function resume(playback, schedule) {
    const element = schedule && schedule.el;
    if (!element || !schedule.playing || !schedule.currentItem) return;
    if (!element.paused || element.ended || !(playback.speed > 0)) return;
    let state = schedule[STATE];
    if (!state) state = schedule[STATE] = { retryAt: 0 };
    const time = now();
    if (time < state.retryAt) return;
    state.retryAt = time + RETRY_MS;
    try {
      const pending = element.play();
      if (pending && typeof pending.catch === "function") pending.catch(() => {});
    } catch (_error) {
      // A synchronous failure waits for the next retry window.
    }
  }

  function install(PZ) {
    const prototype = PZ && PZ.ui && PZ.ui.playback && PZ.ui.playback.prototype;
    if (!prototype || typeof prototype.update !== "function" ||
        typeof prototype.updateSchedule !== "function") return false;
    if (prototype[MARKER]) return true;
    const update = prototype.update, updateSchedule = prototype.updateSchedule;
    prototype.update = function mediaClockUpdate() {
      if (this.speed !== 0 && this.syncSchedule) this.syncSchedule = chooseAnchor(this);
      return update.apply(this, arguments);
    };
    prototype.updateSchedule = function mediaClockUpdateSchedule(schedule) {
      const result = updateSchedule.apply(this, arguments);
      resume(this, schedule);
      return result;
    };
    prototype[MARKER] = true;
    return true;
  }

  if (typeof module === "object" && module.exports) {
    module.exports = { MARKER, HAVE_FUTURE_DATA, RETRY_MS, canClock, chooseAnchor, install, resume };
    return;
  }
  install(global && global.PZ);
})(typeof window !== "undefined" ? window : null);
