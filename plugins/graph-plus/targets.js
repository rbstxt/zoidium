"use strict";
function nearestTarget(targets, x, y, radius) {
  return targets.map(target => ({ target, distance: Math.hypot(target.x - x, target.y - y) }))
    .filter(hit => hit.distance <= radius)
    .sort((a, b) => Number(!!b.target.handle) - Number(!!a.target.handle) || a.distance - b.distance)[0]?.target;
}
function visibleHandle(cp, zoomX, zoomY, scale, index) {
  let x = cp[0] / zoomX, y = -cp[1] * scale / zoomY;
  const length = Math.hypot(x, y);
  if (length < 24) {
    if (length < 1e-9) { x = index ? 24 : -24; y = 0; }
    else { x *= 24 / length; y *= 24 / length; }
  }
  return [x * zoomX, y * zoomY];
}
function constrainHandle(cp, event, neighbourSlope) {
  let [x, y] = cp;
  if (event.ctrlKey || event.metaKey) {
    const slope = x ? y / x : Infinity;
    const candidates = [0, neighbourSlope].filter(Number.isFinite);
    const best = candidates.sort((a,b) => Math.abs(a - slope) - Math.abs(b - slope))[0];
    if (best !== undefined && Math.abs(Math.atan(slope) - Math.atan(best)) < Math.PI / 12) y = x * best;
  } else if (event.shiftKey) {
    const length = Math.hypot(x,y), angle = Math.round(Math.atan2(y,x) / (Math.PI/4)) * Math.PI/4;
    x = length * Math.cos(angle); y = length * Math.sin(angle);
  }
  return [x,y];
}
module.exports = { nearestTarget, visibleHandle, constrainHandle };
