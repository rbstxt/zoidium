"use strict";
const limit = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const finite = n => Number.isFinite(n) ? n : 0;
// Retain the initial device classification through small inertial tails.
function classifyWheel(event, previous, now) {
  let kind;
  if (event.ctrlKey) kind = "zoom";
  else if (previous && now - previous.time < 220 && previous.ctrl === false) kind = previous.kind;
  else {
    const x = finite(event.deltaX), y = finite(event.deltaY);
    const legacy = Math.abs(event.wheelDeltaY || 0);
    const discrete = event.deltaMode > 0 || (!x && Number.isInteger(y) && Math.abs(y) >= 80) ||
      (!x && legacy >= 120 && legacy % 120 === 0 && Number.isInteger(y));
    kind = discrete ? "zoom" : "pan";
  }
  return { kind, time: now, ctrl: !!event.ctrlKey };
}
function wheelView(view, event, gesture, pointer, ruler) {
  const result = { ...view };
  const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? view.height : 1;
  const dx = limit(finite(event.deltaX) * unit, -2000, 2000);
  const dy = limit(finite(event.deltaY) * unit, -2000, 2000);
  if (event.shiftKey && !event.ctrlKey) result.centerX += (dx || dy) * view.zoomX;
  else if (gesture.kind === "pan" && !event.altKey) {
    result.centerX += dx * view.zoomX;
    if (!ruler) result.centerY += dy * view.zoomY;
  } else {
    const factor = Math.exp(limit(dy * (event.ctrlKey ? .01 : .002), -2, 2));
    const yOnly = event.altKey && !ruler;
    if (!yOnly) {
      result.zoomX = limit(view.zoomX * factor, .02, 500);
      result.centerX += (pointer.x - view.width / 2) * (view.zoomX - result.zoomX);
    }
    if (!ruler && (yOnly || event.ctrlKey)) {
      result.zoomY = limit(view.zoomY * factor, .001, 10000);
      result.centerY += (pointer.y - view.height / 2) * (view.zoomY - result.zoomY);
    }
  }
  result.centerX = limit(result.centerX, -1e12, 1e12);
  result.centerY = limit(result.centerY, -1e12, 1e12);
  return result;
}
module.exports = { classifyWheel, wheelView };
