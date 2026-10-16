"use strict";
// Pointer ownership/cancellation is independent of geometry and CM3.
function createPointerMachine(element, begin, ownerWindow) {
  let active = null,
    disposed = false;
  const consume = (event) => {
    event.preventDefault();
    event.stopPropagation();
  };
  function finish(cancel, event) {
    const state = active;
    if (!state) return;
    active = null;
    try {
      if (cancel) state.gesture.cancel?.(event);
      else state.gesture.end?.(event);
    } finally {
      if (element.hasPointerCapture?.(state.id))
        element.releasePointerCapture(state.id);
    }
  }
  function down(event) {
    if (
      disposed ||
      active ||
      event.isPrimary === false ||
      ![0, 1].includes(event.button)
    )
      return;
    const gesture = begin(event);
    consume(event);
    if (!gesture) return;
    active = { id: event.pointerId, gesture };
    try {
      element.setPointerCapture(event.pointerId);
    } catch (_error) {
      finish(true, event);
    }
  }
  function move(event) {
    if (active?.id !== event.pointerId) return;
    consume(event);
    try {
      active.gesture.move?.(event);
    } catch (error) {
      finish(true, event);
      throw error;
    }
  }
  function up(event) {
    if (active?.id !== event.pointerId) return;
    consume(event);
    finish(false, event);
  }
  function cancel(event) {
    if (event?.pointerId !== undefined && active?.id !== event.pointerId)
      return;
    finish(true, event);
  }
  element.addEventListener("pointerdown", down);
  element.addEventListener("pointermove", move);
  element.addEventListener("pointerup", up);
  element.addEventListener("pointercancel", cancel);
  element.addEventListener("lostpointercapture", cancel);
  ownerWindow.addEventListener("blur", cancel);
  return {
    cancel: () => cancel(),
    get active() {
      return active?.gesture || null;
    },
    dispose() {
      cancel();
      disposed = true;
      element.removeEventListener("pointerdown", down);
      element.removeEventListener("pointermove", move);
      element.removeEventListener("pointerup", up);
      element.removeEventListener("pointercancel", cancel);
      element.removeEventListener("lostpointercapture", cancel);
      ownerWindow.removeEventListener("blur", cancel);
    },
  };
}
module.exports = { createPointerMachine };
