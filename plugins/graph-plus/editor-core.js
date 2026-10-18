"use strict";

const { controllers } = require("./selection.js");

// Warn-once reporter for failure sites that run per frame or per pointer move:
// the first failure is logged, repeats stay silent so the console stays readable.
var gpWarned = {};
function gpWarnOnce(key, message, error) {
  if (gpWarned[key]) return;
  gpWarned[key] = true;
  console.warn("[Zoidium] graph-plus: " + message, error);
}

module.exports = function (environment) {
const { PZ, SVGNS, clamp, curveColor, displayName, scaleFactorOf, addrString, currentFrame, totalFrames, g2doc, g2win, gpSyncTheme } = environment;
var GraphGrid = function (graph, opts) {
  this.graph = graph;
  this.numGridLines = 0;
  this.numTexts = 0;
  this.options = { gridUnit: 20, lineWidth: 1, dimension: 0, textSize: 10 };
  if (opts) Object.assign(this.options, opts);
  this.create();
};
GraphGrid.prototype._doc = function () {
  try {
    if (this.graph && this.graph._doc) {
      var d = this.graph._doc();
      if (d) return d;
    }
  } catch (e) {}
  return g2doc(this.el) || g2doc(this.graph && this.graph.svg);
};
GraphGrid.prototype.create = function () {
  this.el = this._doc().createElementNS(SVGNS, "g");
  this.el.setAttributeNS(null, "stroke-width", this.options.lineWidth + "px");
  this.graph.svg.appendChild(this.el);
};
GraphGrid.prototype.createGridLine = function () {
  var e = this._doc().createElementNS(SVGNS, "line");
  e.setAttributeNS(null, "vector-effect", "non-scaling-stroke");
  return e;
};
GraphGrid.prototype.createText = function () {
  var e = this._doc().createElementNS(SVGNS, "text");
  e.setAttributeNS(null, "fill", "var(--zui-text)");
  e.setAttributeNS(null, "font-family", "var(--zui-font)");
  e.setAttributeNS(null, "font-size", "10");
  e.setAttributeNS(null, "letter-spacing", "0");
  e.style.pointerEvents = "none";
  return e;
};
GraphGrid.prototype.ensure = function (lines, texts) {
  var need = lines + texts;
  while (this.el.children.length < need) {
    if (this.el.querySelectorAll("line").length < lines) this.el.appendChild(this.createGridLine());
    else this.el.appendChild(this.createText());
  }
};
GraphGrid.prototype.update = function () {
  var g = this.graph;
  if (!g.width || !g.height) return;
  var dim = this.options.dimension;
  var zoom = dim === 0 ? g.zoomX : g.zoomY;
  if (!(zoom > 0)) return;
  var step = this.options.gridUnit * Math.pow(2, Math.ceil(Math.log2(zoom)));
  var sizePx = dim === 0 ? g.width : g.height;
  var center = dim === 0 ? g.centerX : g.centerY;
  var viewSize = sizePx * zoom;
  var start = Math.floor((center - 0.5 * viewSize) / step);
  var end = Math.ceil((center + 0.5 * viewSize) / step);
  var count = end - start + 1;
  if (count < 1 || count > 500) count = Math.min(Math.max(count, 1), 500);
  var majors = Math.ceil(count / 2) + 1;
  this.ensure(count, majors);
  var lines = this.el.querySelectorAll("line");
  var texts = this.el.querySelectorAll("text");
  var ti = 0;
  var halfH = 0.5 * g.height * g.zoomY;
  var halfW = 0.5 * g.width * g.zoomX;
  for (var s = 0; s < count; s++) {
    var idx = start + s;
    var a = idx * step;
    var line = lines[s];
    if (!line) break;
    var isMajor = (idx % 2) === 0;
    var isZero = idx === 0;
    var col = isZero ? "var(--zui-text-faint)" : isMajor ? "var(--zui-hover)" : "var(--zui-bg)";
    line.setAttributeNS(null, "stroke", col);
    if (dim === 0) {
      line.setAttributeNS(null, "x1", a);
      line.setAttributeNS(null, "x2", a);
      line.setAttributeNS(null, "y1", g.centerY - halfH);
      line.setAttributeNS(null, "y2", g.centerY + halfH);
      // C4D-style: frame numbers live in the top ruler — no in-grid x labels
      if (isMajor && ti < texts.length) {
        var tx = texts[ti++];
        tx.textContent = "";
      }
    } else {
      line.setAttributeNS(null, "y1", a);
      line.setAttributeNS(null, "y2", a);
      line.setAttributeNS(null, "x1", g.centerX - halfW);
      line.setAttributeNS(null, "x2", g.centerX + halfW);
      if (isMajor && ti < texts.length) {
        var ty = texts[ti++];
        var xL = g.centerX - halfW;
        ty.setAttributeNS(null, "transform", "translate(" + xL + " " + a + ") scale(" + g.zoomX + " " + g.zoomY + ")");
        ty.setAttributeNS(null, "x", 5);
        ty.setAttributeNS(null, "y", -5);
        ty.setAttributeNS(null, "font-size", "10");
        ty.setAttributeNS(null, "fill", "var(--zui-text-bright)");
        var v = -a;
        ty.textContent = Math.abs(v) >= 100 ? Math.round(v).toString() : (Math.round(v * 10) / 10).toString();
      }
    }
  }
  // hide unused
  for (var q = count; q < lines.length; q++) lines[q].setAttributeNS(null, "stroke", "transparent");
  for (var w = ti; w < texts.length; w++) texts[w].textContent = "";
};
GraphGrid.prototype.resize = function () {
  var n = this.options.dimension === 0
    ? Math.ceil(this.graph.width / this.options.gridUnit) + 6
    : Math.ceil(this.graph.height / this.options.gridUnit) + 6;
  n = clamp(n, 8, 400);
  this.numGridLines = n;
  this.numTexts = Math.ceil(n / 2) + 1;
  while (this.el.firstChild) this.el.firstChild.remove();
  for (var e = 0; e < this.numGridLines; e++) this.el.appendChild(this.createGridLine());
  for (var t = 0; t < this.numTexts; t++) this.el.appendChild(this.createText());
};

/* ================= GRAPH (rebuilt) ================= */
PZ.ui.graph = function (editor, opts) {
  PZ.ui.panel.call(this, editor);
  this.title = "Graph";
  this.icon = "project";
  this.propertyOps = new PZ.ui.properties(this.editor);
  PZ.observable.defineObservableProp(this, "objects", "onObjectsChanged");
  this.objects = null;
  var self = this;
  this.objectAdded_bound = function (e) { self.objectAdded(e); };
  this.objectRemoved_bound = function (e) { self.objectRemoved(e); };
  // Listener (un)subscribe is best-effort: a torn-down host observable simply stays as-is.
  this.onObjectsChanged.watch(function (old) {
    if (old) {
      try { old.onObjectAdded.unwatch(self.objectAdded_bound); } catch (e) {}
      try { old.onObjectRemoved.unwatch(self.objectRemoved_bound); } catch (e) {}
    }
    if (self.objects) {
      try { self.objects.onObjectAdded.watch(self.objectAdded_bound); } catch (e) {}
      try { self.objects.onObjectRemoved.watch(self.objectRemoved_bound); } catch (e) {}
    }
    self.objectsChanged();
  });
  this.selection = new PZ.objectList();
  this.properties = new PZ.objectList(null, Object);
  this.options = {
    curveLineWidth: 2.5, keyframeSize: 11, handleSize: 9,
    cursorLineWidth: 1, shapeRendering: "auto",
    normalize: false, snap: true, showLabels: true
  };
  this.width = 1; this.height = 1;
  this.centerX = 0; this.centerY = 0;
  this.zoomX = 1; this.zoomY = 1;
  if (opts) Object.assign(this.options, opts);
  this._updateFn = this.update.bind(this);
  this.onEnabledChanged.watch(function () {
    if (self.enabled) self.animFrameReq = requestAnimationFrame(self._updateFn);
    else cancelAnimationFrame(self.animFrameReq);
  });
  this.selectNewKeyframes = false;
  this._didInitView = false;
  this._hidden = {};   // addr -> true
  this._legendTick = 0;
  this.tool = "pan";      // C4D-like tool modes: "pan" (default) | "sel" (marquee)
  this._spaceDown = false;
  this.create();
};
PZ.ui.graph.prototype = Object.create(PZ.ui.panel.prototype);
PZ.ui.graph.prototype.constructor = PZ.ui.graph;

/* ---------- helpers ---------- */
PZ.ui.graph.prototype._doc = function () {
  return g2doc(this.canvasEl) || g2doc(this.el) || g2doc(this.svg) || null;
};
PZ.ui.graph.prototype._win = function () {
  var doc = this._doc();
  try {
    if (doc && doc.defaultView) return doc.defaultView;
  } catch (e) {}
  return g2win(this.el);
};
/* Global Space pans the view without needing focus. The listener must live
   on the window that owns this panel: the Ctrl+G popup is a separate
   window whose key events never reach the main window. Rebind whenever the
   panel is adopted into another document. */
PZ.ui.graph.prototype._ensureSpaceListeners = function () {
  var self = this;
  var w = null;
  try {
    w = this._win();
  } catch (e) {
    return;
  }
  if (!w || typeof w.addEventListener !== "function") return;
  if (this._spaceWin === w) return;
  try {
    if (this._spaceWin && this._spaceHandlers) {
      this._spaceWin.removeEventListener("keydown", this._spaceHandlers.down);
      this._spaceWin.removeEventListener("keyup", this._spaceHandlers.up);
      this._spaceWin.removeEventListener("blur", this._spaceHandlers.blur);
    }
  } catch (e2) { /* Detaching from a closed window needs no cleanup. */ }
  var handlers = {
    down: function (e) {
      if (e.code === "Space" && !e.repeat) self._spaceDown = true;
    },
    up: function (e) {
      if (e.code === "Space") self._spaceDown = false;
    },
    blur: function () { self._spaceDown = false; },
  };
  try {
    w.addEventListener("keydown", handlers.down);
    w.addEventListener("keyup", handlers.up);
    w.addEventListener("blur", handlers.blur);
  } catch (e3) {
    return;
  }
  this._spaceWin = w;
  this._spaceHandlers = handlers;
};
/* Re-run resize() whenever the canvas box changes. The popup panel is first
   constructed while its stylesheets are still loading, so the initial
   resize() can measure a pre-layout box; the observer corrects that as soon
   as the real layout lands. resize() never changes layout itself, so this
   cannot loop. */
PZ.ui.graph.prototype._installResizeObserver = function () {
  var self = this;
  var doc = null;
  try {
    doc = this._doc();
    if (!this.canvasEl || !doc) return;
    if (this._ro && this._roDoc === doc) return;
    if (this._ro) {
      try { this._ro.disconnect(); } catch (e) { /* Disconnecting a dead observer needs no cleanup. */ }
      this._ro = null;
      this._roDoc = null;
    }
    var w = this._win();
    var RO = (w && w.ResizeObserver) || null;
    if (!RO) {
      try {
        RO = typeof ResizeObserver !== "undefined" ? ResizeObserver : null;
      } catch (e2) {
        RO = null;
      }
    }
    if (!RO) return;
    var ro = new RO(function () {
      try {
        self.resize();
      } catch (e3) { gpWarnOnce("resize", "resize after layout failed", e3); }
    });
    ro.observe(this.canvasEl);
    this._ro = ro;
    this._roDoc = doc;
  } catch (e4) { /* Optional per-window rebinding; the previous bindings stay. */ }
};
PZ.ui.graph.prototype.unload = function () {
  controllers.get(this.editor)?.panels.delete(this._selectionPanel);
  this._selectionPanel = null;
  this.closeEasePopup();
  try { clearTimeout(this._tipTO); } catch (_timerError) {}
  this._tipTO = null;
  this.objects = null;
  try {
    if (this._ro) this._ro.disconnect();
  } catch (e) { /* Disconnecting a dead observer needs no cleanup. */ }
  this._ro = null;
  this._roDoc = null;
  try {
    if (this._spaceWin && this._spaceHandlers) {
      this._spaceWin.removeEventListener("keydown", this._spaceHandlers.down);
      this._spaceWin.removeEventListener("keyup", this._spaceHandlers.up);
      this._spaceWin.removeEventListener("blur", this._spaceHandlers.blur);
    }
  } catch (e2) { /* Detaching from a closed window needs no cleanup. */ }
  this._spaceWin = null;
  this._spaceHandlers = null;
};
PZ.ui.graph.prototype.viewX = function () { return this.centerX - 0.5 * this.width * this.zoomX; };
PZ.ui.graph.prototype.viewY = function () { return this.centerY - 0.5 * this.height * this.zoomY; };
PZ.ui.graph.prototype.viewW = function () { return this.width * this.zoomX; };
PZ.ui.graph.prototype.viewH = function () { return this.height * this.zoomY; };
PZ.ui.graph.prototype.scrubRuler = function (clientX) {
  if (!this.rulerEl) return;
  var r = this.rulerEl.getBoundingClientRect();
  if (r.width < 1) return;
  var f = this.viewX() + ((clientX - r.left) / r.width) * this.viewW();
  try {
    this.editor.playback.speed = 0;
    this.editor.playback.currentFrame = clamp(Math.round(f), 0, Math.max(totalFrames(this.editor) - 1, 0));
  } catch (e) { gpWarnOnce("scrub", "playhead scrub failed", e); }
  try { this.drawRuler(); } catch (e2) { gpWarnOnce("ruler", "ruler redraw failed", e2); }
};
PZ.ui.graph.prototype.screenToGraph = function (px, py) {
  var r = this.svg.getBoundingClientRect();
  if (r.width < 1 || r.height < 1) return { x: this.centerX, y: this.centerY };
  return {
    x: this.viewX() + (px / r.width) * this.viewW(),
    y: this.viewY() + (py / r.height) * this.viewH()
  };
};
PZ.ui.graph.prototype.absToRel = function (propGroup, absFrame) {
  return Math.round(absFrame - (propGroup.pz_frameOffset || 0));
};
PZ.ui.graph.prototype.relToAbs = function (propGroup, relFrame) {
  return relFrame + (propGroup.pz_frameOffset || 0);
};
PZ.ui.graph.prototype.propGroups = function () {
  if (!this.curveLayer) return [];
  return Array.prototype.slice.call(this.curveLayer.children);
};
PZ.ui.graph.prototype.selectedKeys = function () {
  if (!this.svg) return [];
  return Array.prototype.slice.call(this.svg.querySelectorAll(".g2-kf.selected"));
};
PZ.ui.graph.prototype.graphColor = function (prop) {
  return curveColor(displayName(prop));
};
PZ.ui.graph.prototype.isHidden = function (prop) {
  return !!this._hidden[addrString(prop)];
};
PZ.ui.graph.prototype.refreshScaleFor = function (gEl) {
  var prop = gEl.pz_object;
  if (!prop) return;
  if (!this.options.normalize) {
    gEl.pz_valueScale = 1 / (scaleFactorOf(prop) || 1);
    return;
  }
  var maxAbs = 0, mn = Infinity, mx = -Infinity;
  for (var i = 0; i < prop.keyframes.length; i++) {
    var v = prop.keyframes[i].value;
    if (typeof v !== "number") continue;
    if (Math.abs(v) > maxAbs) maxAbs = Math.abs(v);
    if (v < mn) mn = v; if (v > mx) mx = v;
  }
  if (!(maxAbs > 1e-9)) maxAbs = 1;
  gEl.pz_valueScale = 80 / maxAbs;
  gEl.pz_dataMin = mn; gEl.pz_dataMax = mx;
};
PZ.ui.graph.prototype.refreshAllScales = function () {
  var groups = this.propGroups();
  for (var i = 0; i < groups.length; i++) this.refreshScaleFor(groups[i]);
};

/* ---------- view ---------- */
PZ.ui.graph.prototype.updateViewBox = function () {
  if (!this.svg) return;
  // BUGFIX: click made grid disappear — NaN center/zoom (e.g. non-numeric
  // values in fitAll) poisoned the viewBox. Self-heal here.
  if (!isFinite(this.centerX) || !isFinite(this.centerY) || !isFinite(this.zoomX) || !isFinite(this.zoomY) ||
      !(this.zoomX > 0) || !(this.zoomY > 0) || !(this.width > 0) || !(this.height > 0)) {
    this.centerX = isFinite(this.centerX) ? this.centerX : 90;
    this.centerY = isFinite(this.centerY) ? this.centerY : 0;
    this.zoomX = isFinite(this.zoomX) && this.zoomX > 0 ? this.zoomX : 1;
    this.zoomY = isFinite(this.zoomY) && this.zoomY > 0 ? this.zoomY : 1;
    this.width = isFinite(this.width) && this.width > 0 ? this.width : 800;
    this.height = isFinite(this.height) && this.height > 0 ? this.height : 600;
  }
  this.svg.setAttributeNS(null, "viewBox", this.viewX() + " " + this.viewY() + " " + this.viewW() + " " + this.viewH());
  if (this.cursor) {
    this.cursor.setAttributeNS(null, "y1", this.centerY - 0.5 * this.height * this.zoomY);
    this.cursor.setAttributeNS(null, "y2", this.centerY + 0.5 * this.height * this.zoomY);
  }
  if (this.zeroH) {
    this.zeroH.setAttributeNS(null, "x1", this.centerX - 0.5 * this.width * this.zoomX);
    this.zeroH.setAttributeNS(null, "x2", this.centerX + 0.5 * this.width * this.zoomX);
    this.zeroH.setAttributeNS(null, "y1", 0);
    this.zeroH.setAttributeNS(null, "y2", 0);
  }
  if (this.rangeRect) {
    var tf = totalFrames(this.editor);
    this.rangeRect.setAttributeNS(null, "x", 0);
    this.rangeRect.setAttributeNS(null, "y", this.centerY - 0.5 * this.height * this.zoomY);
    this.rangeRect.setAttributeNS(null, "width", Math.max(tf, 1));
    this.rangeRect.setAttributeNS(null, "height", this.height * this.zoomY);
  }
  if (this.xGrid) this.xGrid.update();
  if (this.yGrid) this.yGrid.update();
  var groups = this.propGroups();
  for (var g = 0; g < groups.length; g++) {
    var gel = groups[g];
    var keys = gel._keys ? Array.prototype.slice.call(gel._keys.children) : [];
    for (var k = 0; k < keys.length; k++) {
      this.updateKeyframe(keys[k]);
      if (keys[k].pz_handles) this.updateHandles(keys[k].pz_handles);
    }
    var paths = gel._curves ? Array.prototype.slice.call(gel._curves.children) : [];
    for (var p = 0; p < paths.length; p++) {
      var ph = paths[p];
      this.updateCurve(ph, ph.pz_left || null, ph.pz_right || null);
    }
    if (gel._label) this.positionLabel(gel);
  }
  try { this.drawRuler(); } catch (e) { gpWarnOnce("ruler", "ruler redraw failed", e); }
};
PZ.ui.graph.prototype.fitAll = function (onlySelected) {
  var groups = this.propGroups();
  var t = Infinity, b = -Infinity, l = Infinity, r = -Infinity;
  var tf = totalFrames(this.editor);
  var found = false;
  for (var gi = 0; gi < groups.length; gi++) {
    var gel = groups[gi];
    if (gel.style.display === "none") continue;
    var scale = gel.pz_valueScale || 1;
    var off = gel.pz_frameOffset || 0;
    var keys = onlySelected
      ? Array.prototype.slice.call(gel._keys.querySelectorAll(".selected"))
      : Array.prototype.slice.call(gel._keys.children);
    for (var k = 0; k < keys.length; k++) {
      var kf = keys[k].pz_object;
      if (!kf || typeof kf.value !== "number" || !isFinite(kf.value) || !isFinite(kf.frame)) continue;
      var ax = kf.frame + off;
      var gy = -kf.value * scale;
      var cp = kf.controlPoints;
      if (cp && cp[0] && cp[1] && isFinite(cp[0][1]) && isFinite(cp[1][1])) {
        gy = Math.min(gy, -(kf.value + cp[0][1]) * scale, -(kf.value + cp[1][1]) * scale);
      }
      if (ax < l) l = ax; if (ax > r) r = ax;
      if (gy < t) t = gy; if (gy > b) b = gy;
      found = true;
    }
  }
  if (!found) { l = 0; r = tf; t = -100; b = 100; }
  if (!(r > l)) { r = l + 10; }
  if (!(b > t)) { b = t + 10; }
  // frame the keys with comfortable padding (C4D-like), not the whole timeline
  var padX = 0.06 * (r - l) + (1 / Math.max(this.width, 1)) * (r - l);
  var padY = 0.09 * (b - t) + (1 / Math.max(this.height, 1)) * (b - t);
  l -= padX; r += padX; t -= padY; b += padY;
  this.centerX = 0.5 * (l + r);
  this.centerY = 0.5 * (t + b);
  if (this.width > 1) this.zoomX = clamp((r - l) / this.width, 0.02, 200);
  if (this.height > 1) this.zoomY = clamp((b - t) / this.height, 0.001, 5000);
  this.updateViewBox();
};
PZ.ui.graph.prototype.frameSelected = function () {
  if (!this.selectedKeys().length) { this.fitAll(false); return; }
  this.fitAll(true);
};

/* ---------- creation ---------- */
PZ.ui.graph.prototype.createGraph = function () {
  this.svg = this._doc().createElementNS(SVGNS, "svg");
  this.svg.setAttributeNS(null, "preserveAspectRatio", "none");
  this.svg.setAttributeNS(null, "width", "100%");
  this.svg.setAttributeNS(null, "height", "100%");
  this.svg.setAttributeNS(null, "shape-rendering", this.options.shapeRendering);
  this.svg.style.background = "var(--zui-bg-sunken)";
  this.bodyEl.appendChild(this.svg);
};
PZ.ui.graph.prototype.createCursor = function () {
  var doc = this._doc();
  var g = doc.createElementNS(SVGNS, "g");
  g.setAttributeNS(null, "fill", "none");
  g.setAttributeNS(null, "stroke", "var(--zui-value)");
  g.setAttributeNS(null, "stroke-width", this.options.cursorLineWidth + "px");
  g.style.pointerEvents = "none";
  this.cursorLayer = g;
  this.svg.appendChild(g);
  this.cursor = doc.createElementNS(SVGNS, "line");
  this.cursor.setAttributeNS(null, "vector-effect", "non-scaling-stroke");
  g.appendChild(this.cursor);
  // zero line
  this.zeroH = doc.createElementNS(SVGNS, "line");
  this.zeroH.setAttributeNS(null, "stroke", "var(--zui-text-faint)");
  this.zeroH.setAttributeNS(null, "stroke-width", "1px");
  this.zeroH.setAttributeNS(null, "vector-effect", "non-scaling-stroke");
  this.zeroH.style.pointerEvents = "none";
  this.svg.insertBefore(this.zeroH, this.cursorLayer);
};
/* C4D-style frame ruler: numbers + scrub (like Cinema 4D timeline ruler) */
PZ.ui.graph.prototype.drawRuler = function () {
  var c = this.rulerCanvas;
  if (!c || !this.bodyEl) return;
  var w = Math.max(this.bodyEl.clientWidth, 1);
  var h = 30;
  var dpr = 1;
  try { dpr = (this._win && this._win().devicePixelRatio) || dpr || 1; } catch (e) {}
  if (!(dpr > 0)) dpr = 1;
  if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
  }
  var ctx = null;
  try { ctx = c.getContext("2d"); } catch (e) { return; }
  if (!ctx) return;
  gpSyncTheme(c.ownerDocument);
  var theme = c.ownerDocument.defaultView.getComputedStyle(c);
  function token(name) { return theme.getPropertyValue(name).trim(); }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = token("--zui-bg");
  ctx.fillRect(0, 0, w, h);
  var vx = this.viewX(), vw = Math.max(this.viewW(), 1e-6);
  var pxPerF = w / vw;
  var steps = [1, 2, 5, 10, 20, 25, 50, 100, 200, 500, 1000, 2000];
  var step = steps[steps.length - 1];
  for (var si = 0; si < steps.length; si++) {
    if (steps[si] * pxPerF >= 64) { step = steps[si]; break; }
  }
  var minor = step >= 5 ? step / 5 : step;
  // playback range shade
  var tf = totalFrames(this.editor);
  var rx0 = (0 - vx) / vw * w, rx1 = (tf - vx) / vw * w;
  ctx.fillStyle = token("--zui-hover");
  ctx.fillRect(Math.max(rx0, 0), 0, Math.min(rx1, w) - Math.max(rx0, 0), h);
  ctx.textBaseline = "top";
  // minor ticks
  ctx.strokeStyle = token("--zui-border-soft");
  ctx.lineWidth = 1;
  ctx.beginPath();
  var m0 = Math.ceil(vx / minor) * minor;
  for (var m = m0; m <= vx + vw; m += minor) {
    var mx = Math.round((m - vx) / vw * w) + 0.5;
    ctx.moveTo(mx, h - 6);
    ctx.lineTo(mx, h);
  }
  ctx.stroke();
  // Major ticks and frame numbers follow the editor font and text color.
  ctx.fillStyle = token("--zui-text-strong");
  ctx.font = "10px " + token("--zui-font");
  ctx.strokeStyle = token("--zui-text-faint");
  ctx.beginPath();
  var f0 = Math.ceil(vx / step) * step;
  for (var f = f0; f <= vx + vw; f += step) {
    var x = Math.round((f - vx) / vw * w) + 0.5;
    ctx.moveTo(x, h - 12);
    ctx.lineTo(x, h);
  }
  ctx.stroke();
  for (var g = f0; g <= vx + vw; g += step) {
    var gx = (g - vx) / vw * w;
    ctx.fillText(String(Math.round(g)), gx + 4, 3);
  }
  // Playhead marker follows the editor value color.
  var pf = currentFrame(this.editor);
  var px = (pf - vx) / vw * w;
  if (px >= -10 && px <= w + 10) {
    ctx.fillStyle = token("--zui-value");
    ctx.fillRect(px - 1, 0, 2, h);
    ctx.beginPath();
    ctx.moveTo(px - 5, 0);
    ctx.lineTo(px + 5, 0);
    ctx.lineTo(px, 7);
    ctx.closePath();
    ctx.fill();
  }
};
/* tool modes: pan (left-drag moves the view) | sel (left-drag marquee-selects) */
PZ.ui.graph.prototype.applyToolCursor = function () {
  try {
    var c = this.canvasEl;
    if (!c) return;
    if (this._dragging === "pan") c.style.cursor = "grabbing";
    else if (this.tool === "sel") c.style.cursor = "crosshair";
    else c.style.cursor = "grab";
    if (this.rulerEl) this.rulerEl.style.cursor = "ew-resize";
  } catch (e) { /* Cursor styling is cosmetic; the editor stays usable. */ }
};
PZ.ui.graph.prototype.setTool = function (tool) {
  this.tool = (tool === "sel") ? "sel" : "pan";
  if (this.panBtn) this.panBtn.classList.toggle("on", this.tool === "pan");
  if (this.selToolBtn) this.selToolBtn.classList.toggle("on", this.tool === "sel");
  this.applyToolCursor();
  this.updateStatus(this.tool === "sel"
    ? "marquee tool ON — drag to select · H: pan tool"
    : "pan tool ON — drag to move the grid · V: marquee");
};

return GraphGrid;
};
