"use strict";

const { easingPoints } = require("./sampling.js");
const { controllers, readFollow } = require("./selection.js");

module.exports = function (environment) {
const { PZ, tileIcon, customEaseIcon, toolIcon, focusNoScroll, g2doc, g2win } = environment;
/* Break / Auto tangents on selected keys */
PZ.ui.graph.prototype.setTangentsOnSelected = function (continuous) {
  var sel = this.selectedKeys();
  if (!sel.length) { this.updateStatus("select keys first"); return; }
  this.editor.history.startOperation();
  for (var i = 0; i < sel.length; i++) {
    var gel = sel[i].parentElement.parentElement;
    if (!gel || !gel.pz_object) continue;
    var kf = sel[i].pz_object;
    this.setContinuousTangentExact(gel.pz_object, kf, continuous);
  }
  this.editor.history.finishOperation();
  this.updateStatus(continuous ? "auto tangents" : "tangents broken");
};
/* Custom easings popup (user design: tile + dropdown list) */
PZ.ui.graph.prototype.toggleEasePopup = function () {
  var self = this;
  if (this.easePopup) { this.closeEasePopup(); return; }
  var doc = null;
  try { doc = this._doc(); } catch (eDoc) {}
  if (!doc || typeof doc.createElement !== "function") doc = g2doc(this.rootEl);
  function mk(tag) {
    try {
      if (doc && doc.createElement) return doc.createElement(tag);
    } catch (eMk) {}
    return document.createElement(tag);
  }
  var pop = mk("div");
  pop.className = "g2-popup";
  var head = mk("div");
  head.className = "g2-popup-head";
  head.textContent = "CUSTOM EASINGS";
  pop.appendChild(head);
  var names = [];
  try { names = PZ.tween.easingList.map(function (e) { return e.name; }); } catch (e) { names = ["linear"]; }
  names.forEach(function (n, i) {
    var it = mk("div");
    it.className = "g2-popup-item";
    it.textContent = i + ": " + n;
    var svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 -12 64 64");
    svg.setAttribute("width", "64"); svg.setAttribute("height", "48");
    svg.setAttribute("aria-hidden", "true");
    var path = doc.createElementNS("http://www.w3.org/2000/svg", "path");
    var fn = PZ.tween.easingList[i].fn;
    var points = fn ? easingPoints(fn, 60, 36) : [[0, 0], [1, 0], [1, 1]];
    path.setAttribute("d", points.map((p, k) => (k ? "L" : "M") + (2 + p[0] * 60) + " " + (40 - p[1] * 36)).join(" "));
    path.setAttribute("fill", "none"); path.setAttribute("stroke", "currentColor");
    path.setAttribute("stroke-width", "1.5"); svg.appendChild(path); it.prepend(svg);
    it.addEventListener("mousedown", function (ev) { ev.preventDefault(); ev.stopPropagation(); });
    it.addEventListener("click", function (ev) {
      ev.stopPropagation();
      self.closeEasePopup();
      self.applyEasingToSelected(i);
    });
    pop.appendChild(it);
  });
  this.easePopup = pop;
  this.rootEl.appendChild(pop);
  try {
    var r = this.customEaseBtn.getBoundingClientRect();
    var rr = this.rootEl.getBoundingClientRect();
    pop.style.left = Math.max(4, r.left - rr.left) + "px";
    pop.style.top = (r.bottom - rr.top + 4) + "px";
  } catch (e) { /* The popup still opens; only its anchor is lost. */ }
  this._easeOutside = function (ev) {
    if (pop === ev.target || pop.contains(ev.target)) return;
    self.closeEasePopup();
  };
  var to = setTimeout(function () {
    try {
      var w = (self._win && self._win()) || g2win(self.rootEl);
      if (w && w.addEventListener) {
        w.addEventListener("pointerdown", self._easeOutside, true);
        self._easeWin = w;
      }
    } catch (eWin) { /* Without outside-dismiss the popup still closes on pick or Esc. */ }
  }, 0);
  pop._openTO = to;
};
PZ.ui.graph.prototype.closeEasePopup = function () {
  if (!this.easePopup) return;
  try { clearTimeout(this.easePopup._openTO); } catch (e) {}
  if (this._easeOutside) {
    try {
      if (this._easeWin && this._easeWin.removeEventListener) {
        this._easeWin.removeEventListener("pointerdown", this._easeOutside, true);
      }
    } catch (e2) { /* The closing window drops its listeners with it. */ }
    try {
      var w = (this._win && this._win()) || g2win(this.rootEl);
      if (w && w !== this._easeWin && w.removeEventListener) {
        w.removeEventListener("pointerdown", this._easeOutside, true);
      }
    } catch (e3) { /* The closing window drops its listeners with it. */ }
    this._easeOutside = null;
    this._easeWin = null;
  }
  try { this.easePopup.remove(); } catch (e) { /* A closed popup needs no removal. */ }
  this.easePopup = null;
};
PZ.ui.graph.prototype.buildToolbar = function () {
  var self = this;
  var tb = this.toolbarEl;
  while (tb.firstChild) tb.firstChild.remove();
  function mk(tag) {
    try {
      var d = self._doc();
      if (d && d.createElement) return d.createElement(tag);
    } catch (e) {}
    return document.createElement(tag);
  }
  function group() {
    var g = mk("div");
    g.className = "g2-group";
    tb.appendChild(g);
    return g;
  }
  function sep() {
    var s = mk("span");
    s.className = "g2-sep";
    tb.appendChild(s);
  }
  function white(el) {
    // bulletproof white text: inline !important beats any stylesheet
    try {
      el.style.setProperty("color", "var(--zui-text-bright)", "important");
      var kids = el.querySelectorAll("span");
      for (var q = 0; q < kids.length; q++) kids[q].style.setProperty("color", "var(--zui-text-bright)", "important");
    } catch (e) { /* Cosmetic only; the tile still works unstyled. */ }
    return el;
  }
  /* big tile: dark box with artwork + label beneath (user design) */
  function tile(parent, icon, label, title, fn, cls) {
    var b = mk("button");
    b.className = "g2-tile" + (cls ? " " + cls : "");
    b.title = title;
    b.setAttribute("aria-label", label);
    b.innerHTML = '<span class="g2-box">' + icon + '</span><span class="g2-tlabel">' + label + "</span>";
    white(b);
    b.addEventListener("mousedown", function (e) { e.preventDefault(); });
    b.addEventListener("click", function (e) { e.stopPropagation(); focusNoScroll(self.bodyEl); fn(); });
    parent.appendChild(b);
    return b;
  }
  function small(parent, icon, label, kbd, title, fn, cls) {
    return tile(parent, icon, label, title + (kbd ? " (" + kbd + ")" : ""), fn, "g2-small" + (cls ? " " + cls : ""));
  }
  /* ---- interpolation presets (big tiles, matching the reference design) ---- */
  var gi = group();
  tile(gi, tileIcon("linear"), "Linear", "Linear interpolation — apply to selected keys", function () { self.applyEasingToSelected(1); });
  tile(gi, tileIcon("step"), "Step", "Step / hold — value jumps at the key", function () { self.applyEasingToSelected(0); });
  tile(gi, tileIcon("ease"), "Ease", "Smooth ease (cubic in-out) — apply to selected keys", function () { self.applyEasingToSelected(7); });
  tile(gi, tileIcon("break"), "Break Tangents", "Break tangents on selected keys", function () { self.setTangentsOnSelected(false); });
  tile(gi, tileIcon("auto"), "Auto Tangents", "Auto (continuous) tangents on selected keys", function () { self.setTangentsOnSelected(true); });
  sep();
  /* ---- custom easings: thumbnail + label to the RIGHT (mockup) ---- */
  var gc = group();
  this.customEaseBtn = (function () {
    var b = mk("button");
    b.className = "g2-custom";
    b.title = "Custom easings — pick any of the 33 easings";
    b.setAttribute("aria-label", "Custom easings");
    b.innerHTML = '<span class="g2-sbox">' + customEaseIcon() + '</span><span class="g2-clabel">Custom easings</span>';
    white(b);
    b.addEventListener("mousedown", function (e) { e.preventDefault(); });
    b.addEventListener("click", function (e) { e.stopPropagation(); focusNoScroll(self.bodyEl); self.toggleEasePopup(); });
    gc.appendChild(b);
    return b;
  })();
  /* ---- other functions, right-aligned (user placeholder area) ---- */
  var spacer = mk("span");
  spacer.className = "g2-spacer";
  tb.appendChild(spacer);
  var gf = group();
  this.followBtn = small(gf, toolIcon("link"), "Follow selection", "", "Follow selection", function () {
    var controller = controllers.get(self.editor);
    if (controller) controller.setFollow(!controller.follow);
  });
  var controller = controllers.get(this.editor);
  var follow = controller ? controller.follow : readFollow(null);
  this.followBtn.classList.toggle("on", follow);
  this.followBtn.setAttribute("aria-pressed", String(follow));
  this.axesBtn = small(gf, toolIcon("link"), "Link axes", "", "Move sibling keys together in time", function () {
    self.options.linkAxes = !self.options.linkAxes;
    self.axesBtn.classList.toggle("on", self.options.linkAxes);
    self.axesBtn.setAttribute("aria-pressed", String(self.options.linkAxes));
  });
  this.axesBtn.setAttribute("aria-pressed", "false");
  var gv = group();
  this.panBtn = small(gv, toolIcon("pan"), "Pan", "H", "Pan tool — left-drag moves the grid (default)", function () { self.setTool("pan"); }, "on");
  this.selToolBtn = small(gv, toolIcon("marquee"), "Marquee", "V", "Marquee tool — left-drag selects keys (Shift+drag in any tool)", function () { self.setTool("sel"); });
  small(gv, toolIcon("fit"), "Fit", "\\", "Fit all curves", function () { self.fitAll(false); });
  small(gv, toolIcon("frame"), "Frame", "F", "Frame selected keys", function () { self.frameSelected(); });
  this.normBtn = small(gv, toolIcon("norm"), "Norm", "N", "Normalize curves to same height", function () {
    self.options.normalize = !self.options.normalize;
    self.normBtn.classList.toggle("on", self.options.normalize);
    self.refreshAllScales(); self.updateViewBox(); self.updateLegend(); self.updateStatus();
  });
  if (this.options.normalize) this.normBtn.classList.add("on");
  this.snapBtn = small(gv, toolIcon("snap"), "Snap", "S", "Snap to playhead + keys", function () {
    self.options.snap = !self.options.snap;
    self.snapBtn.classList.toggle("on", self.options.snap);
    self.updateStatus();
  }, "on");
  if (!this.options.snap) this.snapBtn.classList.remove("on");
  sep();
  var gk = group();
  small(gk, toolIcon("key"), "+Key", "K", "Add keyframe at playhead on all curves", function () { self.addKeyframeAtPlayhead(); }, "g2-acc");
  small(gk, toolIcon("del"), "Del", "Del", "Delete selected", function () {
    self.editor.history.startOperation();
    self.deleteKeyframes(self.selectedKeys());
    self.editor.history.finishOperation();
  });
  sep();
  var ge = group();
  small(ge, toolIcon("bez"), "Bezier", "I", "Toggle bezier / linear", function () {
    self.editor.history.startOperation(); self.toggleInterpolation(self.selectedKeys()); self.editor.history.finishOperation();
  });
  small(ge, toolIcon("link"), "Link", "T", "Toggle continuous tangent", function () {
    self.editor.history.startOperation(); self.toggleContinuousTangents(self.selectedKeys()); self.editor.history.finishOperation();
  });
  small(ge, toolIcon("flat"), "Flat", "R", "Reset handles", function () {
    self.editor.history.startOperation(); self.resetHandles(self.selectedKeys()); self.editor.history.finishOperation();
  });
  sep();
  var gd = group();
  small(gd, toolIcon("copy"), "Copy", "Ctrl+C", "Copy", function () { self.copySelected(); });
  small(gd, toolIcon("paste"), "Paste", "Ctrl+V", "Paste at playhead", function () { self.pasteAtPlayhead(); });
  this.labelsBtn = small(gd, toolIcon("tag"), "Labels", "", "Toggle curve labels", function () {
    self.options.showLabels = !self.options.showLabels;
    self.labelsBtn.classList.toggle("on", self.options.showLabels !== false);
    self.updateViewBox();
  }, "on");
  if (this.options.showLabels === false) this.labelsBtn.classList.remove("on");
};
};
