"use strict";
const { nearestTarget } = require("./targets.js");
const { classifyWheel, wheelView } = require("./input.js");
const { expressionOf, evaluatedValue } = require("./property-state.js");

// Warn-once reporter for failure sites that run per pointer move or per item:
// the first failure is logged, repeats stay silent so the console stays readable.
var gpWarned = {};
const coarsePointers = new WeakMap();
function gpWarnOnce(key, message, error) {
  if (gpWarned[key]) return;
  gpWarned[key] = true;
  console.warn("[Zoidium] graph-plus: " + message, error);
}

module.exports = function (environment) {
const { PZ, SVGNS, clamp, focusNoScroll, escapeHtml, displayName, currentFrame, totalFrames, g2doc, sharedEmptyNote, beginPointerDrag, gpInjectStyle } = environment;
PZ.ui.graph.prototype.create = function () {
  var self = this;
  // styles must exist in the document that owns this panel (popup window case)
  gpInjectStyle(g2doc(this.el));
  this.el.classList.add("g2-host");
  function mk(tag) {
    try {
      var d = self._doc() || g2doc(self.el);
      if (d && d.createElement) return d.createElement(tag);
    } catch (eMk) {}
    return document.createElement(tag);
  }
  function mkNS(tag) {
    try {
      var d = self._doc() || g2doc(self.el);
      if (d && d.createElementNS) return d.createElementNS(SVGNS, tag);
    } catch (eMkNS) {}
    return document.createElementNS(SVGNS, tag);
  }
  var root = mk("div");
  root.className = "g2-wrap";
  this.el.appendChild(root);
  this.rootEl = root;
  this.toolbarEl = mk("div");
  this.toolbarEl.className = "g2-toolbar";
  root.appendChild(this.toolbarEl);
  // C4D layout: track list column | (frame ruler + canvas)
  this.mainEl = mk("div");
  this.mainEl.className = "g2-main";
  root.appendChild(this.mainEl);
  this.tracksEl = mk("div");
  this.tracksEl.className = "g2-tracks";
  this.mainEl.appendChild(this.tracksEl);
  this.rightEl = mk("div");
  this.rightEl.className = "g2-right";
  this.mainEl.appendChild(this.rightEl);
  // frame ruler (numbers + scrub), aligned with canvas
  this.rulerEl = mk("div");
  this.rulerEl.className = "g2-ruler";
  this.rulerCanvas = mk("canvas");
  this.rulerEl.appendChild(this.rulerCanvas);
  this.rightEl.appendChild(this.rulerEl);
  this.canvasEl = mk("div");
  this.canvasEl.className = "g2-canvas";
  this.canvasEl.setAttribute("tabindex", "0");
  this.rightEl.appendChild(this.canvasEl);
  this.bodyEl = this.canvasEl; // alias: focus/interaction target
  this.statusEl = mk("div");
  this.statusEl.className = "g2-status";
  root.appendChild(this.statusEl);
  this.buildToolbar();
  this.createGraph();
  this.xGrid = new PZ.ui.graph.grid(this);
  this.yGrid = new PZ.ui.graph.grid(this, { dimension: 1 });
  // range shade behind curves (after grids, before curves)
  this.rangeRect = mkNS("rect");
  this.rangeRect.setAttributeNS(null, "fill", "rgb(var(--zui-accent-rgb) / .08)");
  this.rangeRect.setAttributeNS(null, "stroke", "var(--zui-border-soft)");
  this.rangeRect.setAttributeNS(null, "stroke-width", "1px");
  this.rangeRect.setAttributeNS(null, "vector-effect", "non-scaling-stroke");
  this.rangeRect.style.pointerEvents = "none";
  this.svg.appendChild(this.rangeRect);
  // curve layer
  this.curveLayer = mkNS("g");
  this.svg.appendChild(this.curveLayer);
  this.createCursor();
  // overlay (selection rect) — separate layer, NOT inside cursor
  this.overlayLayer = mkNS("g");
  this.overlayLayer.style.pointerEvents = "none";
  this.svg.appendChild(this.overlayLayer);
  this.selectRect = mkNS("rect");
  this.selectRect.setAttributeNS(null, "fill", "rgb(var(--zui-accent-rgb) / .2)");
  this.selectRect.setAttributeNS(null, "stroke", "var(--zui-accent)");
  this.selectRect.setAttributeNS(null, "stroke-width", "1");
  this.selectRect.setAttributeNS(null, "stroke-dasharray", "4 3");
  this.selectRect.setAttributeNS(null, "vector-effect", "non-scaling-stroke");
  this.selectRect.style.display = "none";
  this.overlayLayer.appendChild(this.selectRect);
  // tooltip + empty-state overlay inside the canvas
  this.tipEl = mk("div");
  this.tipEl.className = "g2-tip";
  this.canvasEl.appendChild(this.tipEl);
  // empty-state overlay (design)
  this.emptyEl = mk("div");
  this.emptyEl.className = "g2-empty";
  const emptyCard = mk("div");
  emptyCard.className = "g2-empty-card";
  const emptyTitle = mk("h3");
  emptyTitle.textContent = "NO CURVES";
  emptyCard.appendChild(emptyTitle);
  const emptyMessage = sharedEmptyNote((function () {
    try { return self._doc(); } catch (_docError) { return null; }
  })(),
    "Select keyframed properties on the left. Press \\ to fit · F to frame · double-click to add a key.");
  if (emptyMessage) {
    emptyCard.appendChild(emptyMessage);
  } else {
    const emptyFallback = mk("p");
    emptyFallback.textContent = "Select keyframed properties on the left. Press \\ to fit · F to frame · double-click to add a key.";
    emptyCard.appendChild(emptyFallback);
  }
  this.emptyEl.appendChild(emptyCard);
  this.canvasEl.appendChild(this.emptyEl);

  this.canvasEl.addEventListener("wheel", function (e) { self.mouseWheel(e); }, { passive: false });
  this.rulerEl.addEventListener("wheel", function (e) { self.mouseWheel(e); }, { passive: false });
  this.svg.addEventListener("pointerdown", function (e) {
    if (e.button !== 0 || self._spaceDown || self.tool === "pan") return;
    var hit = self.pickTarget(e);
    if (hit) { e.stopPropagation(); hit.element._g2down(e); }
  }, true);
  this.svg.addEventListener("pointerdown", function (e) { self.onSvgPointerDown(e); });
  // Windows middle-click autoscroll would hijack MMB pan — kill it
  this.svg.addEventListener("mousedown", function (e) { if (e.button === 1) e.preventDefault(); });
  this.svg.addEventListener("auxclick", function (e) { if (e.button === 1) e.preventDefault(); });
  this.rulerEl.addEventListener("mousedown", function (e) { if (e.button === 1) e.preventDefault(); });
  this.svg.addEventListener("pointermove", function (e) { self.onSvgPointerMove(e); });
  this.svg.addEventListener("dblclick", function (e) {
    var hit = self.pickTarget(e);
    if (hit?.handle) { e.stopPropagation(); hit.element._g2double(e); }
  }, true);
  this.svg.addEventListener("dblclick", function (e) { self.onSvgDoubleClick(e); });
  // ruler scrub (C4D): left-drag the numbers OR the red playhead bar
  this.rulerEl.addEventListener("pointerdown", function (e) {
    if (e.button !== 0 && e.button !== 2) return;
    e.preventDefault();
    self._dragging = "scrub";
    beginPointerDrag(self.rulerEl, e, function (ev) { self.scrubRuler(ev.clientX); }, function () { self._dragging = null; });
    self.scrubRuler(e.clientX);
  });
  this.bodyEl.addEventListener("contextmenu", function (e) { e.preventDefault(); });
  this.bodyEl.addEventListener("keydown", function (e) { self.keydown(e); });
  // Global Space pans the view without needing focus; bound per owner
  // window (rebound when the panel moves documents) so it works in popups.
  // Listener setup already no-ops on missing host APIs; only unexpected throws land here.
  try { self._ensureSpaceListeners(); } catch (eSpace) {}
  try { self._installResizeObserver(); } catch (eRO) {}
  this.applyToolCursor();
  this.updateStatus();
};

/* ---------- mouse ---------- */
PZ.ui.graph.prototype.mouseWheel = function (e) {
  var r = this.svg.getBoundingClientRect();
  this._wheelGesture = classifyWheel(e, this._wheelGesture, Date.now());
  var sx = (this.width || r.width) / Math.max(r.width, 1);
  var sy = (this.height || r.height) / Math.max(r.height, 1);
  var input = { deltaX: e.deltaX * sx, deltaY: e.deltaY, deltaMode: e.deltaMode,
    ctrlKey: e.ctrlKey, altKey: e.altKey, shiftKey: e.shiftKey };
  if (this._wheelGesture.kind === "pan" && !e.altKey) input.deltaY *= sy;
  var next = wheelView({ centerX: this.centerX, centerY: this.centerY,
    zoomX: this.zoomX, zoomY: this.zoomY, width: this.width || r.width, height: this.height || r.height },
    input, this._wheelGesture, { x: (e.clientX - r.left) * sx, y: (e.clientY - r.top) * sy }, e.currentTarget === this.rulerEl);
  Object.assign(this, { centerX: next.centerX, centerY: next.centerY, zoomX: next.zoomX, zoomY: next.zoomY });
  this.updateViewBox();
  this.updateStatus();
  e.preventDefault();
};
PZ.ui.graph.prototype.onSvgPointerDown = function (e) {
  var self = this;
  // BUGFIX tools disappeared: plain focus() scrolls the panel and pushes the
  // toolbar out of view — focus without scrolling, and swallow the default.
  try { if (e.button === 0 || e.button === 1) e.preventDefault(); } catch (err) { /* Synthetic host events may lack preventDefault. */ }
  focusNoScroll(this.bodyEl);
  if (e.button === 2) {
    // RMB: scrub playhead
    e.preventDefault();
    var scrub = function (ev) {
      var rect = self.svg.getBoundingClientRect();
      var g = self.screenToGraph(ev.clientX - rect.left, ev.clientY - rect.top);
      var f = Math.round(g.x);
      try {
        self.editor.playback.speed = 0;
        self.editor.playback.currentFrame = clamp(f, 0, totalFrames(self.editor) - 1);
      } catch (err) { gpWarnOnce("scrub", "playhead scrub failed", err); }
    };
    self._dragging = "scrub";
    beginPointerDrag(self.svg, e, scrub, function () { self._dragging = null; });
    scrub(e);
    return;
  }
  if (e.button !== 0 && e.button !== 1) return;
  if (e.button === 0 && !this._spaceDown && this.tool !== "pan" && e.target && e.target.classList && e.target.classList.contains("g2-kf")) return; // handled by key handlers
  if (e.button === 0 && !this._spaceDown && this.tool !== "pan" && e.target && e.target.classList && e.target.classList.contains("g2-hdl")) return;
  var self2 = this;
  var rect = this.svg.getBoundingClientRect();
  var startPx = { x: e.clientX - rect.left, y: e.clientY - rect.top };
  var startG = this.screenToGraph(startPx.x, startPx.y);
  // 1) LMB on the red playhead line (within 7px) -> scrub
  var cfNow = currentFrame(this.editor);
  var pxDist = Math.abs((startG.x - cfNow) / Math.max(this.zoomX, 1e-9));
  if (e.button === 0 && !this._spaceDown && this.tool !== "pan" && (e.target === this.cursor || pxDist <= 7)) {
    e.preventDefault();
    try { this.canvasEl.style.cursor = "col-resize"; } catch (err) {}
    var scrubTo = function (ev) {
      var r2 = self2.svg.getBoundingClientRect();
      var gg = self2.screenToGraph(ev.clientX - r2.left, ev.clientY - r2.top);
      try {
        self2.editor.playback.speed = 0;
        self2.editor.playback.currentFrame = clamp(Math.round(gg.x), 0, Math.max(totalFrames(self2.editor) - 1, 0));
      } catch (err) { gpWarnOnce("scrub", "playhead scrub failed", err); }
      self2.updateStatus("playhead " + currentFrame(self2.editor));
    };
    this._dragging = "scrub";
    beginPointerDrag(this.svg, e, scrubTo, function () {
      self2._dragging = null;
      try { self2.applyToolCursor(); } catch (err) {}
    });
    scrubTo(e);
    return;
  }
  // Middle-drag and Space-drag pan. Select-tool left-drag selects keys.
  var wantMarquee = e.button === 0 && !this._spaceDown && (this.tool === "sel" || e.shiftKey);
  var isPan = !wantMarquee;
  this._dragging = isPan ? "pan" : "marquee";
  try {
    if (isPan) this.canvasEl.style.cursor = "grabbing";
  } catch (err) {}
  var cur = { x: startPx.x, y: startPx.y };
  var moved = false;
  var startCX = this.centerX, startCY = this.centerY;
  var mv = function (ev) {
    var r2 = self2.svg.getBoundingClientRect();
    cur = { x: ev.clientX - r2.left, y: ev.clientY - r2.top };
    if (Math.abs(cur.x - startPx.x) + Math.abs(cur.y - startPx.y) < 4 && !moved) return;
    moved = true;
    if (isPan) {
      self2.centerX = startCX - (cur.x - startPx.x) / Math.max(r2.width, 1) * self2.viewW();
      self2.centerY = startCY - (cur.y - startPx.y) / Math.max(r2.height, 1) * self2.viewH();
      self2.updateViewBox();
      return;
    }
    var a = self2.screenToGraph(Math.min(startPx.x, cur.x), Math.min(startPx.y, cur.y));
    var b = self2.screenToGraph(Math.max(startPx.x, cur.x), Math.max(startPx.y, cur.y));
    if (!isFinite(a.x) || !isFinite(a.y) || !isFinite(b.x) || !isFinite(b.y)) return;
    self2.selectRect.style.display = "";
    self2.selectRect.setAttributeNS(null, "x", a.x);
    self2.selectRect.setAttributeNS(null, "y", a.y);
    self2.selectRect.setAttributeNS(null, "width", Math.max(b.x - a.x, 1e-6));
    self2.selectRect.setAttributeNS(null, "height", Math.max(b.y - a.y, 1e-6));
    var multi = ev.shiftKey;
    var groups = self2.propGroups();
    for (var gi = 0; gi < groups.length; gi++) {
      var gel = groups[gi];
      if (gel.style.display === "none" || expressionOf(gel.pz_object)) continue;
      var off = gel.pz_frameOffset || 0;
      var keys = gel._keys.children;
      for (var k = 0; k < keys.length; k++) {
        var el = keys[k];
        var kf = el.pz_object;
        if (!kf || typeof kf.value !== "number" || !isFinite(kf.value) || !isFinite(kf.frame)) continue;
        var ax = kf.frame + off;
        var scale = gel.pz_valueScale || 1;
        var gy = -kf.value * scale;
        var inside = ax >= a.x && ax <= b.x && gy >= a.y && gy <= b.y;
        if (inside) self2.selectKeyframe(el);
        else if (!multi) self2.deselectKeyframe(el);
      }
    }
    self2.updateStatus();
  };
  beginPointerDrag(this.svg, e, mv, function (end) {
    self2._dragging = null;
    self2.selectRect.style.display = "none";
    // A click on empty graph space (no drag) clears the key selection, as in
    // After Effects. Shift keeps it; a cancelled or blurred gesture keeps it too.
    if (end && end.type === "pointerup" && !moved && !e.shiftKey && self2.selectedKeys().length) self2.deselectAllKeyframes();
    try { self2.applyToolCursor(); } catch (err) {}
    self2.updateStatus();
  });
};
PZ.ui.graph.prototype.pickTarget = function (e) {
  if (this._dragging) return;
  var targets = [];
  var bounds = this.svg.getBoundingClientRect();
  for (var group of this.propGroups()) {
    if (group.style.display === "none") continue;
    for (var key of group._keys.children) {
      for (var element of [key, ...Array.from(key.pz_handles?.children || []).slice(0, 2)]) {
        if (!element._g2down || element.style.display === "none" || (element !== key && key.pz_handles.style.display === "none")) continue;
        var kf = key.pz_object, scale = group.pz_valueScale || 1;
        var x = kf.frame + (group.pz_frameOffset || 0), y = -kf.value * scale;
        if (element !== key) { x += Number(element.getAttribute("cx")); y += Number(element.getAttribute("cy")); }
        targets.push({ element, handle: element !== key,
          x: bounds.left + (x - this.viewX()) / this.viewW() * bounds.width,
          y: bounds.top + (y - this.viewY()) / this.viewH() * bounds.height });
      }
    }
  }
  var owner = this._win();
  if (owner && !coarsePointers.has(owner)) coarsePointers.set(owner, !!owner.matchMedia?.("(pointer: coarse)").matches);
  var coarse = owner && coarsePointers.get(owner);
  return nearestTarget(targets, e.clientX, e.clientY, coarse ? 20 : 12);
};
PZ.ui.graph.prototype.onSvgPointerMove = function (e) {
  if (this._dragging) return;
  var rect = this.svg.getBoundingClientRect();
  var px = e.clientX - rect.left, py = e.clientY - rect.top;
  var g = this.screenToGraph(px, py);
  // hover affordance: red playhead line gets a resize cursor
  if (!this._dragging) {
    var cfh = currentFrame(this.editor);
    var nearPlayhead = Math.abs((g.x - cfh) / Math.max(this.zoomX, 1e-9)) <= 7;
    try {
      this.canvasEl.style.cursor = nearPlayhead ? "col-resize" : (this.tool === "sel" ? "crosshair" : "grab");
    } catch (err) {}
  }
  var html = "f " + Math.round(g.x) + " · y " + (Math.round(g.y * 10) / 10);
  // hover keyframe?
  var hit = this._dragging ? null : this.pickTarget(e);
  if (this._hoverTarget) this._hoverTarget.classList.remove("g2-hover");
  this._hoverTarget = hit?.element;
  if (hit) { hit.element.classList.add("g2-hover"); this.canvasEl.style.cursor = "move"; }
  var t = hit?.element || e.target;
  if (!hit && !this._dragging) for (var group of this.propGroups()) {
    if (group.style.display === "none") continue;
    var value;
    try { value = evaluatedValue(group.pz_object, g.x - (group.pz_frameOffset || 0)); } catch (_error) { continue; }
    if (Math.abs((-value * (group.pz_valueScale || 1) - g.y) / this.viewH() * rect.height) < 8) {
      html = escapeHtml(displayName(group.pz_object)) + " · curve · frame " + Math.round(g.x) + " · value " + Math.round(value * 100) / 100; break;
    }
  }
  if (hit?.handle) html = "Handle · frame " + t.parentElement.pz_object.frame + " · Alt: break/link · Shift: angle · Ctrl/Cmd: snap";
  if (t && t.classList && t.classList.contains("g2-kf") && t.pz_object) {
    var kf = t.pz_object;
    var gel = t.parentElement.parentElement;
    var off = (gel && gel.pz_frameOffset) || 0;
    var scale = (gel && gel.pz_valueScale) || 1;
    var nm = gel && gel.pz_object ? displayName(gel.pz_object) : "";
    html = escapeHtml(nm) + "<br>f " + (kf.frame + off) + " (rel " + kf.frame + ")<br>v " + kf.value +
      "<br>ease " + (kf.tween & 255) + (kf.tween >> 8 ? " · bez" : " · lin") +
      (kf.continuousTangent ? "" : " · broken");
    var r2 = t.getBoundingClientRect();
    this.tipEl.style.left = (r2.left - rect.left + 14) + "px";
    this.tipEl.style.top = (r2.top - rect.top - 10) + "px";
  } else {
    this.tipEl.style.left = (px + 14) + "px";
    this.tipEl.style.top = (py + 12) + "px";
  }
  this.tipEl.innerHTML = html;
  this.tipEl.style.display = "";
  clearTimeout(this._tipTO);
  var self = this;
  this._tipTO = setTimeout(function () { self.tipEl.style.display = "none"; }, 900);
  // status live
  if (!this._statusTick || Date.now() - this._statusTick > 120) {
    this._statusTick = Date.now();
    this._hoverInfo = html.replace(/<br>/g, " | ");
    this.updateStatus(this._hoverInfo);
  }
  void scale;
};
PZ.ui.graph.prototype.onSvgDoubleClick = function (e) {
  if (e.button !== 0) return;
  if (e.target && e.target.classList && (e.target.classList.contains("g2-kf") || e.target.classList.contains("g2-hdl"))) return;
  var rect = this.svg.getBoundingClientRect();
  var g = this.screenToGraph(e.clientX - rect.left, e.clientY - rect.top);
  var absF = Math.round(g.x);
  // find nearest curve within threshold, else use all visible groups
  var groups = this.propGroups().filter((gel) => {
    if (gel.style.display === "none" || expressionOf(gel.pz_object) || (this._selectedAxes?.size && !this._selectedAxes.has(gel.pz_object))) return false;
    return gel.pz_object;
  });
  if (!groups.length) return;
  var self = this;
  var best = null, bestD = Infinity;
  var pxPerUnitY = Math.max(this.zoomY, 1e-6);
  groups.forEach(function (gel) {
    var prop = gel.pz_object;
    var scale = gel.pz_valueScale || 1;
    var off = gel.pz_frameOffset || 0;
    var rel = absF - off;
    var v;
    try { v = prop.get(rel); } catch (err) { v = 0; }
    if (typeof v !== "number") return;
    var gy = -v * scale;
    var d = Math.abs(gy - g.y) / pxPerUnitY;
    if (d < bestD) { bestD = d; best = gel; }
  });
  var targets = (best && bestD < 24) ? [best] : groups;
  // if selection exists, prefer curves that have selected keys
  var selGroups = {};
  this.selectedKeys().forEach(function (el) {
    var gel = el.parentElement.parentElement;
    if (gel) selGroups[gel._gid] = gel;
  });
  var selList = Object.keys(selGroups).map(function (k) { return selGroups[k]; });
  if (selList.length) targets = selList;
  this.editor.history.startOperation();
  var added = 0;
  for (var i = 0; i < targets.length; i++) {
    var gel = targets[i];
    var prop = gel.pz_object;
    var off = gel.pz_frameOffset || 0;
    var rel = this.snapFrame(absF, null) - off;
    var wasStatic = !prop.animated;
    if (!wasStatic && prop.hasKeyframe && prop.hasKeyframe(rel)) continue;
    var scale = gel.pz_valueScale || 1;
    var val = -g.y / scale;
    // clamp to definition min/max if present
    try {
      if (prop.definition && prop.definition.min !== undefined) val = Math.max(val, prop.definition.min);
      if (prop.definition && prop.definition.max !== undefined) val = Math.min(val, prop.definition.max);
    } catch (err) { /* A property without limits keeps its clicked value. */ }
    var tween = 1;
    try {
      if (!prop.interpolated) tween = 0;
      else {
        var idx = prop.getClosestKeyframeIndex(rel);
        var nk = prop.keyframes[idx];
        if (nk) tween = nk.tween;
      }
    } catch (err) {}
    var data;
    try { data = new PZ.keyframe(val, rel, tween); }
    catch (err) { data = { value: val, frame: rel, tween: tween }; }
    if (wasStatic) {
      this.ensureAnimated(prop, rel);
      // The stopwatch moved the static keyframe here; give it the clicked value.
      if (prop.hasKeyframe(rel)) {
        try { this.propertyOps.setValue({ property: prop.getAddress(), frame: rel, value: val }); added++; }
        catch (err) { gpWarnOnce("dblclick-set:" + i, "setting the clicked keyframe value failed", err); }
        continue;
      }
    }
    try { this.propertyOps.createKeyframe({ property: prop.getAddress(), data: data }); added++; }
    catch (err) { gpWarnOnce("dblclick-create:" + i, "creating the clicked keyframe failed", err); }
  }
  this.editor.history.finishOperation();
  if (!added) this.updateStatus("keyframe already exists at f " + absF);
};
};
