"use strict";
const { expressionOf, evaluatedValue } = require("./property-state.js");
const { pasteKey } = require("./axes.js");

// Warn-once reporter for failure sites that run per frame or per item:
// the first failure is logged, repeats stay silent so the console stays readable.
var gpWarned = {};
function gpWarnOnce(key, message, error) {
  if (gpWarned[key]) return;
  gpWarned[key] = true;
  console.warn("[Zoidium] graph-plus: " + message, error);
}

module.exports = function (environment) {
const { PZ, clamp, escapeHtml, displayName, addrString, currentFrame, totalFrames, g2doc, gpInjectStyle } = environment;
/* ---------- ops ---------- */
PZ.ui.graph.prototype.update = function () {
  this.animFrameReq = requestAnimationFrame(this._updateFn);
  try {
    var ownerDoc = this.el && this.el.ownerDocument;
    if (ownerDoc && ownerDoc !== this._styledDoc) {
      gpInjectStyle(ownerDoc);
      this._styledDoc = ownerDoc;
    }
    // The panel may have been adopted into another document (Ctrl+G popup)
    // after construction: rebind the per-window listeners, re-observe the
    // canvas in the new document, and re-measure once stylesheets land.
    if (ownerDoc && ownerDoc !== this._adoptedDoc) {
      this._adoptedDoc = ownerDoc;
      try {
        if (this._ensureSpaceListeners) this._ensureSpaceListeners();
      } catch (_spaceError) {}
      try {
        if (this._installResizeObserver) this._installResizeObserver();
      } catch (_roError) {}
      try {
        if (this.resize) this.resize();
      } catch (_resizeError) {}
    }
  } catch (_ownerStyleError) {}
  try {
    var cf = currentFrame(this.editor);
    if (this.cursor) {
      this.cursor.setAttributeNS(null, "x1", cf);
      this.cursor.setAttributeNS(null, "x2", cf);
    }
    if (cf !== this._lastRulerFrame) {
      this._lastRulerFrame = cf;
      try { this.drawRuler(); } catch (e2) { gpWarnOnce("ruler", "ruler redraw failed", e2); }
    }
    if (this.propGroups().some(g => g._samples && !g._samples.complete)) this.updateViewBox();
    if ((this._legendTick = (this._legendTick + 1) % 20) === 0) this.updateLegendValues();
  } catch (e) { /* Per-frame DOM refresh is best-effort; the next frame retries. */ }
};
PZ.ui.graph.prototype.resize = function () {
  if (!this.canvasEl) return;
  try {
    if (this._ensureSpaceListeners) this._ensureSpaceListeners();
  } catch (_spaceError) {}
  try {
    if (this._installResizeObserver) this._installResizeObserver();
  } catch (_roError) {}
  this.width = Math.max(this.canvasEl.clientWidth, 1);
  this.height = Math.max(this.canvasEl.clientHeight, 1);
  // Narrow hosts (the 600px Ctrl+G popup) get compact toolbar tiles so
  // more actions stay visible; toggling is idempotent so the resize
  // observer cannot loop on it.
  try {
    if (this.rootEl && this.rootEl.classList) {
      var wrapW = this.rootEl.clientWidth || 0;
      this.rootEl.classList.toggle("g2-narrow", wrapW > 0 && wrapW < 700);
    }
  } catch (_narrowError) {}
  if (this.xGrid) this.xGrid.resize();
  if (this.yGrid) this.yGrid.resize();
  this.updateViewBox();
  // BUGFIX: keep panels pinned — clear any programmatic scroll (focus can
  // scroll overflow:hidden ancestors, which used to push the toolbar away)
  try {
    if (this.rootEl) { this.rootEl.scrollTop = 0; this.rootEl.scrollLeft = 0; }
    if (this.toolbarEl) { this.toolbarEl.scrollTop = 0; }
    if (this.canvasEl) { this.canvasEl.scrollTop = 0; this.canvasEl.scrollLeft = 0; }
  } catch (e) {}
  // BUGFIX: don't lock init view while panel still has zero size (hidden tab)
  if ((!this._didInitView || this._selectionFitPending) && this.width > 50 && this.height > 50) {
    this._selectionFitPending = false;
    this._didInitView = true;
    if (this.propGroups().length) this.fitAll(false);
    else {
      var tf = totalFrames(this.editor);
      this.centerX = tf / 2; this.centerY = 0;
      this.updateViewBox();
    }
  }
};
// A property without the stopwatch keeps its static value in keyframes that
// the timeline does not track. Turn the stopwatch on first, as CM3's property
// panel does, before adding keyframes; otherwise the timeline loses track of
// them and later deletes or undos fail inside CM3.
PZ.ui.graph.prototype.ensureAnimated = function (prop, frame) {
  if (prop.animated || typeof this.propertyOps.toggleAnimation !== "function") return;
  try { this.propertyOps.toggleAnimation(prop, frame, false, true); } catch (err) { gpWarnOnce("animate:" + addrString(prop), "enabling animation on the property failed", err); }
};
PZ.ui.graph.prototype.deleteKeyframes = function (els) {
  for (var t = 0; t < els.length; t++) {
    var gel = els[t].parentElement.parentElement;
    if (!gel || !gel.pz_object) continue;
    var prop = gel.pz_object;
    if (prop.keyframes.length === 1 && !prop.definition.allowEmpty) continue;
    var kf = els[t].pz_object;
    this.propertyOps.deleteKeyframe({ property: prop.getAddress(), frame: kf.frame });
  }
  this.updateLegend();
};
PZ.ui.graph.prototype.setContinuousTangentExact = function (prop, kf, continuous) {
  if (kf.continuousTangent === continuous) return;
  // Native undo can enable continuity and mirror the handles again. Preserve
  // their exact coordinates before the flag command, including roundoff.
  if (kf.controlPoints) this.editor.history.pushCommand(this.propertyOps.setControlPoints.bind(this.propertyOps),
    { property: prop.getAddress(), frame: kf.frame, controlPoints: kf.controlPoints.map(point => point.slice()) });
  this.propertyOps.setContinuousTangent({ property: prop.getAddress(), frame: kf.frame, continuous: continuous });
};
PZ.ui.graph.prototype.toggleContinuousTangents = function (els) {
  for (var t = 0; t < els.length; t++) {
    var gel = els[t].parentElement.parentElement;
    if (!gel || !gel.pz_object) continue;
    var prop = gel.pz_object;
    var kf = els[t].pz_object;
    PZ.ui.graph.prototype.setContinuousTangentExact.call(this, prop, kf, !kf.continuousTangent);
  }
};
PZ.ui.graph.prototype.toggleInterpolation = function (els) {
  for (var t = 0; t < els.length; t++) {
    var gel = els[t].parentElement.parentElement;
    if (!gel || !gel.pz_object) continue;
    var prop = gel.pz_object;
    var kf = els[t].pz_object;
    var n = kf.tween;
    n = (255 & n) | ((1 & ~(n >> 8)) << 8);
    this.propertyOps.setTween({ property: prop.getAddress(), frame: kf.frame, tween: n });
  }
};
PZ.ui.graph.prototype.resetHandles = function (els) {
  var flat = [[-10, 0], [10, 0]];
  for (var i = 0; i < els.length; i++) {
    var gel = els[i].parentElement.parentElement;
    if (!gel || !gel.pz_object) continue;
    var prop = gel.pz_object;
    var kf = els[i].pz_object;
    this.propertyOps.setControlPoints({ property: prop.getAddress(), frame: kf.frame, controlPoints: flat });
  }
};
PZ.ui.graph.prototype.applyEasingToSelected = function (easeIdx) {
  var sel = this.selectedKeys();
  if (!sel.length) { this.updateStatus("select keys first"); return; }
  this.editor.history.startOperation();
  for (var i = 0; i < sel.length; i++) {
    var gel = sel[i].parentElement.parentElement;
    var kf = sel[i].pz_object;
    // pure easing preset: clear bezier flag so the sampled ease curve shows
    var next = (easeIdx & 255);
    this.propertyOps.setTween({ property: gel.pz_object.getAddress(), frame: kf.frame, tween: next });
  }
  this.editor.history.finishOperation();
  var nm = "";
  try { nm = PZ.tween.easingList[easeIdx & 255].name; } catch (e) {}
  this.updateStatus("applied " + (nm || ("ease " + easeIdx)));
};
PZ.ui.graph.prototype.addKeyframeAtPlayhead = function () {
  var groups = this.editableGroups ? this.editableGroups() : this.propGroups().filter(function (g) { return g.style.display !== "none" && !expressionOf(g.pz_object); });
  if (!groups.length) return;
  var cf = currentFrame(this.editor);
  this.editor.history.startOperation();
  for (var i = 0; i < groups.length; i++) {
    var prop = groups[i].pz_object;
    var off = groups[i].pz_frameOffset || 0;
    var rel = cf - off;
    var val;
    try { val = prop.get(rel); } catch (e) { val = 0; }
    if (typeof val !== "number") continue;
    this.ensureAnimated(prop, rel);
    if (prop.hasKeyframe && prop.hasKeyframe(rel)) continue;
    var tween = prop.interpolated ? 1 : 0;
    var data;
    try { data = new PZ.keyframe(val, rel, tween); }
    catch (e) { data = { value: val, frame: rel, tween: tween }; }
    try { this.propertyOps.createKeyframe({ property: prop.getAddress(), data: data }); } catch (e) { gpWarnOnce("addKeyframe:" + i, "creating a keyframe at the playhead failed", e); }
  }
  this.editor.history.finishOperation();
};
PZ.ui.graph.prototype.copySelected = function () {
  var map = {};
  var groups = this.propGroups();
  for (var gi = 0; gi < groups.length; gi++) {
    var gel = groups[gi];
    if (expressionOf(gel.pz_object) || gel.style.display === "none" || (this._selectedAxes?.size && !this._selectedAxes.has(gel.pz_object))) continue;
    var sel = Array.prototype.slice.call(gel._keys.getElementsByClassName("selected"));
    if (sel.length) map[gel.pz_object.definition.name] = sel.map(function (e) { return e.pz_object; });
  }
  // The popup editor lives in a separate window: clipboard access goes
  // through its own navigator (permissions follow the focused document).
  var nav = null;
  try { nav = (this._win && this._win().navigator) || null; } catch (eNav) {}
  try {
    if (!nav && typeof navigator !== "undefined") nav = navigator;
  } catch (eNav2) {}
  try {
    var pack = new PZ.package(map, "propertyList");
    var str = JSON.stringify([pack]);
    if (nav && nav.clipboard && nav.clipboard.writeText) nav.clipboard.writeText(str).catch(function () { /* The session clipboard remains available. */ });
    this._clipCache = str;
    this.updateStatus("copied " + Object.keys(map).length + " curve(s)");
  } catch (e) { console.warn("[Zoidium] graph-plus: copying keyframes failed", e); this.updateStatus("copy failed"); }
};
PZ.ui.graph.prototype.pasteAtPlayhead = function () {
  var self = this;
  var doPaste = function (str) {
    var arr = [];
    try { arr = JSON.parse(str); } catch (e) { /* Non-graph clipboard text is not pastable; ignore it. */ return; }
    for (var e = 0; e < arr.length; e++) {
      if (arr[e].baseType !== "propertyList") return;
      arr[e].minFrame = Infinity;
      var keys = Object.keys(arr[e].data);
      for (var s = 0; s < keys.length; s++) {
        var n = arr[e].data[keys[s]];
        if (!n.length) continue;
        arr[e].minFrame = Math.min(arr[e].minFrame, n[0].frame);
      }
    }
    var cf = currentFrame(self.editor);
    self.editor.history.startOperation();
    var groups = self.editableGroups ? self.editableGroups() : self.propGroups();
    for (var gi = 0; gi < groups.length; gi++) {
      var prop = groups[gi].pz_object;
      if (expressionOf(prop) || groups[gi].style.display === "none") continue;
      var off = groups[gi].pz_frameOffset || 0;
      for (var ai = 0; ai < arr.length; ai++) {
        var data = arr[ai].data;
        var shift = cf - arr[ai].minFrame - off;
        var axis = self.axisInfo?.(prop)?.axis;
        var sourceKey = pasteKey(data, prop.definition.name, axis, groups.length === 1);
        var list = data[sourceKey];
        if (list) {
          if (list.length) self.ensureAnimated(prop, list[0].frame + shift);
          try { self.propertyOps.pasteKeyframes(prop, JSON.parse(JSON.stringify(list)), shift); } catch (err) { gpWarnOnce("paste:" + gi + ":" + ai, "pasting keyframes failed", err); }
          delete data[sourceKey];
        }
      }
    }
    self.editor.history.finishOperation();
    self.updateStatus("pasted at f " + cf);
  };
  var nav = null;
  try { nav = (self._win && self._win().navigator) || null; } catch (eNav) {}
  try {
    if (!nav && typeof navigator !== "undefined") nav = navigator;
  } catch (eNav2) {}
  if (nav && nav.clipboard && nav.clipboard.readText) {
    nav.clipboard.readText().then(doPaste, function () { if (self._clipCache) doPaste(self._clipCache); });
  } else if (this._clipCache) doPaste(this._clipCache);
};

/* ---------- legend + status ---------- */
/* C4D-style docked track list (left column) — replaces floating legend */
PZ.ui.graph.prototype.updateLegend = function () {
  if (!this.tracksEl) return;
  var self = this;
  function mk(tag) {
    try {
      var d = self._doc();
      if (d && d.createElement) return d.createElement(tag);
    } catch (e) {}
    return document.createElement(tag);
  }
  while (this.tracksEl.firstChild) this.tracksEl.firstChild.remove();
  var groups = this.propGroups();
  if (this.emptyEl) this.emptyEl.style.display = groups.length ? "none" : "";
  var head = mk("div");
  head.className = "g2-tracks-head";
  head.textContent = groups.length ? "TRACKS · " + groups.length : "TRACKS · none";
  this.tracksEl.appendChild(head);
  if (!groups.length) {
    var h = mk("div");
    h.style.cssText = "padding:6px 8px;color:var(--zui-text);opacity:.6;font-size:var(--zui-font-size-compact);line-height:1.5";
    h.textContent = "select keyframed properties on the left";
    this.tracksEl.appendChild(h);
    return;
  }
  var parents = new Set();
  groups.forEach(function (gel) {
    var info = self.axisInfo(gel.pz_object);
    if (info && !parents.has(info.parent)) {
      parents.add(info.parent);
      var parentRow = mk("div"); parentRow.className = "g2-track-row g2-track-parent";
      parentRow.textContent = displayName(info.parent);
      parentRow.addEventListener("click", function (ev) {
        self.selectAxes(groups.filter(g => self.axisInfo(g.pz_object)?.parent === info.parent), ev.ctrlKey || ev.metaKey || ev.shiftKey);
      });
      self.tracksEl.appendChild(parentRow);
    }
    var prop = gel.pz_object;
    var row = mk("div");
    row.className = "g2-track-row";
    row._gel = gel;
    row.title = addrString(prop) + " — click to select all its keys";
    var dot = mk("span");
    dot.className = "g2-swatch";
    dot.style.background = gel.pz_color || "var(--zui-text-bright)";
    row.appendChild(dot);
    var nm = mk("span");
    nm.className = "g2-track-name";
    nm.textContent = (info ? "  " + info.axis : displayName(prop)) + (expressionOf(prop) ? " · Expression" : "");
    row.appendChild(nm);
    var val = mk("span");
    val.className = "g2-track-val";
    val.textContent = "";
    val._prop = prop; val._gel = gel;
    row.appendChild(val);
    var eye = mk("button");
    eye.className = "g2-eye" + (gel.style.display === "none" ? " off" : "");
    eye.textContent = gel.style.display === "none" ? "◌" : "◉";
    eye.title = "show/hide curve";
    eye.addEventListener("mousedown", function (ev) { ev.preventDefault(); ev.stopPropagation(); });
    eye.addEventListener("click", function (ev) {
      ev.stopPropagation();
      gel.style.display = gel.style.display === "none" ? "" : "none";
      self._hidden[addrString(prop)] = gel.style.display === "none";
      if (gel.style.display === "none") for (var key of Array.from(gel._keys.children)) self.deselectKeyframe(key);
      self.updateViewBox(); self.updateLegend();
    });
    row.appendChild(eye);
    var solo = mk("button"); solo.className = "g2-eye"; solo.textContent = "S"; solo.title = "Solo axis";
    solo.addEventListener("click", function (ev) { ev.stopPropagation(); self.selectAxes([gel], false); });
    row.appendChild(solo);
    row.addEventListener("click", function (ev) {
      self.selectAxes([gel], ev.ctrlKey || ev.metaKey || ev.shiftKey);
    });
    self.tracksEl.appendChild(row);
  });
  this.updateLegendValues();
};
PZ.ui.graph.prototype.updateLegendValues = function () {
  if (!this.tracksEl) return;
  var cf = currentFrame(this.editor);
  var rows = this.tracksEl.querySelectorAll(".g2-track-val");
  for (var i = 0; i < rows.length; i++) {
    var prop = rows[i]._prop, gel = rows[i]._gel;
    try {
      var off = (gel && gel.pz_frameOffset) || 0;
      var v = evaluatedValue(prop, cf - off);
      rows[i].textContent = typeof v === "number" ? (Math.round(v * 100) / 100).toString() : "";
    } catch (e) { /* An unreadable property value leaves its cell blank. */ rows[i].textContent = ""; }
  }
};
PZ.ui.graph.prototype.updateStatus = function (extra) {
  if (!this.statusEl) return;
  var cf = currentFrame(this.editor);
  var sel = this.selectedKeys().length;
  if (this.toolbarEl?.querySelectorAll) for (var button of this.toolbarEl.querySelectorAll('[data-needs-keys="true"]')) button.disabled = !sel;
  var n = this.propGroups().length;
  this.statusEl.innerHTML = "";
  var self = this;
  var statusDoc = null;
  try { statusDoc = this._doc(); } catch (eDoc) {}
  if (!statusDoc || typeof statusDoc.createElement !== "function") statusDoc = g2doc(this.statusEl);
  function pill(html, live) {
    var s = (statusDoc && statusDoc.createElement ? statusDoc : document).createElement("span");
    s.className = "g2-pill" + (live ? " live" : "");
    s.innerHTML = html;
    self.statusEl.appendChild(s);
  }
  pill("frame <b>" + cf + "</b>");
  pill("curves <b>" + n + "</b>");
  pill("sel <b>" + sel + "</b>", sel > 0);
  pill("zoom <b>" + (Math.round(this.zoomX * 100) / 100) + " / " + (Math.round(this.zoomY * 1000) / 1000) + "</b>");
  pill((this.options.snap ? "snap ON" : "snap OFF") + " · " + (this.options.normalize ? "norm ON" : "norm OFF"), this.options.snap);
  if (extra) pill(escapeHtml(extra));
  else pill("LMB:select · Space/MMB:pan · click:deselect · RMB:scrub · dblclick:add · F:frame · \\:fit");
  // sync track-row highlight with selection
  try {
    if (this.tracksEl) {
      var rows = this.tracksEl.querySelectorAll(".g2-track-row");
      for (var i = 0; i < rows.length; i++) {
        var gel = rows[i]._gel;
        var any = false;
        if (gel && gel._keys) {
          var keys = gel._keys.children;
          for (var k = 0; k < keys.length; k++) if (keys[k].classList.contains("selected")) { any = true; break; }
        }
        rows[i].classList.toggle("selected", any);
      }
    }
  } catch (e) { /* Row highlight is cosmetic; the selection still applies. */ }
};

/* ---------- keyboard ---------- */
PZ.ui.graph.prototype.keydown = function (e) {
  var self = this;
  if (e.key === "=" || e.key === "+") {
    e.stopPropagation();
    var t = 0.9;
    if (!e.ctrlKey) this.zoomX = clamp(this.zoomX * t, 0.05, 500);
    if (!e.shiftKey) this.zoomY = clamp(this.zoomY * t, 0.001, 10000);
    this.updateViewBox(); this.updateStatus();
  } else if (e.key === "-" || e.key === "_") {
    e.stopPropagation();
    var t2 = 1.1111;
    if (!e.ctrlKey) this.zoomX = clamp(this.zoomX * t2, 0.05, 500);
    if (!e.shiftKey) this.zoomY = clamp(this.zoomY * t2, 0.001, 10000);
    this.updateViewBox(); this.updateStatus();
  } else if (e.key === "\\") {
    e.stopPropagation(); this.fitAll(false);
  } else if (e.key === "f" || e.key === "F") {
    if (e.ctrlKey || e.metaKey) return;
    e.stopPropagation(); this.frameSelected();
  } else if (e.key === "n" || e.key === "N") {
    if (e.ctrlKey || e.metaKey) return;
    e.stopPropagation();
    this.options.normalize = !this.options.normalize;
    if (this.normBtn) this.normBtn.classList.toggle("on", this.options.normalize);
    this.refreshAllScales(); this.updateViewBox(); this.updateLegend(); this.updateStatus();
  } else if (e.key === "s" || e.key === "S") {
    if (e.ctrlKey || e.metaKey) return;
    e.stopPropagation();
    this.options.snap = !this.options.snap;
    if (this.snapBtn) this.snapBtn.classList.toggle("on", this.options.snap);
    this.updateStatus();
  } else if (e.key === "k" || e.key === "K") {
    if (e.ctrlKey || e.metaKey) return;
    e.stopPropagation(); this.addKeyframeAtPlayhead();
  } else if (e.key === "Delete" || e.key === "Del" || e.key === "Backspace") {
    e.stopPropagation();
    var sel = this.selectedKeys();
    this.editor.history.startOperation();
    this.deleteKeyframes(sel);
    this.editor.history.finishOperation();
  } else if (e.key === "t" || e.key === "T") {
    e.stopPropagation();
    var s2 = this.selectedKeys();
    this.editor.history.startOperation();
    this.toggleContinuousTangents(s2);
    this.editor.history.finishOperation();
  } else if (e.key === "i" || e.key === "I") {
    e.stopPropagation();
    var s3 = this.selectedKeys();
    this.editor.history.startOperation();
    this.toggleInterpolation(s3);
    this.editor.history.finishOperation();
  } else if (e.key === "r" || e.key === "R") {
    e.stopPropagation();
    var s4 = this.selectedKeys();
    this.editor.history.startOperation();
    this.resetHandles(s4);
    this.editor.history.finishOperation();
  } else if (e.key === "Escape") {
    e.stopPropagation();
    if (this.gestureCard) { this.gestureCard.remove(); this.gestureCard = null;
      this.toolbarEl?.querySelector('[aria-label="Gesture help"]')?.setAttribute("aria-expanded", "false"); return; }
    if (this.easePopup) { this.closeEasePopup(); return; }
    this.deselectAllKeyframes();
  } else if (e.key && e.key.indexOf("Arrow") === 0) {
    var valueKeys = this.selectedKeys();
    var sel5 = e.key === "ArrowLeft" || e.key === "ArrowRight" ? (this.timeKeys ? this.timeKeys(valueKeys) : valueKeys) : valueKeys;
    if (!sel5.length) return;
    e.stopPropagation(); e.preventDefault();
    var df = 0, dvPx = 0;
    if (e.key === "ArrowLeft") df = e.shiftKey ? -10 : -1;
    if (e.key === "ArrowRight") df = e.shiftKey ? 10 : 1;
    if (e.key === "ArrowUp") dvPx = e.shiftKey ? 10 : 1;
    if (e.key === "ArrowDown") dvPx = e.shiftKey ? -10 : -1;
    this.editor.history.startOperation();
    // snapshot old values for undo
    var snap = sel5.map(function (el) {
      var gel = el.parentElement.parentElement;
      return { el: el, gel: gel, kf: el.pz_object, oldF: el.pz_object.frame, oldV: el.pz_object.value, scale: (gel && gel.pz_valueScale) || 1 };
    });
    for (var i = 0; i < snap.length; i++) {
      var sn = snap[i];
      sn.el.pz_oldFrame = sn.oldF;
      if (df) sn.kf.frame = Math.round(sn.oldF + df);
      if (dvPx) sn.kf.value = sn.oldV + (dvPx * this.zoomY) / sn.scale;
      this.refreshAdjacentCurves(sn.el);
    }
    this.finishMovingKeyframes(sel5);
    for (var j = 0; j < snap.length; j++) {
      var s = snap[j];
      this.editor.history.pushCommand(
        PZ.ui.properties.prototype.setValue.bind(this),
        { property: s.gel.pz_object.getAddress(), value: s.oldV, frame: s.kf.frame }
      );
    }
    this.editor.history.finishOperation();
    this.updateStatus();
  } else if ((e.key === "c" || e.key === "x") && (e.ctrlKey || e.metaKey)) {
    e.stopPropagation();
    this.copySelected();
    if (e.key === "x") {
      var sx = this.selectedKeys();
      this.editor.history.startOperation();
      this.deleteKeyframes(sx);
      this.editor.history.finishOperation();
    }
  } else if (e.key === "v" && (e.ctrlKey || e.metaKey)) {
    e.stopPropagation();
    this.pasteAtPlayhead();
  } else if (e.key === "a" && (e.ctrlKey || e.metaKey)) {
    e.stopPropagation(); e.preventDefault();
    var groups = this.propGroups();
    for (var gi = 0; gi < groups.length; gi++) {
      var keys = groups[gi]._keys.children;
      for (var k = 0; k < keys.length; k++) this.selectKeyframe(keys[k]);
    }
    this.updateStatus();
  } else if (e.key === "h" || e.key === "H") {
    if (e.ctrlKey || e.metaKey) return;
    e.stopPropagation();
    this.setTool("pan");
  } else if (e.key === "v" || e.key === "V") {
    if (e.ctrlKey || e.metaKey) return;
    e.stopPropagation();
    this.setTool("sel");
  } else if (e.key === " ") {
    e.preventDefault();
    this._spaceDown = true;
  }
};
};
