"use strict";
// Pointer ownership/cancellation is independent of geometry and CM3.
// Only an explicit cancel (Escape, an error) rolls a gesture back. Anything
// that merely interrupts it — lost capture, pointercancel, window blur, a
// release the page never saw — keeps what the preview already shows, so an
// edit never silently snaps back.
const DRAG_DISTANCE = 3;
function createPointerMachine(
  element,
  begin,
  ownerWindow,
  onError = (error) => {
    throw error;
  },
) {
  let active = null,
    disposed = false,
    lastMoved = false;
  const consume = (event) => {
    event.preventDefault();
    event.stopPropagation();
  };
  function finish(cancel, event) {
    const state = active;
    if (!state) return;
    active = null;
    lastMoved = state.moved;
    try {
      if (cancel) state.gesture.cancel?.(event);
      else state.gesture.end?.(event);
    } finally {
      if (element.hasPointerCapture?.(state.id))
        element.releasePointerCapture(state.id);
    }
  }
  function down(event) {
    if (disposed || event.isPrimary === false || ![0, 1].includes(event.button))
      return;
    // Another pointer cannot take over a gesture. A second press of the same
    // pointer means its release was lost (outside the window, or swallowed
    // by the OS): close the stale gesture first.
    if (active && active.id !== event.pointerId) return;
    if (active) finish(false, event);
    let gesture;
    try {
      gesture = begin(event);
    } catch (error) {
      onError(error);
      consume(event);
      return;
    }
    consume(event);
    lastMoved = false;
    if (!gesture) return;
    active = { id: event.pointerId, gesture, x: event.clientX, y: event.clientY, moved: false };
    try {
      element.setPointerCapture(event.pointerId);
    } catch (_error) {
      // Without capture the gesture still receives events over the canvas.
    }
  }
  function move(event) {
    if (active?.id !== event.pointerId) return;
    consume(event);
    // A mouse with every button up but no pointerup: the release was lost.
    if (event.pointerType === "mouse" && event.buttons === 0) {
      finish(false, event);
      return;
    }
    if (Math.hypot(event.clientX - active.x, event.clientY - active.y) >= DRAG_DISTANCE)
      active.moved = true;
    try {
      active.gesture.move?.(event);
    } catch (error) {
      finish(true, event);
      onError(error);
    }
  }
  function up(event) {
    if (active?.id !== event.pointerId) return;
    consume(event);
    finish(false, event);
  }
  function interrupt(event) {
    if (event?.pointerId !== undefined && active?.id !== event.pointerId)
      return;
    finish(false, event);
  }
  element.addEventListener("pointerdown", down);
  element.addEventListener("pointermove", move);
  element.addEventListener("pointerup", up);
  element.addEventListener("pointercancel", interrupt);
  element.addEventListener("lostpointercapture", interrupt);
  ownerWindow.addEventListener("blur", interrupt);
  return {
    // Roll the gesture back (Escape, undo while dragging).
    cancel: () => finish(true),
    // Keep the gesture's changes and end it.
    commit: () => finish(false),
    get active() {
      return active?.gesture || null;
    },
    // Whether the last finished press travelled far enough to be a drag.
    get lastMoved() {
      return lastMoved;
    },
    dispose() {
      finish(false);
      disposed = true;
      element.removeEventListener("pointerdown", down);
      element.removeEventListener("pointermove", move);
      element.removeEventListener("pointerup", up);
      element.removeEventListener("pointercancel", interrupt);
      element.removeEventListener("lostpointercapture", interrupt);
      ownerWindow.removeEventListener("blur", interrupt);
    },
  };
}
module.exports = { createPointerMachine };
