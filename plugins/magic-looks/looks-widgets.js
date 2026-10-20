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

  // Theme colors for canvas chrome. Canvas cannot use CSS directly, so the
  // widget stylesheets expose resolved --lk-* values on each canvas (backed
  // by the --zui-* theme tokens) and they are read here at draw time, with
  // the neutral CM3 defaults as fallback. Data colors (hue discs, channel
  // curves) stay literal.
  function canvasVar(canvas, name, fallback) {
    try {
      const doc = canvas && canvas.ownerDocument;
      const view = doc && doc.defaultView;
      if (view && typeof view.getComputedStyle === "function") {
        const value = view.getComputedStyle(canvas).getPropertyValue(name);
        if (value && value.trim()) return value.trim();
      }
    } catch (_err) { /* fall back to the neutral default */ }
    return fallback;
  }

  function wheelTheme(canvas) {
    return {
      ring: canvasVar(canvas, "--lk-dot-ring", "#ccc"),
      core: canvasVar(canvas, "--lk-dot-core", "#1b1b1b"),
    };
  }

  function curvesTheme(canvas) {
    return {
      bg: canvasVar(canvas, "--lk-pad-bg", "#202020"),
      grid: canvasVar(canvas, "--lk-pad-grid", "#333"),
      diagonal: canvasVar(canvas, "--lk-pad-diagonal", "#444"),
      pointFill: canvasVar(canvas, "--lk-point-fill", "#1b1b1b"),
    };
  }

  function channelColor(canvas, channel) {
    if (channel === "RGB") return canvasVar(canvas, "--zui-text", "#ccc");
    return CHANNEL_COLORS[channel] || canvasVar(canvas, "--zui-text", "#ccc");
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
    canvas.tabIndex = 0;
    canvas.setAttribute("aria-label", "Color tint");
    canvas.setAttribute("aria-valuemin", "0");
    canvas.setAttribute("aria-valuemax", "1");
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
      canvas.setAttribute("aria-valuenow", String(dot.radius));
      canvas.setAttribute("aria-valuetext", "Hue " + Math.round(dot.angle) + ", strength " + Math.round(dot.radius * 100) + "%");
      var t = wheelTheme(canvas);
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
      ctx.strokeStyle = t.ring;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(dx, dy, 2, 0, Math.PI * 2);
      ctx.fillStyle = t.core;
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
    function onKey(e) {
      if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home"].includes(e.key)) return;
      e.preventDefault();
      if (e.key === "Home") { dot.angle = 0; dot.radius = 0; }
      else if (e.key === "ArrowLeft" || e.key === "ArrowRight") dot.angle =
        (dot.angle + (e.key === "ArrowLeft" ? -1 : 1) * (e.shiftKey ? 30 : 5) + 360) % 360;
      else dot.radius = C.clamp(dot.radius + (e.key === "ArrowUp" ? 1 : -1) * (e.shiftKey ? .2 : .02), 0, 1);
      draw();
      if (commitFn) commitFn(snapshotDot(), rgbNow());
    }
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onUp);
    canvas.addEventListener("dblclick", onDbl);
    canvas.addEventListener("keydown", onKey);
    var themeView = canvas.ownerDocument && canvas.ownerDocument.defaultView;
    if (themeView) themeView.addEventListener("zoidium:theme-changed", draw);
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
        if (themeView) themeView.removeEventListener("zoidium:theme-changed", draw);
        canvas.removeEventListener("pointerdown", onDown);
        canvas.removeEventListener("pointermove", onMove);
        canvas.removeEventListener("pointerup", onUp);
        canvas.removeEventListener("pointercancel", onUp);
        canvas.removeEventListener("dblclick", onDbl);
        canvas.removeEventListener("keydown", onKey);
        if (wrap.parentElement) wrap.parentElement.removeChild(wrap);
      },
    };
  };

  /* ---------------- CurvesPad ---------------- */

  var CHANNEL_COLORS = { Red: "#e05a5a", Green: "#5ae05a", Blue: "#5a8ae0" };

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
    canvas.tabIndex = 0;
    canvas.setAttribute("role", "group");
    canvas.setAttribute("aria-label", "Color curves");
    canvas.title = "Click adds a point, drag moves it, right-click removes it.";
    wrap.appendChild(canvas);
    container.appendChild(wrap);

    var channels = opts.channels || {};
    var channel = opts.channel || "RGB";
    var inputFn = null;
    var commitFn = null;
    var dragging = -1;
    var selected = 0;
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
      var t = curvesTheme(canvas);
      var line = channelColor(canvas, channel);
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = t.bg;
      ctx.fillRect(0, 0, width, height);
      ctx.strokeStyle = t.grid;
      ctx.lineWidth = 1;
      for (var g = 1; g < 4; g++) {
        var gx = pad + g * (width - 2 * pad) / 4;
        var gy = pad + g * (height - 2 * pad) / 4;
        ctx.beginPath(); ctx.moveTo(gx, pad); ctx.lineTo(gx, height - pad); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(pad, gy); ctx.lineTo(width - pad, gy); ctx.stroke();
      }
      ctx.strokeStyle = t.diagonal;
      ctx.beginPath(); ctx.moveTo(pad, height - pad); ctx.lineTo(width - pad, pad); ctx.stroke();
      var pts = points().slice().sort(function (a, b) { return a.x - b.x; });
      ctx.beginPath();
      pts.forEach(function (p, i) {
        var q = toPx(p);
        if (i === 0) ctx.moveTo(q.x, q.y); else ctx.lineTo(q.x, q.y);
      });
      ctx.strokeStyle = line;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      points().forEach(function (p) {
        var q = toPx(p);
        ctx.beginPath();
        ctx.arc(q.x, q.y, 4, 0, Math.PI * 2);
        ctx.fillStyle = t.pointFill;
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = line;
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
    function onKey(e) {
      if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "Insert", "Delete", "Backspace", "PageUp", "PageDown"].includes(e.key)) return;
      e.preventDefault();
      var pts = points();
      selected = C.clamp(selected, 0, pts.length - 1);
      if (e.key === "Home") selected = 0;
      else if (e.key === "End") selected = pts.length - 1;
      else if (e.key === "PageUp" || e.key === "PageDown") selected = C.clamp(selected + (e.key === "PageUp" ? -1 : 1), 0, pts.length - 1);
      else if (e.key === "Insert") {
        var next = Math.min(pts.length - 1, selected + 1);
        if (next === selected) return;
        pts.splice(next, 0, { x: (pts[selected].x + pts[next].x) / 2, y: (pts[selected].y + pts[next].y) / 2 });
        selected = next; emit(true);
      } else if (e.key === "Delete" || e.key === "Backspace") {
        if (selected > 0 && selected < pts.length - 1) { pts.splice(selected, 1); selected--; emit(true); }
      } else {
        var step = e.shiftKey ? .1 : .01, p = pts[selected];
        if (e.key === "ArrowUp" || e.key === "ArrowDown") p.y = C.clamp(p.y + (e.key === "ArrowUp" ? step : -step), 0, 1);
        else if (selected > 0 && selected < pts.length - 1) p.x = C.clamp(p.x + (e.key === "ArrowRight" ? step : -step), pts[selected - 1].x + .001, pts[selected + 1].x - .001);
        emit(true);
      }
      canvas.setAttribute("aria-label", channel + " curve point " + (selected + 1) + ", X " + pts[selected].x.toFixed(2) + ", Y " + pts[selected].y.toFixed(2));
      draw();
    }

    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onUp);
    canvas.addEventListener("contextmenu", onContext);
    canvas.addEventListener("keydown", onKey);
    var themeView = canvas.ownerDocument && canvas.ownerDocument.defaultView;
    if (themeView) themeView.addEventListener("zoidium:theme-changed", draw);
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
        if (themeView) themeView.removeEventListener("zoidium:theme-changed", draw);
        canvas.removeEventListener("pointerdown", onDown);
        canvas.removeEventListener("pointermove", onMove);
        canvas.removeEventListener("pointerup", onUp);
        canvas.removeEventListener("pointercancel", onUp);
        canvas.removeEventListener("contextmenu", onContext);
        canvas.removeEventListener("keydown", onKey);
        if (wrap.parentElement) wrap.parentElement.removeChild(wrap);
      },
    };
  };

  Looks.widgets = widgets;
})(Looks);
