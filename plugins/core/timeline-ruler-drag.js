(function installRulerScrub(global) {
  "use strict";

  var prototype = global.PZ?.ui?.timeline?.prototype;
  if (!prototype || typeof prototype.create !== "function") return;
  var create = prototype.create;
  var states = new WeakMap();

  // The native drag caches the ruler origin at pointerdown and reads the copy of
  // the scroll position that only updates on the next scroll event. Read both
  // live instead: keepInView, a Render Time layout change or a zoom can move the
  // ruler or the scrollbar between two moves.
  function rulerPx(timeline, clientX) {
    var ruler = timeline.timerule;
    var rect = ruler.getBoundingClientRect();
    var scale = ruler.clientWidth ? rect.width / ruler.clientWidth : 1;
    var scroll = timeline.scrollBar ? timeline.scrollBar.scrollLeft : 0;
    return (clientX - rect.left) / (scale || 1) + scroll;
  }

  function install(timeline) {
    var drag = timeline.timerule_drag;
    var ruler = timeline.timerule;
    if (!drag || !ruler || states.has(timeline)) return;

    // Replace the native mouse and touch entry points with pointer events.
    // Clearing the flags also stops addElts() from restoring them.
    if (typeof drag.startfn_bound === "function") {
      ruler.removeEventListener("mousedown", drag.startfn_bound);
      ruler.removeEventListener("touchstart", drag.startfn_bound);
    }
    drag.enableMouse = false;
    drag.enableTouch = false;
    // The removed touchstart listener cancelled scrolling; a pointer drag needs
    // the equivalent declaration so a touch scrubs instead of scrolling.
    if (ruler.style) ruler.style.touchAction = "none";

    var ownerDocument = ruler.ownerDocument;
    var win = ownerDocument?.defaultView || global;
    var state = {
      active: false,
      pointerId: null,
      clientX: 0,
      captured: false,
      frame: null,
      timeline: timeline,
      ruler: ruler,
    };
    states.set(timeline, state);

    function apply() {
      if (!state.active) return;
      timeline.setFrame(rulerPx(timeline, state.clientX));
    }

    // keepInView scrolls the timeline while the pointer stays at the edge. The
    // native update loop existed for that; keep it so edge autoscroll survives.
    function tick() {
      state.frame = null;
      if (!state.active) return;
      apply();
      if (typeof win.requestAnimationFrame === "function") {
        state.frame = win.requestAnimationFrame(tick);
      }
    }

    function startFrameLoop() {
      if (state.frame !== null || typeof win.requestAnimationFrame !== "function") return;
      state.frame = win.requestAnimationFrame(tick);
    }

    function removeDragListeners() {
      ruler.removeEventListener("pointermove", move);
      ruler.removeEventListener("pointerup", up);
      ruler.removeEventListener("pointercancel", cancel);
      ruler.removeEventListener("lostpointercapture", lost);
      win.removeEventListener?.("blur", blur);
      ownerDocument?.removeEventListener?.("keydown", key);
    }

    function end() {
      if (!state.active) return;
      state.active = false;
      removeDragListeners();
      if (state.frame !== null) {
        win.cancelAnimationFrame?.(state.frame);
        state.frame = null;
      }
      if (state.captured) {
        state.captured = false;
        try {
          if (typeof ruler.hasPointerCapture !== "function" || ruler.hasPointerCapture(state.pointerId)) {
            ruler.releasePointerCapture(state.pointerId);
          }
        } catch (error) {
          // Capture was already released by the browser.
        }
      }
      state.pointerId = null;
      drag.dragging = false;
      // The playhead draws with scrollBar.scrollLeft; keep the native copy equal
      // so the two cannot stay diverged.
      if (timeline.scrollBar) timeline.scroll = timeline.scrollBar.scrollLeft;
    }

    function move(event) {
      if (!state.active || event.pointerId !== state.pointerId) return;
      if (event.buttons === 0) {
        end();
        return;
      }
      event.preventDefault?.();
      state.clientX = event.clientX;
      apply();
    }

    function up(event) {
      if (!state.active || event.pointerId !== state.pointerId) return;
      event.preventDefault?.();
      end();
    }

    function cancel(event) {
      if (!state.active || event.pointerId !== state.pointerId) return;
      end();
    }

    function lost(event) {
      if (!state.active || event.pointerId !== state.pointerId) return;
      end();
    }

    function blur() {
      end();
    }

    function key(event) {
      if (!state.active || event.key !== "Escape") return;
      event.preventDefault?.();
      end();
    }

    function down(event) {
      if (state.active) return;
      if (event.button !== 0 || event.isPrimary === false) return;
      // Suppress the compatibility mouse events that would otherwise follow.
      event.preventDefault?.();
      state.active = true;
      state.pointerId = event.pointerId;
      state.clientX = event.clientX;
      state.captured = false;
      drag.dragging = true;
      timeline.el?.focus?.();
      ruler.addEventListener("pointermove", move);
      ruler.addEventListener("pointerup", up);
      ruler.addEventListener("pointercancel", cancel);
      ruler.addEventListener("lostpointercapture", lost);
      win.addEventListener?.("blur", blur);
      ownerDocument?.addEventListener?.("keydown", key);
      if (typeof ruler.setPointerCapture === "function" && event.pointerId !== undefined) {
        try {
          ruler.setPointerCapture(event.pointerId);
          state.captured = true;
        } catch (error) {
          state.captured = false;
        }
      }
      apply();
      startFrameLoop();
    }

    function destroy() {
      end();
      ruler.removeEventListener("pointerdown", down);
      states.delete(timeline);
    }

    ruler.addEventListener("pointerdown", down);
    state.destroy = destroy;
  }

  prototype.create = function () {
    var result = create.apply(this, arguments);
    install(this);
    return result;
  };

  // CM3 has no timeline destroy today; keep the hook so a torn-down timeline
  // releases its document and window listeners instead of leaking them.
  var destroy = prototype.destroy;
  prototype.destroy = function () {
    states.get(this)?.destroy?.();
    if (typeof destroy === "function") return destroy.apply(this, arguments);
  };
})(typeof window !== "undefined" ? window : globalThis);
