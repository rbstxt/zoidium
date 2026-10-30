"use strict";
const { expressionOf } = require("./property-state.js");

const { easingPoints, ExpressionSamples } = require("./sampling.js");
var gpNextGroupId = 1;

module.exports = function (environment) {
const { PZ, SVGNS, displayName, scaleFactorOf } = environment;
/* ---------- keyframes / curves ---------- */
PZ.ui.graph.prototype.refreshAdjacentCurves = function (kfEl) {
  var prev = kfEl.previousElementSibling ? kfEl.previousElementSibling.pz_object : null;
  var cur = kfEl.pz_object;
  var next = kfEl.nextElementSibling ? kfEl.nextElementSibling.pz_object : null;
  this.updateKeyframe(kfEl);
  if (kfEl.pz_handles) this.updateHandles(kfEl.pz_handles);
  this.updateCurve(kfEl.pz_curveLeft, prev, cur);
  this.updateCurve(kfEl.pz_curveRight, cur, next);
  // neighbor curves that share path
  if (kfEl.previousElementSibling && kfEl.previousElementSibling.pz_curveRight)
    this.updateCurve(kfEl.previousElementSibling.pz_curveRight, prev, cur);
  if (kfEl.nextElementSibling && kfEl.nextElementSibling.pz_curveLeft)
    this.updateCurve(kfEl.nextElementSibling.pz_curveLeft, cur, next);
};
PZ.ui.graph.prototype.onKeyframeCreated = function (gel, kfObj) {
  var kfEl = this.createKeyframe(kfObj);
  var keys = gel._keys;
  var rel = kfObj.frame;
  var at = keys.firstElementChild;
  while (at && at.pz_object.frame < rel) at = at.nextElementSibling;
  // if exact frame exists (from live mutation + event), replace visuals
  if (at && at.pz_object.frame === rel && at.pz_object !== kfObj) {
    // swap object reference to live one
    at.pz_object = kfObj;
    this.updateKeyframe(at);
    if (at.classList.contains("selected")) {
      if (!at.pz_handles) { at.pz_handles = this.createHandles(kfObj); gel._handles.appendChild(at.pz_handles); }
      this.updateHandles(at.pz_handles);
    }
    this.refreshAdjacentCurves(at);
    return;
  }
  keys.insertBefore(kfEl, at);
  this.updateKeyframe(kfEl);
  var curves = gel._curves;
  var prev = kfEl.previousElementSibling, next = kfEl.nextElementSibling;
  if (prev && next) {
    kfEl.pz_curveLeft = this.createCurve();
    kfEl.pz_curveRight = next.pz_curveLeft;
    prev.pz_curveRight = kfEl.pz_curveLeft;
    curves.insertBefore(kfEl.pz_curveLeft, kfEl.pz_curveRight);
    this.updateCurve(kfEl.pz_curveLeft, prev.pz_object, kfEl.pz_object);
    this.updateCurve(kfEl.pz_curveRight, kfEl.pz_object, next.pz_object);
  } else if (prev && !next) {
    kfEl.pz_curveLeft = prev.pz_curveRight;
    kfEl.pz_curveRight = this.createCurve();
    curves.appendChild(kfEl.pz_curveRight);
    this.updateCurve(kfEl.pz_curveLeft, prev.pz_object, kfEl.pz_object);
    this.updateCurve(kfEl.pz_curveRight, kfEl.pz_object, null);
  } else if (!prev && next) {
    kfEl.pz_curveLeft = this.createCurve();
    kfEl.pz_curveRight = next.pz_curveLeft;
    curves.insertBefore(kfEl.pz_curveLeft, kfEl.pz_curveRight);
    this.updateCurve(kfEl.pz_curveLeft, null, kfEl.pz_object);
    this.updateCurve(kfEl.pz_curveRight, kfEl.pz_object, next.pz_object);
  } else {
    kfEl.pz_curveLeft = this.createCurve();
    kfEl.pz_curveRight = this.createCurve();
    curves.appendChild(kfEl.pz_curveLeft);
    curves.appendChild(kfEl.pz_curveRight);
    this.updateCurve(kfEl.pz_curveLeft, null, kfEl.pz_object);
    this.updateCurve(kfEl.pz_curveRight, kfEl.pz_object, null);
  }
  if (this.selectNewKeyframes) this.selectKeyframe(kfEl);
  this.updateLegend();
  this.positionLabel(gel);
};
PZ.ui.graph.prototype.onKeyframeDeleted = function (gel, kfObj) {
  var at = gel._keys.firstElementChild;
  while (at && at.pz_object !== kfObj) at = at.nextElementSibling;
  if (!at) return;
  this.deselectKeyframe(at);
  var prev = at.previousElementSibling, next = at.nextElementSibling;
  if (prev) {
    at.pz_curveRight.remove();
    if (next) {
      next.pz_curveLeft = prev.pz_curveRight;
      this.updateCurve(at.pz_curveLeft, prev.pz_object, next.pz_object);
    } else {
      this.updateCurve(at.pz_curveLeft, prev.pz_object, null);
    }
  } else {
    at.pz_curveLeft.remove();
    if (next) this.updateCurve(at.pz_curveRight, null, next.pz_object);
    else at.pz_curveRight.remove();
  }
  if (at.pz_handles) { at.pz_handles.remove(); at.pz_handles = null; }
  at.remove();
  this.updateLegend();
};
PZ.ui.graph.prototype.onKeyframeMoved = function (gel, evt, kfObj) {
  // Native finishMove emits once per key. Rebuild once after the gesture,
  // including undo and redo, so moving a dense axis does not rebuild it N times.
  if (gel._moveRedrawPending) return;
  gel._moveRedrawPending = true;
  Promise.resolve().then(() => {
    gel._moveRedrawPending = false;
    if (!gel.parentElement) return;
    this.redrawAllKeyframes(gel);
    this.updateLegend();
  });
};
PZ.ui.graph.prototype.onKeyframeChanged = function (gel, kfObj) {
  var at = gel._keys.firstElementChild;
  while (at && at.pz_object !== kfObj) at = at.nextElementSibling;
  if (!at) return;
  this.refreshScaleFor(gel);
  this.refreshAdjacentCurves(at);
  this.positionLabel(gel);
};
PZ.ui.graph.prototype.createHandles = function (kfObj) {
  var g = this._doc().createElementNS(SVGNS, "g");
  g.pz_object = kfObj;
  var mk = function () {
    var e = g.ownerDocument.createElementNS(SVGNS, "ellipse");
    e.setAttributeNS(null, "fill", "var(--zui-accent)");
    e.setAttributeNS(null, "stroke", "var(--zui-border)");
    e.setAttributeNS(null, "stroke-width", "1.5px");
    e.setAttributeNS(null, "vector-effect", "non-scaling-stroke");
    e.classList.add("g2-hdl");
    return e;
  };
  var h0 = mk(), h1 = mk();
  var l0 = g.ownerDocument.createElementNS(SVGNS, "line");
  var l1 = g.ownerDocument.createElementNS(SVGNS, "line");
  [l0, l1].forEach(function (l) {
    l.setAttributeNS(null, "stroke", "var(--zui-text-muted)");
    l.setAttributeNS(null, "stroke-width", "1px");
    l.setAttributeNS(null, "vector-effect", "non-scaling-stroke");
    l.style.pointerEvents = "none";
  });
  g.appendChild(h0); g.appendChild(h1); g.appendChild(l0); g.appendChild(l1);
  return g;
};
PZ.ui.graph.prototype.updateHandles = function (hEl) {
  var kf = hEl.pz_object;
  if (!kf || typeof kf.value !== "number" || !isFinite(kf.value) || !isFinite(kf.frame)) { hEl.style.display = "none"; return; }
  var gel = hEl.parentElement.parentElement;
  var scale = (gel && gel.pz_valueScale) || 1;
  var s = this.options.handleSize;
  hEl.style.transform = "translate(" + kf.frame + "px," + (-kf.value * scale) + "px)";
  // SVG g transform via attribute for reliability
  hEl.setAttributeNS(null, "transform", "translate(" + kf.frame + " " + (-kf.value * scale) + ")");
  var h0 = hEl.children[0], h1 = hEl.children[1], l0 = hEl.children[2], l1 = hEl.children[3];
  var bez = kf.tween >> 8;
  hEl.style.display = bez ? "" : "none";
  if (!bez) return;
  h0.setAttributeNS(null, "rx", 0.5 * s * this.zoomX);
  h0.setAttributeNS(null, "ry", 0.5 * s * this.zoomY);
  h0.setAttributeNS(null, "cx", kf.controlPoints[0][0]);
  h0.setAttributeNS(null, "cy", -kf.controlPoints[0][1] * scale);
  h1.setAttributeNS(null, "rx", 0.5 * s * this.zoomX);
  h1.setAttributeNS(null, "ry", 0.5 * s * this.zoomY);
  h1.setAttributeNS(null, "cx", kf.controlPoints[1][0]);
  h1.setAttributeNS(null, "cy", -kf.controlPoints[1][1] * scale);
  l0.setAttributeNS(null, "x1", 0); l0.setAttributeNS(null, "y1", 0);
  l0.setAttributeNS(null, "x2", kf.controlPoints[0][0]); l0.setAttributeNS(null, "y2", -kf.controlPoints[0][1] * scale);
  l1.setAttributeNS(null, "x1", 0); l1.setAttributeNS(null, "y1", 0);
  l1.setAttributeNS(null, "x2", kf.controlPoints[1][0]); l1.setAttributeNS(null, "y2", -kf.controlPoints[1][1] * scale);
};
PZ.ui.graph.prototype.createKeyframe = function (kfObj) {
  var gelColor = "var(--zui-text-bright)";
  var r = this._doc().createElementNS(SVGNS, "rect");
  r.classList.add("g2-kf");
  r.setAttributeNS(null, "stroke", "transparent");
  r.setAttributeNS(null, "stroke-width", (2 * this.options.keyframeSize) + "px");
  r.setAttributeNS(null, "vector-effect", "non-scaling-stroke");
  r.pz_object = kfObj;
  r.pz_curveLeft = null; r.pz_curveRight = null; r.pz_handles = null;
  r.setAttributeNS(null, "fill", gelColor);
  this.attachKeyframeHandlers(r);
  return r;
};
PZ.ui.graph.prototype.updateKeyframe = function (kfEl) {
  var kf = kfEl.pz_object;
  if (!kf || typeof kf.value !== "number" || !isFinite(kf.value) || !isFinite(kf.frame)) { kfEl.style.display = "none"; return; }
  kfEl.style.display = "";
  var gel = kfEl.parentElement.parentElement;
  var scale = (gel && gel.pz_valueScale) || 1;
  var s = this.options.keyframeSize;
  var sel = kfEl.classList.contains("selected");
  var isHold = false, isBez = false;
  try { isHold = (PZ.tween.easingList[255 & kf.tween].fn === null); isBez = (kf.tween >> 8) !== 0; } catch (e) {}
  kfEl.setAttributeNS(null, "width", s * this.zoomX);
  kfEl.setAttributeNS(null, "height", s * this.zoomY);
  kfEl.setAttributeNS(null, "x", kf.frame - 0.5 * s * this.zoomX);
  kfEl.setAttributeNS(null, "y", -kf.value * scale - 0.5 * s * this.zoomY);
  // Theme accent marks selected keys; hollow keys keep the same geometry.
  kfEl.setAttributeNS(null, "rx", 0.5 * s * this.zoomX);
  if (sel) {
    kfEl.style.fill = "var(--zui-accent)";
    kfEl.style.stroke = "var(--zui-text-bright)";
  } else if (isHold) {
    kfEl.style.fill = "var(--zui-bg-input)";
    kfEl.style.stroke = "var(--zui-text-muted)";
  } else {
    kfEl.style.fill = "var(--zui-bg-input)";
    kfEl.style.stroke = "var(--zui-accent)";
  }
  kfEl.setAttributeNS(null, "stroke-width", (sel ? 3 : 2.5) + "px");
  if (!kf.continuousTangent && isBez) kfEl.setAttributeNS(null, "stroke-dasharray", "2 1");
  else kfEl.removeAttribute("stroke-dasharray");
};
PZ.ui.graph.prototype.selectKeyframe = function (kfEl) {
  if (expressionOf(kfEl.parentElement.parentElement.pz_object)) return;
  if (kfEl.classList.contains("selected")) return;
  var gel = kfEl.parentElement.parentElement;
  kfEl.pz_handles = this.createHandles(kfEl.pz_object);
  gel._handles.appendChild(kfEl.pz_handles);
  // wire handles
  var h0 = kfEl.pz_handles.children[0], h1 = kfEl.pz_handles.children[1];
  this.attachHandleHandlers(h0, 0, kfEl);
  this.attachHandleHandlers(h1, 1, kfEl);
  kfEl.pz_oldControlPoints = JSON.parse(JSON.stringify(kfEl.pz_object.controlPoints));
  this.updateHandles(kfEl.pz_handles);
  kfEl.classList.add("selected");
  this.updateKeyframe(kfEl);
  if (this.options.linkAxes && !this._selectingLinked) {
    this._selectingLinked = true;
    for (var sibling of this.timeKeys([kfEl])) if (sibling !== kfEl) this.selectKeyframe(sibling);
    this._selectingLinked = false;
  }
};
PZ.ui.graph.prototype.deselectKeyframe = function (kfEl) {
  if (!kfEl.classList.contains("selected")) return;
  if (kfEl.pz_handles) { kfEl.pz_handles.remove(); kfEl.pz_handles = null; }
  kfEl.classList.remove("selected");
  try { this.updateKeyframe(kfEl); } catch (e) { /* A detached key needs no visual refresh. */ }
};
PZ.ui.graph.prototype.deselectAllKeyframes = function () {
  var sel = this.svg ? Array.from(this.svg.querySelectorAll(".g2-kf.selected")) : [];
  for (var i = 0; i < sel.length; i++) this.deselectKeyframe(sel[i]);
  this.updateStatus();
};
PZ.ui.graph.prototype.createCurve = function () {
  var p = this._doc().createElementNS(SVGNS, "path");
  p.setAttributeNS(null, "vector-effect", "non-scaling-stroke");
  p.setAttributeNS(null, "fill", "none");
  p.classList.add("g2-cv");
  p.pz_left = null; p.pz_right = null;
  return p;
};
PZ.ui.graph.prototype.updateCurve = function (path, leftKf, rightKf) {
  if (!path) return;
  // skip curves with non-numeric values (e.g. option/text props) instead of poisoning with NaN
  if (leftKf && (typeof leftKf.value !== "number" || !isFinite(leftKf.value) || !isFinite(leftKf.frame))) leftKf = null;
  if (rightKf && (typeof rightKf.value !== "number" || !isFinite(rightKf.value) || !isFinite(rightKf.frame))) rightKf = null;
  if (!leftKf && !rightKf) { path.setAttributeNS(null, "d", "M 0 0"); return; }
  path.pz_left = leftKf || null; path.pz_right = rightKf || null;
  var gel = path.parentElement.parentElement;
  var scale = (gel && gel.pz_valueScale) || 1;
  var off = (gel && gel.pz_frameOffset) || 0;
  var col = (gel && gel.pz_color) || "var(--zui-text-muted)";
  path.setAttributeNS(null, "stroke", col);
  path.setAttributeNS(null, "stroke-width", this.options.curveLineWidth + "px");
  path.setAttributeNS(null, "opacity", gel && gel.style.display === "none" ? "0.15" : "1");
  var sX, sY, eX, eY;
  if (leftKf) { sX = leftKf.frame; sY = -leftKf.value * scale; }
  else {
    var endR = rightKf ? rightKf.frame : 0;
    sX = Math.min(this.centerX - off - 0.5 * this.width * this.zoomX, endR);
    sY = rightKf ? -rightKf.value * scale : 0;
  }
  if (rightKf) { eX = rightKf.frame; eY = -rightKf.value * scale; }
  else {
    eX = Math.max(this.centerX - off + 0.5 * this.width * this.zoomX, leftKf.frame);
    eY = -leftKf.value * scale;
  }
  // Keep path coordinates in screen units so the SVG rasterizer sees an
  // isotropic transform even when the graph zoom differs greatly by axis.
  var originX = this.zoomX ? (this.centerX || 0) - off : 0, originY = this.centerY || 0;
  var zoomX = this.zoomX || 1, zoomY = this.zoomY || 1;
  function sx(x) { return (x - originX) / zoomX; }
  function sy(y) { return (y - originY) / zoomY; }
  if (this.zoomX && this.zoomY) path.setAttributeNS(null, "transform", "translate(" + originX + " " + originY + ") scale(" + zoomX + " " + zoomY + ")");
  var d;
  if (leftKf && rightKf && ((rightKf.tween >> 8) === 1) && (rightKf.tween & 255)) {
    var corr = 1;
    try { corr = PZ.tween.correctCurve(leftKf, rightKf); } catch (e) {}
    var c1x = leftKf.controlPoints[1][0] * corr + leftKf.frame;
    var c1y = -leftKf.controlPoints[1][1] * scale * corr - leftKf.value * scale;
    var c2x = rightKf.controlPoints[0][0] * corr + rightKf.frame;
    var c2y = -rightKf.controlPoints[0][1] * scale * corr - rightKf.value * scale;
    d = "M " + sx(sX) + " " + sy(sY) + " C " + sx(c1x) + " " + sy(c1y) + ", " + sx(c2x) + " " + sy(c2y) + ", " + sx(eX) + " " + sy(eY);
  } else if (leftKf && rightKf) {
    var easeIdx = rightKf.tween & 255;
    var fn = null;
    try { fn = PZ.tween.easingList[easeIdx].fn; } catch (e) {}
    if (!fn) {
      // hold/step (user design 5): flat run then sharp vertical jump at key
      d = "M " + sx(sX) + " " + sy(sY) + " L " + sx(eX) + " " + sy(sY) + " L " + sx(eX) + " " + sy(eY);
    } else if (easeIdx === 1) {
      d = "M " + sx(sX) + " " + sy(sY) + " L " + sx(eX) + " " + sy(eY);
    } else {
      d = "M " + sx(sX) + " " + sy(sY);
      easingPoints(fn, Math.abs(eX - sX) / zoomX, (eY - sY) / zoomY).slice(1).forEach(function (point) {
        d += " L " + sx(sX + (eX - sX) * point[0]) + " " + sy(sY + (eY - sY) * point[1]);
      });
    }
  } else {
    d = "M " + sx(sX) + " " + sy(sY) + " L " + sx(eX) + " " + sy(eY);
  }
  path.setAttributeNS(null, "d", d);
};
PZ.ui.graph.prototype.drawExpression = function (gel) {
  if (!expressionOf(gel.pz_object) || !gel._expression) return;
  if (!this._expressionSamples) this._expressionSamples = new ExpressionSamples();
  var off = gel.pz_frameOffset || 0;
  var record = this._expressionSamples.sample(gel.pz_object,
    this.centerX - this.width * this.zoomX / 2 - off,
    this.centerX + this.width * this.zoomX / 2 - off, this.zoomX, this._expressionBudget);
  gel._samples = record;
  if (this.options.normalize) {
    var maxAbs = record.points.reduce((max, point) => Number.isFinite(point[1]) ? Math.max(max, Math.abs(point[1])) : max, 0);
    gel.pz_valueScale = 80 / (maxAbs > 1e-9 ? maxAbs : 1);
  }
  var ox = this.centerX - off, oy = this.centerY;
  var path = gel._expression, d = "", connected = false;
  record.points.forEach((point) => {
    if (!Number.isFinite(point[1])) { connected = false; return; }
    d += (connected ? " L " : " M ") + ((point[0] - ox) / this.zoomX) + " " +
      ((-point[1] * gel.pz_valueScale - oy) / this.zoomY);
    connected = true;
  });
  path.setAttributeNS(null, "transform", "translate(" + ox + " " + oy + ") scale(" + this.zoomX + " " + this.zoomY + ")");
  path.setAttributeNS(null, "d", d);
  path.setAttributeNS(null, "stroke", gel.pz_color);
  path.setAttributeNS(null, "stroke-width", this.options.curveLineWidth);
  path.setAttributeNS(null, "stroke-dasharray", "6 4");
};
PZ.ui.graph.prototype.redrawAllKeyframes = function (gel) {
  // BUGFIX: preserve selection across redraw (was losing sel on move)
  var keep = {};
  try {
    var cur = gel._keys ? Array.prototype.slice.call(gel._keys.querySelectorAll(".selected")) : [];
    for (var q = 0; q < cur.length; q++) if (cur[q].pz_object) keep[cur[q].pz_object.frame] = true;
  } catch (e) { /* Selection snapshot is best-effort; the keys redraw regardless. */ }
  while (gel._keys.firstChild) gel._keys.firstChild.remove();
  while (gel._curves.firstChild) gel._curves.firstChild.remove();
  while (gel._handles.firstChild) gel._handles.firstChild.remove();
  var prop = gel.pz_object;
  this.refreshScaleFor(gel);
  if (expressionOf(prop)) {
    gel._expression = this.createCurve();
    gel._curves.appendChild(gel._expression);
    this.drawExpression(gel);
    return;
  }
  for (var i = 0; i < prop.keyframes.length; i++) {
    this.onKeyframeCreated(gel, prop.keyframes[i]);
  }
  try {
    var keys = gel._keys.children;
    for (var k = 0; k < keys.length; k++) {
      if (keep[keys[k].pz_object.frame]) this.selectKeyframe(keys[k]);
    }
  } catch (e) { /* Selection restore is best-effort; the keys are already redrawn. */ }
  this.positionLabel(gel);
};
PZ.ui.graph.prototype.positionLabel = function (gel) {
  if (!gel._label) return;
  gel._label.setAttributeNS(null, "class", "g2-curve-label");
  var show = this.options.showLabels !== false;
  gel._label.style.display = show ? "" : "none";
  if (!show) return;
  var prop = gel.pz_object;
  if (!prop || !prop.keyframes.length) { gel._label.textContent = ""; return; }
  var last = prop.keyframes[prop.keyframes.length - 1];
  if (typeof last.value !== "number" || !isFinite(last.value)) { gel._label.textContent = ""; return; }
  var scale = gel.pz_valueScale || 1;
  var x = last.frame;
  var y = -last.value * scale;
  // counter-scale like grid text so "Position.Z" isn't stretched
  gel._label.setAttributeNS(null, "transform", "translate(" + x + " " + y + ") scale(" + this.zoomX + " " + this.zoomY + ")");
  gel._label.setAttributeNS(null, "x", 8);
  gel._label.setAttributeNS(null, "y", -7);
  gel._label.setAttributeNS(null, "font-size", "11");
  gel._label.setAttributeNS(null, "fill", "var(--zui-text-bright)");
  gel._label.textContent = displayName(prop);
};
PZ.ui.graph.prototype.createProperty = function (prop) {
  var doc = this._doc();
  var g = doc.createElementNS(SVGNS, "g");
  g.pz_object = prop;
  g.pz_frameOffset = 0;
  g._gid = "g" + (gpNextGroupId++);
  g.pz_color = this.graphColor(prop);
  g.pz_valueScale = 1 / (scaleFactorOf(prop) || 1);
  var curves = doc.createElementNS(SVGNS, "g");
  curves.setAttributeNS(null, "fill", "none");
  curves.setAttributeNS(null, "stroke-width", this.options.curveLineWidth + "px");
  curves.setAttributeNS(null, "stroke", g.pz_color);
  g.appendChild(curves);
  g._curves = curves;
  var keys = doc.createElementNS(SVGNS, "g");
  g.appendChild(keys);
  g._keys = keys;
  var handles = doc.createElementNS(SVGNS, "g");
  g.appendChild(handles);
  g._handles = handles;
  var label = doc.createElementNS(SVGNS, "text");
  label.setAttributeNS(null, "fill", g.pz_color);
  label.setAttributeNS(null, "font-family", "var(--zui-font)");
  label.style.pointerEvents = "none";
  g.appendChild(label);
  g._label = label;
  var self = this;
  g.pz_keyframeCreated = function (kf, idx) { self.onKeyframeCreated(g, kf); };
  prop.onKeyframeCreated.watch(g.pz_keyframeCreated);
  g.el_keyframeDeleted = function (kf) { self.onKeyframeDeleted(g, kf); };
  prop.onKeyframeDeleted.watch(g.el_keyframeDeleted);
  g.pz_keyframeMoved = function (a, b) { self.onKeyframeMoved(g, a, b); };
  prop.onKeyframeMoved.watch(g.pz_keyframeMoved);
  g.pz_keyframeChanged = function (kf) { self.onKeyframeChanged(g, kf); };
  prop.onKeyframeChanged.watch(g.pz_keyframeChanged);
  try {
    var clip = prop.tryGetParentOfType(PZ.clip);
    if (clip) {
      g.pz_sequence = clip.getParentOfType(PZ.sequence);
      g.pz_clipMoved = function () {
        g.pz_frameOffset = clip.start;
        g.setAttributeNS(null, "transform", "translate(" + clip.start + " 0)");
        self.updateViewBox();
      };
      g.pz_sequence.ui.onClipMoved.watch(g.pz_clipMoved, true);
    }
  } catch (e) { /* Properties outside clips need no offset tracking. */ }
  g.pz_expressionChanged = function () { self._expressionSamples?.invalidate(); self.redrawAllKeyframes(g); self.updateViewBox(); self.updateLegend(); };
  prop.onExpressionChanged?.watch(g.pz_expressionChanged);
  g.pz_groupExpressionSignal = prop.parent?.parent?.onExpressionChanged;
  g.pz_groupExpressionSignal?.watch(g.pz_expressionChanged);
  g.pz_projectChanged = function () {
    if (self._projectRefreshQueued) return;
    self._projectRefreshQueued = true;
    Promise.resolve().then(function () {
      self._projectRefreshQueued = false;
      self._expressionSamples?.invalidate();
      self.pruneDetachedProperties();
      self.updateViewBox();
    });
  };
  g.pz_projectSignal = this.editor.project?.ui?.onChanged;
  g.pz_projectSignal?.watch(g.pz_projectChanged);
  this.refreshScaleFor(g);
  this.redrawAllKeyframes(g);
  if (this.isHidden(prop)) g.style.display = "none";
  return g;
};
PZ.ui.graph.prototype.unloadProperty = function (g) {
  var prop = g.pz_object;
  try {
    if (g.pz_nameChanged && prop.properties && prop.properties.name) prop.properties.name.onChanged.unwatch(g.pz_nameChanged);
    prop.onExpressionChanged?.unwatch(g.pz_expressionChanged);
    g.pz_groupExpressionSignal?.unwatch(g.pz_expressionChanged);
    g.pz_projectSignal?.unwatch(g.pz_projectChanged);
    prop.onKeyframeCreated.unwatch(g.pz_keyframeCreated);
    prop.onKeyframeDeleted.unwatch(g.el_keyframeDeleted);
    prop.onKeyframeMoved.unwatch(g.pz_keyframeMoved);
    prop.onKeyframeChanged.unwatch(g.pz_keyframeChanged);
    if (g.pz_clipMoved && g.pz_sequence) g.pz_sequence.ui.onClipMoved.unwatch(g.pz_clipMoved);
  } catch (e) { /* Unwatching a torn-down observable needs no cleanup. */ }
};
PZ.ui.graph.prototype.objectAdded = function (prop) {
  if (!(prop instanceof PZ.property.dynamic.keyframes)) return;
  var g = this.createProperty(prop);
  this.curveLayer.appendChild(g);
  this.updateViewBox();
  this.updateLegend();
  if (!this._didInitView) { this._didInitView = true; this.fitAll(false); }
};
PZ.ui.graph.prototype.objectRemoved = function (prop) {
  var groups = this.propGroups();
  for (var i = 0; i < groups.length; i++) {
    if (groups[i].pz_object === prop) {
      this.unloadProperty(groups[i]);
      groups[i].remove();
      break;
    }
  }
  this.updateLegend();
  this.updateViewBox();
};
PZ.ui.graph.prototype.objectsChanged = function () {
  if (!this.curveLayer) return;
  // clear all
  var groups = this.propGroups();
  for (var i = 0; i < groups.length; i++) this.unloadProperty(groups[i]);
  while (this.curveLayer.firstChild) this.curveLayer.firstChild.remove();
  this.deselectAllKeyframes();
  if (this.objects) {
    for (var k = 0; k < this.objects.length; k++) {
      var prop = this.objects[k];
      if (prop instanceof PZ.property.dynamic.keyframes) {
        var g = this.createProperty(prop);
        this.curveLayer.appendChild(g);
      } else if (prop instanceof PZ.property.dynamic.group) {
        // expand group children (X/Y/Z, R/G/B) as separate curves
        for (var j = 0; j < prop.objects.length; j++) {
          var sub = prop.objects[j];
          if (sub instanceof PZ.property.dynamic.keyframes) {
            var g2 = this.createProperty(sub);
            this.curveLayer.appendChild(g2);
          }
        }
      }
    }
  }
  this._selectedAxes = null;
  this.refreshAllScales();
  this.updateLegend();
  this.updateViewBox();
  if (!this._didInitView && this.propGroups().length) { this._didInitView = true; this.fitAll(false); }
};
};
