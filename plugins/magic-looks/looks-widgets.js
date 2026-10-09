"use strict";

// Magic Looks — the two custom canvas widgets: the color wheel (tint dot on
// a hue disc with a luminance ring) and the curves pad. Both are DOM + canvas
// only and sized by their container. Everything else in the setup window
// uses ZoidiumUI.controls. Colors follow the CM3 panel palette.

var Looks = Looks || {};

(function (Looks) {
  var C = Looks.color;
  var widgets = {};

  function make(tag, cls, text) {
    var el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text !== undefined && text !== null) el.textContent = text;
    return el;
  }

  function dpr() {
    return (typeof window !== "undefined" && window.devicePixelRatio) || 1;
  }

  // Sizes a canvas for crisp output and returns its 2D context (scaled so
  // drawing uses CSS pixels).
  function fitCanvas(canvas, width, height) {
    var ratio = dpr();
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    canvas.style.width = width + "px";
    canvas.style.height = height + "px";
    var ctx = canvas.getContext("2d");
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    return ctx;
  }

  // Ring and hue disc are static for a given size, so they are painted once
  // into an offscreen canvas and blitted on every redraw.
  function paintBase(size) {
    var off = document.createElement("canvas");
    var ctx = fitCanvas(off, size, size);
    var cx = size / 2, cy = size / 2;
    var rOut = size / 2 - 3;
    var rRing = rOut - 14;
    var rDisc = rRing - 4;
    var steps = 120;
    var i, a0, a1, rgb;
    for (i = 0; i < steps; i++) {
      // Luminance ring: dark at the top, light at the bottom.
      var f = i / (steps - 1);
      var shade = Math.round(40 + f * 170);
      a0 = (i / steps) * Math.PI * 2 - Math.PI / 2;
      a1 = ((i + 1) / steps) * Math.PI * 2 - Math.PI / 2;
      ctx.beginPath();
      ctx.arc(cx, cy, rOut, a0, a1 + 0.002);
      ctx.arc(cx, cy, rRing, a1 + 0.002, a0, true);
      ctx.closePath();
      ctx.fillStyle = "rgb(" + shade + "," + shade + "," + shade + ")";
      ctx.fill();
    }
    // Hue disc: red at the top, hue increasing clockwise.
    var hueSteps = 144;
    for (i = 0; i < hueSteps; i++) {
      a0 = -Math.PI / 2 + (i / hueSteps) * Math.PI * 2;
      a1 = -Math.PI / 2 + ((i + 1) / hueSteps) * Math.PI * 2;
      rgb = C.hsvToRgb((i / hueSteps) * 360, 1, 1);
      ctx.beginPath();
      ctx.arc(cx, cy, rDisc, a0, a1 + 0.002);
      ctx.arc(cx, cy, 0, a1 + 0.002, a0, true);
      ctx.closePath();
      ctx.fillStyle = "rgb(" + Math.round(rgb[0] * 255) + "," + Math.round(rgb[1] * 255) + "," + Math.round(rgb[2] * 255) + ")";
      ctx.fill();
    }
    var g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rDisc);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(0.7, "rgba(0,0,0,0.05)");
    g.addColorStop(1, "rgba(0,0,0,0.35)");
    ctx.beginPath();
    ctx.arc(cx, cy, rDisc, 0, Math.PI * 2);
    ctx.fillStyle = g;
    ctx.fill();
    return { canvas: off, rOut: rOut, rRing: rRing, rDisc: rDisc };
  }

  /* ---------------- ColorWheel ---------------- */

  // A tint wheel. `initial` is { angle, radius } (see Looks.color.tintToDot).
  // onInput(dot, rgb) fires while dragging; onCommit(dot, rgb) fires once on
  // release, which is where the host records undo history.
  widgets.ColorWheel = function (container, opts) {
    opts = opts || {};
    var size = Math.max(96, Math.round(opts.size || 180));
    var wrap = make("div", "lk-wheel-wrap");
    var canvas = make("canvas", "lk-wheel");
    canvas.title = "Drag to tint. Double-click to reset.";
    canvas.setAttribute("role", "slider");
    wrap.appendChild(canvas);
    container.appendChild(wrap);

    var base = paintBase(size);
    var dot = {
      angle: (opts.initial && opts.initial.angle) || 0,
      radius: (opts.initial && opts.initial.radius) || 0,
    };
    var inputFn = null;
    var commitFn = null;
    var dragging = false;
    var disposed = false;

    function rgbNow() {
      return C.wheelTint(dot.angle, dot.radius);
    }

    function draw() {
      var ctx = fitCanvas(canvas, size, size);
      var cx = size / 2, cy = size / 2;
      ctx.clearRect(0, 0, size, size);
      ctx.drawImage(base.canvas, 0, 0, size, size);
      var pr = dot.radius * (base.rDisc - 6);
      var pa = (dot.angle - 90) * Math.PI / 180;
      var dx = cx + Math.cos(pa) * pr;
      var dy = cy + Math.sin(pa) * pr;
      var tint = C.wheelTint(dot.angle, Math.max(dot.radius, 0.001));
      ctx.beginPath();
      ctx.arc(dx, dy, 6, 0, Math.PI * 2);
      ctx.fillStyle = "rgb(" + Math.round(tint[0] * 255) + "," + Math.round(tint[1] * 255) + "," + Math.round(tint[2] * 255) + ")";
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = "#ccc";
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(dx, dy, 2, 0, Math.PI * 2);
      ctx.fillStyle = "#1b1b1b";
      ctx.fill();
    }

    function setFromEvent(e) {
      var rect = canvas.getBoundingClientRect();
      var cx = rect.left + rect.width / 2;
      var cy = rect.top + rect.height / 2;
      var dx = (e.clientX - cx) / (rect.width / 2);
      var dy = (e.clientY - cy) / (rect.height / 2);
      dot.radius = C.clamp(Math.sqrt(dx * dx + dy * dy), 0, 1);
      dot.angle = (Math.atan2(dy, dx) * 180 / Math.PI + 90 + 360) % 360;
      draw();
      if (inputFn) inputFn(snapshotDot(), rgbNow());
    }

    function snapshotDot() {
      return { angle: dot.angle, radius: dot.radius };
    }

    function onDown(e) {
      if (e.button !== 0) return;
      dragging = true;
      try { canvas.setPointerCapture(e.pointerId); } catch (_err) { /* optional */ }
      setFromEvent(e);
      e.preventDefault();
    }
    function onMove(e) {
      if (dragging) setFromEvent(e);
    }
    function onUp() {
      if (!dragging) return;
      dragging = false;
      if (commitFn) commitFn(snapshotDot(), rgbNow());
    }
    function onDbl() {
      dot.angle = 0;
      dot.radius = 0;
      draw();
      if (commitFn) commitFn(snapshotDot(), rgbNow());
    }
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onUp);
    canvas.addEventListener("dblclick", onDbl);
    draw();

    return {
      el: wrap,
      onInput: function (fn) { inputFn = fn; },
      onCommit: function (fn) { commitFn = fn; },
      set: function (d) {
        if (disposed) return;
        dot.angle = (d && d.angle) || 0;
        dot.radius = C.clamp((d && d.radius) || 0, 0, 1);
        draw();
      },
      destroy: function () {
        disposed = true;
        canvas.removeEventListener("pointerdown", onDown);
        canvas.removeEventListener("pointermove", onMove);
        canvas.removeEventListener("pointerup", onUp);
        canvas.removeEventListener("pointercancel", onUp);
        canvas.removeEventListener("dblclick", onDbl);
        if (wrap.parentElement) wrap.parentElement.removeChild(wrap);
      },
    };
  };

  /* ---------------- CurvesPad ---------------- */

  var CHANNEL_COLORS = { RGB: "#ccc", Red: "#e05a5a", Green: "#5ae05a", Blue: "#5a8ae0" };

  // Curve editor for the Curves tool. `state` is the channels map
  // ({ RGB, Red, Green, Blue } point lists). Click empty space to add a point,
  // drag points, right-click to remove one. Endpoints keep their x.
  widgets.CurvesPad = function (container, opts) {
    opts = opts || {};
    var width = Math.max(180, Math.round(opts.width || 300));
    var height = Math.max(120, Math.round(opts.height || 200));
    var pad = 10;
    var wrap = make("div", "lk-curves-wrap");
    var canvas = make("canvas", "lk-curves");
    canvas.title = "Click adds a point, drag moves it, right-click removes it.";
    wrap.appendChild(canvas);
    container.appendChild(wrap);

    var channels = opts.channels || {};
    var channel = opts.channel || "RGB";
    var inputFn = null;
    var commitFn = null;
    var dragging = -1;
    var disposed = false;

    function points() {
      if (!channels[channel]) channels[channel] = [{ x: 0, y: 0 }, { x: 1, y: 1 }];
      return channels[channel];
    }
    function toPx(p) {
      return { x: pad + p.x * (width - 2 * pad), y: pad + (1 - p.y) * (height - 2 * pad) };
    }
    function toVal(px) {
      return {
        x: C.clamp((px.x - pad) / (width - 2 * pad), 0, 1),
        y: C.clamp(1 - (px.y - pad) / (height - 2 * pad), 0, 1),
      };
    }
    function localPx(e) {
      var rect = canvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    }
    function nearest(px) {
      var pts = points();
      var best = -1, bestD = 100;
      for (var i = 0; i < pts.length; i++) {
        var q = toPx(pts[i]);
        var d = (q.x - px.x) * (q.x - px.x) + (q.y - px.y) * (q.y - px.y);
        if (d < bestD) { bestD = d; best = i; }
      }
      return best;
    }

    function draw() {
      var ctx = fitCanvas(canvas, width, height);
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = "#202020";
      ctx.fillRect(0, 0, width, height);
      ctx.strokeStyle = "#333";
      ctx.lineWidth = 1;
      for (var g = 1; g < 4; g++) {
        var gx = pad + g * (width - 2 * pad) / 4;
        var gy = pad + g * (height - 2 * pad) / 4;
        ctx.beginPath(); ctx.moveTo(gx, pad); ctx.lineTo(gx, height - pad); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(pad, gy); ctx.lineTo(width - pad, gy); ctx.stroke();
      }
      ctx.strokeStyle = "#444";
      ctx.beginPath(); ctx.moveTo(pad, height - pad); ctx.lineTo(width - pad, pad); ctx.stroke();
      var pts = points().slice().sort(function (a, b) { return a.x - b.x; });
      ctx.beginPath();
      pts.forEach(function (p, i) {
        var q = toPx(p);
        if (i === 0) ctx.moveTo(q.x, q.y); else ctx.lineTo(q.x, q.y);
      });
      ctx.strokeStyle = CHANNEL_COLORS[channel] || "#ccc";
      ctx.lineWidth = 1.5;
      ctx.stroke();
      points().forEach(function (p) {
        var q = toPx(p);
        ctx.beginPath();
        ctx.arc(q.x, q.y, 4, 0, Math.PI * 2);
        ctx.fillStyle = "#1b1b1b";
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = CHANNEL_COLORS[channel] || "#ccc";
        ctx.stroke();
      });
    }

    function emit(commit) {
      var fn = commit ? commitFn : inputFn;
      if (fn) fn(channels);
    }

    function onDown(e) {
      if (e.button !== 0) return;
      var px = localPx(e);
      var idx = nearest(px);
      if (idx < 0) {
        var pts = points();
        pts.push(toVal(px));
        pts.sort(function (a, b) { return a.x - b.x; });
        draw();
        emit(true);
        return;
      }
      dragging = idx;
      try { canvas.setPointerCapture(e.pointerId); } catch (_err) { /* optional */ }
      e.preventDefault();
    }
    function onMove(e) {
      if (dragging < 0) return;
      var pts = points();
      var v = toVal(localPx(e));
      var p = pts[dragging];
      if (!p) return;
      // Endpoints keep their x so the curve always spans the full range.
      var isEnd = dragging === 0 || dragging === pts.length - 1;
      if (!isEnd) p.x = v.x;
      p.y = v.y;
      draw();
      emit(false);
    }
    function onUp() {
      if (dragging < 0) return;
      dragging = -1;
      emit(true);
    }
    function onContext(e) {
      e.preventDefault();
      var pts = points();
      var idx = nearest(localPx(e));
      if (idx <= 0 || idx >= pts.length - 1) return;
      pts.splice(idx, 1);
      draw();
      emit(true);
    }

    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onUp);
    canvas.addEventListener("contextmenu", onContext);
    draw();

    return {
      el: wrap,
      onInput: function (fn) { inputFn = fn; },
      onCommit: function (fn) { commitFn = fn; },
      setChannel: function (name) {
        channel = name;
        draw();
      },
      set: function (next) {
        if (disposed) return;
        channels = next || channels;
        draw();
      },
      destroy: function () {
        disposed = true;
        canvas.removeEventListener("pointerdown", onDown);
        canvas.removeEventListener("pointermove", onMove);
        canvas.removeEventListener("pointerup", onUp);
        canvas.removeEventListener("pointercancel", onUp);
        canvas.removeEventListener("contextmenu", onContext);
        if (wrap.parentElement) wrap.parentElement.removeChild(wrap);
      },
    };
  };

  Looks.widgets = widgets;
})(Looks);
