"use strict";

// Magic Looks — canvas widgets (DOM + canvas only, no CM/PZ dependency so
// they stay probe-renderable). ColorWheel, HSLWheels, CurvesPad, SCurvePad,
// FourWay, WarmCoolPad, AngleDial. Every widget exposes { el, set, get,
// onInput, destroy }.

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

  function fitCanvas(canvas, size) {
    var dpr = (typeof window !== "undefined" && window.devicePixelRatio) || 1;
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    canvas.style.width = size + "px";
    canvas.style.height = size + "px";
    var ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return ctx;
  }

  function tween(duration, step, done) {
    var start = (typeof performance !== "undefined" ? performance.now() : Date.now());
    function frame(now) {
      var t = Math.min(1, (now - start) / duration);
      var e = 1 - Math.pow(1 - t, 3);
      step(e);
      if (t < 1) requestAnimationFrame(frame);
      else if (done) done();
    }
    requestAnimationFrame(frame);
  }

  /* ---------------- shared hue disc ---------------- */

  function paintHueDisc(ctx, cx, cy, rOuter, rInner) {
    // Red at the top, hue increasing clockwise: canvas position for hue h
    // is north + h, matching the dot/drag mapping used by every widget.
    var steps = 144;
    for (var i = 0; i < steps; i++) {
      var a0 = -Math.PI / 2 + (i / steps) * Math.PI * 2;
      var a1 = -Math.PI / 2 + ((i + 1) / steps) * Math.PI * 2;
      var rgb = C.hsvToRgb((i / steps) * 360, 1, 1);
      ctx.beginPath();
      ctx.arc(cx, cy, rOuter, a0, a1 + 0.002);
      ctx.arc(cx, cy, rInner, a1 + 0.002, a0, true);
      ctx.closePath();
      ctx.fillStyle = "rgb(" + Math.round(rgb[0] * 255) + "," + Math.round(rgb[1] * 255) + "," + Math.round(rgb[2] * 255) + ")";
      ctx.fill();
    }
    // Dim toward the middle like the reference wheels.
    var g = ctx.createRadialGradient(cx, cy, rInner * 0.1, cx, cy, rInner);
    g.addColorStop(0, "rgba(0,0,0,0.55)");
    g.addColorStop(0.75, "rgba(0,0,0,0.12)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.beginPath();
    ctx.arc(cx, cy, rInner, 0, Math.PI * 2);
    ctx.fillStyle = g;
    ctx.fill();
  }

  function paintLumaRing(ctx, cx, cy, rOuter, rInner) {
    var steps = 96;
    for (var i = 0; i < steps; i++) {
      var f = i / (steps - 1);
      var shade = Math.round(30 + f * 200);
      var a0 = (i / steps) * Math.PI * 2 - Math.PI / 2;
      var a1 = ((i + 1) / steps) * Math.PI * 2 - Math.PI / 2;
      ctx.beginPath();
      ctx.arc(cx, cy, rOuter, a0, a1 + 0.002);
      ctx.arc(cx, cy, rInner, a1 + 0.002, a0, true);
      ctx.closePath();
      ctx.fillStyle = "rgb(" + shade + "," + shade + "," + shade + ")";
      ctx.fill();
    }
  }

  /* ---------------- ColorWheel ---------------- */

  // The shared palette design: hue disc, luminance ring, direction arc,
  // ticks and a draggable center dot. `initial` is { angle, radius }.
  widgets.ColorWheel = function (container, opts) {
    opts = opts || {};
    var size = opts.size || 190;
    var wrap = make("div", "lk-wheel-wrap");
    var canvas = make("canvas", "lk-wheel");
    canvas.setAttribute("role", "slider");
    wrap.appendChild(canvas);
    container.appendChild(wrap);

    var dot = { angle: 0, radius: 0 };
    var shown = { angle: 0, radius: 0 };
    var handler = null;
    var dragging = false;
    var introDone = false;

    if (opts.initial) {
      dot.angle = opts.initial.angle || 0;
      dot.radius = opts.initial.radius || 0;
    }

    function emit() {
      if (handler) handler({ angle: dot.angle, radius: dot.radius }, C.wheelTint(dot.angle, dot.radius));
    }

    function draw() {
      var ctx = fitCanvas(canvas, size);
      var cx = size / 2, cy = size / 2;
      var rOut = size / 2 - 4;
      var rRingIn = rOut - 16;
      var rDisc = rRingIn - 4;
      paintLumaRing(ctx, cx, cy, rOut, rRingIn);
      paintHueDisc(ctx, cx, cy, rDisc, 0);
      // Tick marks on the ring.
      ctx.strokeStyle = "rgba(0,0,0,0.6)";      ctx.lineWidth = 2;
      for (var t = 0; t < 12; t++) {
        var a = (t / 12) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * rRingIn, cy + Math.sin(a) * rRingIn);
        ctx.lineTo(cx + Math.cos(a) * (rRingIn + 5), cy + Math.sin(a) * (rRingIn + 5));
        ctx.stroke();
      }
      // Direction arc: top -> dot angle, alpha follows radius.
      if (shown.radius > 0.02) {
        var rad = (shown.angle - 90) * Math.PI / 180;
        var top = -Math.PI / 2;
        ctx.beginPath();
        ctx.arc(cx, cy, rDisc + 8, Math.min(top, rad), Math.max(top, rad));
        var tint = C.wheelTint(shown.angle, 1);
        ctx.strokeStyle = "rgba(" + Math.round(tint[0] * 255) + "," + Math.round(tint[1] * 255) + "," + Math.round(tint[2] * 255) + "," + (0.35 + 0.6 * shown.radius) + ")";
        ctx.lineWidth = 7;
        ctx.stroke();
      }
      // Dot.
      var pr = shown.radius * (rDisc - 10);
      var pa = (shown.angle - 90) * Math.PI / 180;
      var dx = cx + Math.cos(pa) * pr;
      var dy = cy + Math.sin(pa) * pr;
      var tint2 = C.wheelTint(shown.angle, Math.max(shown.radius, 0.001));
      ctx.beginPath();
      ctx.arc(dx, dy, 7, 0, Math.PI * 2);
      ctx.fillStyle = "rgb(" + Math.round(tint2[0] * 255) + "," + Math.round(tint2[1] * 255) + "," + Math.round(tint2[2] * 255) + ")";
      ctx.fill();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = "#fff";
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(dx, dy, 2.4, 0, Math.PI * 2);
      ctx.fillStyle = "#111";
      ctx.fill();
    }

    function sync(animate) {
      var from = { angle: shown.angle, radius: shown.radius };
      var to = { angle: dot.angle, radius: dot.radius };
      if (!animate) {
        shown.angle = to.angle;
        shown.radius = to.radius;
        draw();
        return;
      }
      tween(220, function (e) {
        shown.angle = from.angle + (to.angle - from.angle) * e;
        shown.radius = from.radius + (to.radius - from.radius) * e;
        draw();
      });
    }

    function setFromEvent(e) {
      var rect = canvas.getBoundingClientRect();
      var cx = rect.left + rect.width / 2;
      var cy = rect.top + rect.height / 2;
      var dx = (e.clientX - cx) / (rect.width / 2);
      var dy = (e.clientY - cy) / (rect.height / 2);
      var r = Math.min(1, Math.sqrt(dx * dx + dy * dy));
      var a = (Math.atan2(dy, dx) * 180 / Math.PI + 90 + 360) % 360;
      dot.angle = a;
      dot.radius = r;
      shown.angle = a;
      shown.radius = r;
      draw();
      emit();
    }

    function onDown(e) {
      dragging = true;
      try { canvas.setPointerCapture(e.pointerId); } catch (_err) {}
      setFromEvent(e);
      e.preventDefault();
    }
    function onMove(e) {
      if (dragging) setFromEvent(e);
    }
    function onUp() {
      dragging = false;
    }
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onUp);

    // Intro draw-in: radius sweeps 0 -> target on first paint.
    var target = dot.radius;
    shown.radius = 0;
    shown.angle = dot.angle;
    draw();
    tween(450, function (e) {
      shown.radius = target * e;
      draw();
    }, function () { introDone = true; });

    return {
      el: wrap,
      onInput: function (fn) { handler = fn; },
      set: function (d, animate) {
        dot.angle = d.angle || 0;
        dot.radius = C.clamp(d.radius || 0, 0, 1);
        sync(introDone && animate !== false);
      },
      get: function () { return { angle: dot.angle, radius: dot.radius }; },
      repaint: draw,
      destroy: function () {
        canvas.removeEventListener("pointerdown", onDown);
        canvas.removeEventListener("pointermove", onMove);
        canvas.removeEventListener("pointerup", onUp);
        canvas.removeEventListener("pointercancel", onUp);
        if (wrap.parentElement) wrap.parentElement.removeChild(wrap);
      },
    };
  };

  /* ---------------- HSL wheels + table ---------------- */

  widgets.HSLWheels = function (container, opts) {
    opts = opts || {};
    var hues = Looks.tools.HSL_HUES;
    var values = opts.values || hues.map(function () { return { sat: 0, light: 0 }; });
    var handler = null;
    var wheels = [];

    function emit() {
      if (handler) handler(values.map(function (v) { return { sat: v.sat, light: v.light }; }));
    }

    function buildWheel(kind) {
      var size = 190;
      var canvas = make("canvas", "lk-wheel");
      container.appendChild(canvas);
      var wheel = { canvas: canvas, dragging: -1 };

      function draw() {
        var ctx = fitCanvas(canvas, size);
        var cx = size / 2, cy = size / 2;
        var rOut = size / 2 - 4;
        paintHueDisc(ctx, cx, cy, rOut, 0);
        ctx.lineWidth = 2;
        ctx.strokeStyle = "#000";
        ctx.beginPath();
        ctx.arc(cx, cy, rOut, 0, Math.PI * 2);
        ctx.stroke();
        hues.forEach(function (h, i) {
          var v = kind === "sat" ? values[i].sat : values[i].light;
          var rad = C.clamp(0.5 + v / 2, 0.06, 1);
          var a = (h.hue - 90) * Math.PI / 180;
          var ax = cx + Math.cos(a) * rOut;
          var ay = cy + Math.sin(a) * rOut;
          var dx = cx + Math.cos(a) * rOut * rad;
          var dy = cy + Math.sin(a) * rOut * rad;
          // Dashed spoke anchor -> dot.
          ctx.save();
          ctx.setLineDash([4, 4]);
          ctx.strokeStyle = "rgba(0,0,0,0.55)";
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(ax, ay);
          ctx.lineTo(dx, dy);
          ctx.stroke();
          ctx.restore();
          var rgb = C.hsvToRgb(h.hue, 1, 1);
          ctx.beginPath();
          ctx.arc(dx, dy, 7, 0, Math.PI * 2);
          ctx.fillStyle = "rgb(" + Math.round(rgb[0] * 255) + "," + Math.round(rgb[1] * 255) + "," + Math.round(rgb[2] * 255) + ")";
          ctx.fill();
          ctx.lineWidth = 2;
          ctx.strokeStyle = "#111";
          ctx.stroke();
        });
      }

      function setFromEvent(e) {
        var rect = canvas.getBoundingClientRect();
        var cx = rect.left + rect.width / 2;
        var cy = rect.top + rect.height / 2;
        var dx = (e.clientX - cx) / (rect.width / 2);
        var dy = (e.clientY - cy) / (rect.height / 2);
        var ang = (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360;
        var best = 0, bestD = 1e9;
        hues.forEach(function (h, i) {
          var d = Math.abs(((ang - h.hue + 540) % 360) - 180);
          if (d < bestD) { bestD = d; best = i; }
        });
        if (wheel.dragging === -1) {
          if (bestD > 30) return;
          wheel.dragging = best;
        }
        var i = wheel.dragging;
        var r = C.clamp(Math.sqrt(dx * dx + dy * dy), 0.06, 1);
        var off = C.clamp((r - 0.5) * 2, -1, 1);
        if (kind === "sat") values[i].sat = Math.round(off * 1000) / 1000;
        else values[i].light = Math.round(off * 1000) / 1000;
        draw();
        paintTable();
        emit();
      }
      function onDown(e) {
        wheel.dragging = -1;
        setFromEvent(e);
        try { canvas.setPointerCapture(e.pointerId); } catch (_err) {}
        e.preventDefault();
      }
      function onMove(e) {
        if (wheel.dragging !== -1) setFromEvent(e);
      }
      function onUp() { wheel.dragging = -1; }
      canvas.addEventListener("pointerdown", onDown);
      canvas.addEventListener("pointermove", onMove);
      canvas.addEventListener("pointerup", onUp);
      canvas.addEventListener("pointercancel", onUp);
      wheel.draw = draw;
      wheel.dispose = function () {
        canvas.removeEventListener("pointerdown", onDown);
        canvas.removeEventListener("pointermove", onMove);
        canvas.removeEventListener("pointerup", onUp);
        canvas.removeEventListener("pointercancel", onUp);
      };
      wheels.push(wheel);
      draw();
      return wheel;
    }

    var table = null;
    function paintTable() {
      if (!table) return;
      table.innerHTML = "";
      var head = make("tr", "lk-hsl-head");
      head.appendChild(make("th", "", ""));
      head.appendChild(make("th", "", "Hue"));
      head.appendChild(make("th", "", "Saturation"));
      head.appendChild(make("th", "", "Lightness"));
      table.appendChild(head);
      hues.forEach(function (h, i) {
        var tr = make("tr", "lk-hsl-row");
        var dot = make("td", "lk-hsl-dot");
        var rgb = C.hsvToRgb(h.hue, 1, 1);
        dot.innerHTML = '<span style="background:rgb(' + Math.round(rgb[0] * 255) + "," + Math.round(rgb[1] * 255) + "," + Math.round(rgb[2] * 255) + ')"></span>';
        tr.appendChild(dot);
        tr.appendChild(make("td", "", "0%"));
        tr.appendChild(make("td", "", C.fmtNum(values[i].sat, 1, { percent: true, signed: true })));
        tr.appendChild(make("td", "", C.fmtNum(values[i].light, 1, { percent: true, signed: true })));
        table.appendChild(tr);
      });
    }

    buildWheel("sat");
    buildWheel("light");
    table = make("table", "lk-hsl-table");
    container.appendChild(table);
    paintTable();

    return {
      el: container,
      onInput: function (fn) { handler = fn; },
      set: function (vals) {
        vals.forEach(function (v, i) {
          if (values[i]) {
            values[i].sat = C.clamp(v.sat || 0, -1, 1);
            values[i].light = C.clamp(v.light || 0, -1, 1);
          }
        });
        wheels.forEach(function (w) { w.draw(); });
        paintTable();
      },
      get: function () {
        return values.map(function (v) { return { sat: v.sat, light: v.light }; });
      },
      repaint: function () {
        wheels.forEach(function (w) { w.draw(); });
      },
      destroy: function () {
        wheels.forEach(function (w) { w.dispose(); });
        wheels = [];
      },
    };
  };

  /* ---------------- Curves ---------------- */

  widgets.CurvesPad = function (container, opts) {
    opts = opts || {};
    var W = 300, H = 220;
    var bar = make("div", "lk-curves-bar");
    var canvas = make("canvas", "lk-curves");
    var readout = make("div", "lk-curves-read", "0.000\u2003\u20030.000");
    container.appendChild(bar);
    container.appendChild(canvas);
    container.appendChild(readout);

    var channels = ["RGB", "Red", "Green", "Blue"];
    var state = opts.state || null;
    var handler = null;
    var dragging = -1;

    function cur() {
      return state.channels[state.channel];
    }

    channels.forEach(function (ch) {
      var b = make("button", "lk-curves-ch" + (state.channel === ch ? " active" : ""), ch);
      b.onclick = function () {
        state.channel = ch;
        dragging = -1;
        Array.prototype.forEach.call(bar.children, function (x) {
          x.classList.toggle("active", x.textContent === ch);
        });
        draw();
        if (handler) handler(state);
      };
      bar.appendChild(b);
    });

    function toPx(p) {
      return { x: 14 + p.x * (W - 28), y: 10 + (1 - p.y) * (H - 20) };
    }
    function toVal(px) {
      return {
        x: C.clamp((px.x - 14) / (W - 28), 0, 1),
        y: C.clamp(1 - (px.y - 10) / (H - 20), 0, 1),
      };
    }

    function draw() {
      var ctx = fitCanvas(canvas, W, H);
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = "rgba(255,255,255,0.14)";
      ctx.lineWidth = 1;
      for (var i = 0; i <= 4; i++) {
        var gx = 14 + (i / 4) * (W - 28);
        var gy = 10 + (i / 4) * (H - 20);
        ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, H); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(W, gy); ctx.stroke();
      }
      var pts = cur().slice().sort(function (a, b) { return a.x - b.x; });
      var stroke = state.channel === "Red" ? "#e05a5a" : state.channel === "Green" ? "#5ae05a" : state.channel === "Blue" ? "#5a8ae0" : "#f2f2f2";
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 2;
      ctx.beginPath();
      pts.forEach(function (p, i) {
        var q = toPx(p);
        if (i === 0) ctx.moveTo(q.x, q.y);
        else {
          var prev = toPx(pts[i - 1]);
          ctx.bezierCurveTo(prev.x, prev.y, q.x, q.y, q.x, q.y);
          ctx.lineTo(q.x, q.y);
        }
      });
      ctx.stroke();
      pts.forEach(function (p, i) {
        var q = toPx(p);
        ctx.beginPath();
        ctx.arc(q.x, q.y, i === dragging ? 7 : 5.5, 0, Math.PI * 2);
        ctx.fillStyle = i === dragging ? "#f7941d" : "#0c0d10";
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = "#fff";
        ctx.stroke();
      });
      var sel = pts[Math.min(dragging < 0 ? pts.length - 1 : dragging, pts.length - 1)];
      if (sel) readout.textContent = sel.x.toFixed(3) + "\u2003\u2003" + sel.y.toFixed(3);
    }

    function nearest(e) {
      var rect = canvas.getBoundingClientRect();
      var mx = (e.clientX - rect.left) * (W / rect.width);
      var my = (e.clientY - rect.top) * (H / rect.height);
      var pts = cur();
      var best = -1, bestD = 14;
      pts.forEach(function (p, i) {
        var q = toPx(p);
        var d = Math.hypot(q.x - mx, q.y - my);
        if (d < bestD) { bestD = d; best = i; }
      });
      return { index: best, x: mx, y: my };
    }

    function onDown(e) {
      var hit = nearest(e);
      if (hit.index >= 0) {
        dragging = hit.index;
      } else {
        var v = toVal(hit);
        cur().push({ x: Math.round(v.x * 1000) / 1000, y: Math.round(v.y * 1000) / 1000 });
        dragging = cur().length - 1;
      }
      try { canvas.setPointerCapture(e.pointerId); } catch (_err) {}
      draw();
      e.preventDefault();
    }
    function onMove(e) {
      if (dragging < 0) return;
      var rect = canvas.getBoundingClientRect();
      var v = toVal({ x: (e.clientX - rect.left) * (W / rect.width), y: (e.clientY - rect.top) * (H / rect.height) });
      cur()[dragging] = { x: Math.round(v.x * 1000) / 1000, y: Math.round(v.y * 1000) / 1000 };
      draw();
      if (handler) handler(state);
    }
    function onUp() { dragging = -1; draw(); }
    function onDbl(e) {
      var hit = nearest(e);
      if (hit.index >= 0 && cur().length > 2) {
        cur().splice(hit.index, 1);
        dragging = -1;
        draw();
        if (handler) handler(state);
      }
      e.preventDefault();
    }
    function onCtx(e) {
      var hit = nearest(e);
      if (hit.index >= 0 && cur().length > 2) {
        cur().splice(hit.index, 1);
        draw();
        if (handler) handler(state);
      }
      e.preventDefault();
    }
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onUp);
    canvas.addEventListener("dblclick", onDbl);
    canvas.addEventListener("contextmenu", onCtx);
    draw();

    return {
      el: container,
      onInput: function (fn) { handler = fn; },
      set: function (s) {
        state = s;
        Array.prototype.forEach.call(bar.children, function (x) {
          x.classList.toggle("active", x.textContent === state.channel);
        });
        draw();
      },
      get: function () { return state; },
      repaint: draw,
      destroy: function () {
        canvas.removeEventListener("pointerdown", onDown);
        canvas.removeEventListener("pointermove", onMove);
        canvas.removeEventListener("pointerup", onUp);
        canvas.removeEventListener("pointercancel", onUp);
        canvas.removeEventListener("dblclick", onDbl);
        canvas.removeEventListener("contextmenu", onCtx);
      },
    };
  };

  /* ---------------- S-curve ---------------- */

  widgets.SCurvePad = function (container, opts) {
    opts = opts || {};
    var W = 300, H = 260;
    var canvas = make("canvas", "lk-scurve");
    container.appendChild(canvas);
    var st = opts.state;
    var handler = null;
    var dragging = null; // 'p0' | 'c1' | 'c2' | 'p3'

    function toPx(p) {
      return { x: 14 + p.x * (W - 28), y: 10 + (1 - p.y) * (H - 20) };
    }
    function toVal(px) {
      return {
        x: C.clamp((px.x - 14) / (W - 28), 0, 1),
        y: C.clamp(1 - (px.y - 10) / (H - 20), 0, 1),
      };
    }

    function draw() {
      var ctx = fitCanvas(canvas, W, H);
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = "rgba(255,255,255,0.1)";
      ctx.lineWidth = 1;
      ctx.strokeRect(14.5, 10.5, W - 28, H - 20);
      ctx.beginPath();
      var a = toPx(st.p0), b = toPx(st.c1), c = toPx(st.c2), d = toPx(st.p3);
      ctx.moveTo(a.x, a.y);
      ctx.bezierCurveTo(b.x, b.y, c.x, c.y, d.x, d.y);
      ctx.strokeStyle = "#f2f2f2";
      ctx.lineWidth = 2.5;
      ctx.stroke();
      // Handles + cross anchor at midpoint.
      var mid = C.cubic(st.p0, st.c1, st.c2, st.p3, 0.5);
      var m = toPx(mid);
      ctx.strokeStyle = "#f7941d";
      ctx.lineWidth = 2;
      [[a, b], [d, c]].forEach(function (pair) {
        ctx.beginPath();
        ctx.moveTo(pair[0].x, pair[0].y);
        ctx.lineTo(pair[1].x, pair[1].y);
        ctx.stroke();
      });
      [b, c].forEach(function (q) {
        ctx.beginPath();
        ctx.arc(q.x, q.y, 6, 0, Math.PI * 2);
        ctx.fillStyle = "#f7941d";
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = "#111";
        ctx.stroke();
      });
      [a, d].forEach(function (q) {
        ctx.beginPath();
        ctx.arc(q.x, q.y, 6, 0, Math.PI * 2);
        ctx.fillStyle = "#f7941d";
        ctx.fill();
      });
      ctx.save();
      ctx.translate(m.x, m.y);
      ctx.rotate(Math.PI / 4);
      ctx.strokeStyle = "#f7941d";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(-11, 0); ctx.lineTo(11, 0);
      ctx.moveTo(0, -11); ctx.lineTo(0, 11);
      ctx.stroke();
      ctx.restore();
    }

    function hit(e) {
      var rect = canvas.getBoundingClientRect();
      var mx = (e.clientX - rect.left) * (W / rect.width);
      var my = (e.clientY - rect.top) * (H / rect.height);
      var best = null, bestD = 16;
      ["p0", "c1", "c2", "p3"].forEach(function (k) {
        var q = toPx(st[k]);
        var d = Math.hypot(q.x - mx, q.y - my);
        if (d < bestD) { bestD = d; best = k; }
      });
      return best;
    }
    function onDown(e) {
      dragging = hit(e);
      try { canvas.setPointerCapture(e.pointerId); } catch (_err) {}
      e.preventDefault();
    }
    function onMove(e) {
      if (!dragging) return;
      var rect = canvas.getBoundingClientRect();
      var v = toVal({ x: (e.clientX - rect.left) * (W / rect.width), y: (e.clientY - rect.top) * (H / rect.height) });
      st[dragging] = { x: Math.round(v.x * 1000) / 1000, y: Math.round(v.y * 1000) / 1000 };
      // Mirror the opposite handle for a smooth S, like the reference.
      if (dragging === "c1") st.c2 = { x: C.clamp(1 - st.c1.x, 0, 1), y: C.clamp(1 - st.c1.y, 0, 1) };
      if (dragging === "c2") st.c1 = { x: C.clamp(1 - st.c2.x, 0, 1), y: C.clamp(1 - st.c2.y, 0, 1) };
      draw();
      if (handler) handler(st);
    }
    function onUp() { dragging = null; }
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onUp);
    draw();

    return {
      el: container,
      onInput: function (fn) { handler = fn; },
      set: function (s) { st = s; draw(); },
      get: function () { return st; },
      repaint: draw,
      destroy: function () {
        canvas.removeEventListener("pointerdown", onDown);
        canvas.removeEventListener("pointermove", onMove);
        canvas.removeEventListener("pointerup", onUp);
        canvas.removeEventListener("pointercancel", onUp);
      },
    };
  };

  /* ---------------- Warm/Cool pad ---------------- */

  widgets.WarmCoolPad = function (container, opts) {
    opts = opts || {};
    var S = 190;
    var canvas = make("canvas", "lk-pad");
    container.appendChild(canvas);
    var pos = { x: opts.x || 0, y: opts.y || 0 }; // x: warm(-)/cool? see mapping
    var handler = null;
    var dragging = false;

    // Screenshot mapping: Warm/Cool -0.325 with dot left-of-center in the
    // warm zone; Tint +0.083 slightly magenta (up). x in [-1,1] maps to the
    // warmCool value, y to tint.
    function draw() {
      var ctx = fitCanvas(canvas, S, S);
      var img = ctx.createImageData(S, S);
      for (var j = 0; j < S; j++) {
        for (var i = 0; i < S; i++) {
          var fx = i / (S - 1); // 0 warm(left/red-orange) -> 1 cool(right/blue)
          var fy = j / (S - 1); // 0 magenta(top) -> 1 green(bottom)
          var warm = C.hsvToRgb(18, 0.95, 1);
          var cool = C.hsvToRgb(215, 0.85, 1);
          var r = warm[0] + (cool[0] - warm[0]) * fx;
          var g = warm[1] + (cool[1] - warm[1]) * fx;
          var b = warm[2] + (cool[2] - warm[2]) * fx;
          // Green/magenta cast by row.
          var cast = (0.5 - fy) * 0.55;
          g += cast * 0.5;
          r += -cast * 0.28;
          b += -cast * 0.28;
          // Neutralize toward the middle cross.
          var dxn = Math.abs(fx - 0.5) * 2;
          var dyn = Math.abs(fy - 0.5) * 2;
          var neutral = Math.max(0, 1 - Math.max(dxn, dyn) * 1.6);
          r = r + (0.12 - r) * neutral;
          g = g + (0.12 - g) * neutral;
          b = b + (0.12 - b) * neutral;
          var k = (j * S + i) * 4;
          img.data[k] = C.clamp(r, 0, 1) * 255;
          img.data[k + 1] = C.clamp(g, 0, 1) * 255;
          img.data[k + 2] = C.clamp(b, 0, 1) * 255;
          img.data[k + 3] = 255;
        }
      }
      ctx.putImageData(img, 0, 0);
      var px = (pos.x * 0.5 + 0.5) * S;
      var py = (0.5 - pos.y * 0.5) * S;
      ctx.beginPath();
      ctx.arc(px, py, 7, 0, Math.PI * 2);
      ctx.lineWidth = 2;
      ctx.strokeStyle = "#111";
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(px, py, 5, 0, Math.PI * 2);
      ctx.lineWidth = 1.6;
      ctx.strokeStyle = "#fff";
      ctx.stroke();
    }

    function setFromEvent(e) {
      var rect = canvas.getBoundingClientRect();
      pos.x = C.clamp(((e.clientX - rect.left) / rect.width) * 2 - 1, -1, 1);
      pos.y = C.clamp((0.5 - (e.clientY - rect.top) / rect.height) * 2, -1, 1);
      pos.x = Math.round(pos.x * 1000) / 1000;
      pos.y = Math.round(pos.y * 1000) / 1000;
      draw();
      if (handler) handler({ x: pos.x, y: pos.y });
    }
    function onDown(e) {
      dragging = true;
      try { canvas.setPointerCapture(e.pointerId); } catch (_err) {}
      setFromEvent(e);
      e.preventDefault();
    }
    function onMove(e) { if (dragging) setFromEvent(e); }
    function onUp() { dragging = false; }
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onUp);
    draw();

    return {
      el: canvas,
      onInput: function (fn) { handler = fn; },
      set: function (p) {
        pos.x = C.clamp(p.x || 0, -1, 1);
        pos.y = C.clamp(p.y || 0, -1, 1);
        draw();
      },
      get: function () { return { x: pos.x, y: pos.y }; },
      repaint: draw,
      destroy: function () {
        canvas.removeEventListener("pointerdown", onDown);
        canvas.removeEventListener("pointermove", onMove);
        canvas.removeEventListener("pointerup", onUp);
        canvas.removeEventListener("pointercancel", onUp);
      },
    };
  };

  /* ---------------- Angle dial ---------------- */

  widgets.AngleDial = function (container, opts) {
    opts = opts || {};
    var S = 110;
    var wrap = make("div", "lk-dial-wrap");
    var canvas = make("canvas", "lk-dial");
    var read = make("div", "lk-dial-read", "+45.00");
    wrap.appendChild(canvas);
    wrap.appendChild(read);
    container.appendChild(wrap);
    var angle = opts.angle === undefined ? 45 : opts.angle;
    var handler = null;
    var dragging = false;

    function draw() {
      var ctx = fitCanvas(canvas, S, S);
      var cx = S / 2, cy = S / 2, r = S / 2 - 6;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(255,255,255,0.55)";
      ctx.lineWidth = 1.5;
      ctx.stroke();
      var a = (angle - 90) * Math.PI / 180;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(a) * (r - 8), cy + Math.sin(a) * (r - 8));
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 2.5;
      ctx.stroke();
      read.textContent = C.fmtNum(angle, 2, { signed: true });
    }

    function setFromEvent(e) {
      var rect = canvas.getBoundingClientRect();
      var dx = (e.clientX - (rect.left + rect.width / 2)) / (rect.width / 2);
      var dy = (e.clientY - (rect.top + rect.height / 2)) / (rect.height / 2);
      var a = Math.atan2(dy, dx) * 180 / Math.PI + 90;
      while (a > 180) a -= 360;
      while (a < -180) a += 360;
      angle = Math.round(a * 100) / 100;
      draw();
      if (handler) handler(angle);
    }
    function onDown(e) {
      dragging = true;
      try { canvas.setPointerCapture(e.pointerId); } catch (_err) {}
      setFromEvent(e);
      e.preventDefault();
    }
    function onMove(e) { if (dragging) setFromEvent(e); }
    function onUp() { dragging = false; }
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onUp);
    draw();

    return {
      el: wrap,
      onInput: function (fn) { handler = fn; },
      set: function (a) { angle = a; draw(); },
      get: function () { return angle; },
      repaint: draw,
      destroy: function () {
        canvas.removeEventListener("pointerdown", onDown);
        canvas.removeEventListener("pointermove", onMove);
        canvas.removeEventListener("pointerup", onUp);
        canvas.removeEventListener("pointercancel", onUp);
      },
    };
  };

  /* ---------------- Ranges graph (4-way) ---------------- */

  widgets.RangesGraph = function (container, opts) {
    opts = opts || {};
    var W = 340, H = 130;
    var canvas = make("canvas", "lk-ranges");
    container.appendChild(canvas);
    function draw() {
      var ctx = fitCanvas(canvas, W, H);
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, W, H);
      var bands = [
        { mu: 0.22, sig: 0.16, fill: "rgba(120,120,120,0.5)" },
        { mu: 0.5, sig: 0.17, fill: "rgba(150,150,150,0.45)" },
        { mu: 0.78, sig: 0.16, fill: "rgba(180,180,180,0.5)" },
      ];
      bands.forEach(function (b) {
        ctx.beginPath();
        ctx.moveTo(0, H);
        for (var i = 0; i <= 80; i++) {
          var x = (i / 80) * W;
          var y = H - C.gauss(i / 80, b.mu, b.sig) * (H - 8);
          ctx.lineTo(x, y);
        }
        ctx.lineTo(W, H);
        ctx.closePath();
        ctx.fillStyle = b.fill;
        ctx.fill();
      });
      ctx.strokeStyle = "rgba(255,255,255,0.25)";
      ctx.lineWidth = 1;
      ctx.strokeRect(0.5, 0.5, W - 1, H - 1);
    }
    draw();
    return {
      el: canvas,
      repaint: draw,
      destroy: function () {},
    };
  };

  /* ---------------- chain-strip thumbnails ---------------- */

  // Procedural MBL-style tool thumbnails for the chain strip. spec is
  // { kind, ...kindParams }. Pure canvas: usable from the setup and probes.
  // Kinds: input, wheel, dots3, letter, radial, hsplit, thirds, splitdisc,
  // bars3, smini, diagonal, contrast, sbezier, cube, grad2d, diamond, dot,
  // softdot, star, hstreak, circle, grid, rgblines.
  widgets.paintChainThumb = function (canvas, spec) {
    var S = 72;
    var dpr = (typeof window !== "undefined" && window.devicePixelRatio) || 1;
    canvas.width = S * dpr;
    canvas.height = S * dpr;
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    var ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    var kind = spec.kind || "dot";
    var cx = S / 2, cy = S / 2;

    function bg() {
      ctx.fillStyle = "#14161b";
      ctx.fillRect(0, 0, S, S);
    }
    function hueDisc(x, y, r) {
      var steps = 72;
      for (var i = 0; i < steps; i++) {
        var a0 = -Math.PI / 2 + (i / steps) * Math.PI * 2;
        var a1 = -Math.PI / 2 + ((i + 1) / steps) * Math.PI * 2;
        var rgb = C.hsvToRgb((i / steps) * 360, 0.95, 0.95);
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.arc(x, y, r, a0, a1 + 0.01);
        ctx.closePath();
        ctx.fillStyle = "rgb(" + Math.round(rgb[0] * 255) + "," + Math.round(rgb[1] * 255) + "," + Math.round(rgb[2] * 255) + ")";
        ctx.fill();
      }
    }
    function miniCurve(pts, color, grid) {
      if (grid !== false) {
        ctx.strokeStyle = "rgba(255,255,255,0.12)";
        ctx.lineWidth = 1;
        for (var g = 1; g < 4; g++) {
          ctx.beginPath(); ctx.moveTo((S / 4) * g, 6); ctx.lineTo((S / 4) * g, S - 6); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(6, (S / 4) * g); ctx.lineTo(S - 6, (S / 4) * g); ctx.stroke();
        }
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      pts.forEach(function (p, i) {
        var x = 8 + p[0] * (S - 16);
        var y = S - 8 - p[1] * (S - 16);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    }

    bg();
    if (kind === "input") {
      miniCurve([[0, 0], [1, 1]], "#e05a5a");
      miniCurve([[0, 0.08], [1, 0.92]], "#5ae05a", false);
      miniCurve([[0, 0.16], [1, 0.84]], "#5a8ae0", false);
    } else if (kind === "wheel") {
      hueDisc(cx, cy, 24);
      ctx.beginPath();
      ctx.arc(cx, cy, 24, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(0,0,0,0.7)";
      ctx.lineWidth = 2;
      ctx.stroke();
    } else if (kind === "dots3") {
      var cols = ["#8a8f96", "#a8adb4", "#c9cdd4"];
      for (var d = 0; d < 3; d++) {
        var dx = 18 + d * 18;
        ctx.beginPath();
        ctx.arc(dx, cy, 10 - d * 1.5, 0, Math.PI * 2);
        ctx.fillStyle = cols[d];
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = "#000";
        ctx.stroke();
      }
    } else if (kind === "letter") {
      ctx.fillStyle = spec.color || "#c9cdd4";
      ctx.font = "700 40px Georgia,serif";
      ctx.fontStyle = "italic";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(spec.text || "C", cx, cy + 2);
    } else if (kind === "radial") {
      var g = ctx.createRadialGradient(cx, cy, 2, cx, cy, 28);
      g.addColorStop(0, "rgba(0,0,0,0)");
      g.addColorStop(1, "rgba(0,0,0,0.9)");
      ctx.fillStyle = "#3a3d44";
      ctx.fillRect(10, 10, S - 20, S - 20);
      ctx.fillStyle = g;
      ctx.fillRect(10, 10, S - 20, S - 20);
    } else if (kind === "hsplit") {
      var lg = ctx.createLinearGradient(0, 0, S, 0);
      lg.addColorStop(0, "#e0e4e8");
      lg.addColorStop(0.5, "#e0e4e8");
      lg.addColorStop(0.5, "#3a3d44");
      lg.addColorStop(1, "#3a3d44");
      ctx.fillStyle = lg;
      ctx.fillRect(10, 14, S - 20, S - 28);
    } else if (kind === "thirds") {
      var thirds = ["#a03a3a", "#3aa03a", "#3a5aa0"];
      thirds.forEach(function (c, i) {
        ctx.fillStyle = c;
        ctx.fillRect(10 + (i * (S - 20)) / 3, 14, (S - 20) / 3, S - 28);
      });
    } else if (kind === "splitdisc") {
      hueDisc(cx, cy, 24);
      ctx.fillStyle = "rgba(0,0,0,0.45)";
      ctx.fillRect(cx, 12, 24, 48);
      ctx.beginPath();
      ctx.arc(cx, cy, 24, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(0,0,0,0.7)";
      ctx.lineWidth = 2;
      ctx.stroke();
    } else if (kind === "bars3") {
      var bars = ["#7a4a6a", "#4a6a8a", "#6a7a4a"];
      bars.forEach(function (c, i) {
        var grd = ctx.createLinearGradient(0, S - 8, 0, 10);
        grd.addColorStop(0, c);
        grd.addColorStop(1, "#14161b");
        ctx.fillStyle = grd;
        ctx.fillRect(12 + i * 18, 10, 12, S - 20);
      });
    } else if (kind === "smini") {
      miniCurve([[0, 0.08], [0.35, 0.3], [0.65, 0.7], [1, 0.92]], "#e8e9eb");
    } else if (kind === "diagonal") {
      miniCurve([[0, 0], [1, 1]], "#e8e9eb");
    } else if (kind === "contrast") {
      miniCurve([[0, 0], [0.42, 0.3], [0.58, 0.7], [1, 1]], "#e8e9eb");
    } else if (kind === "sbezier") {
      miniCurve([[0, 0], [0.35, 0.28], [0.65, 0.72], [1, 1]], "#f0a83d");
    } else if (kind === "cube") {
      ctx.strokeStyle = "#c9cdd4";
      ctx.lineWidth = 2;
      ctx.strokeRect(20, 20, 24, 24);
      ctx.beginPath();
      ctx.moveTo(20, 20); ctx.lineTo(28, 12); ctx.lineTo(52, 12); ctx.lineTo(44, 20);
      ctx.moveTo(52, 12); ctx.lineTo(52, 36); ctx.lineTo(44, 44);
      ctx.stroke();
      ctx.fillStyle = "#f0a83d";
      ctx.fillRect(20, 44, 24, 4);
    } else if (kind === "grad2d") {
      for (var yy = 0; yy < 52; yy++) {
        for (var xx = 0; xx < 52; xx++) {
          var fx = xx / 51, fy = yy / 51;
          var wr = C.hsvToRgb(18, 0.9, 1), cl = C.hsvToRgb(215, 0.85, 1);
          var rr = wr[0] + (cl[0] - wr[0]) * fx;
          var gg = wr[1] + (cl[1] - wr[1]) * fx;
          var bb = wr[2] + (cl[2] - wr[2]) * fx;
          var cast = (0.5 - fy) * 0.5;
          gg += cast * 0.4;
          ctx.fillStyle = "rgb(" + Math.round(C.clamp(rr, 0, 1) * 255) + "," + Math.round(C.clamp(gg, 0, 1) * 255) + "," + Math.round(C.clamp(bb, 0, 1) * 255) + ")";
          ctx.fillRect(10 + xx, 10 + yy, 1, 1);
        }
      }
    } else if (kind === "diamond") {
      var dd = [[0, -16, "#e05a5a"], [16, 0, "#5ae05a"], [0, 16, "#5a8ae0"], [-16, 0, "#e0c05a"]];
      dd.forEach(function (q) {
        ctx.beginPath();
        ctx.arc(cx + q[0], cy + q[1], 9, 0, Math.PI * 2);
        ctx.fillStyle = q[2];
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = "#000";
        ctx.stroke();
      });
    } else if (kind === "dot") {
      ctx.beginPath();
      ctx.arc(cx, cy, spec.size || 9, 0, Math.PI * 2);
      ctx.fillStyle = spec.color || "#e8e9eb";
      ctx.fill();
    } else if (kind === "softdot") {
      var sg = ctx.createRadialGradient(cx, cy, 1, cx, cy, 26);
      sg.addColorStop(0, "rgba(255,255,255,0.95)");
      sg.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = sg;
      ctx.fillRect(8, 8, S - 16, S - 16);
    } else if (kind === "star") {
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 2.5;
      for (var s = 0; s < 4; s++) {
        var sa = (Math.PI / 4) + (s * Math.PI) / 2;
        ctx.beginPath();
        ctx.moveTo(cx - Math.cos(sa) * 24, cy - Math.sin(sa) * 24);
        ctx.lineTo(cx + Math.cos(sa) * 24, cy + Math.sin(sa) * 24);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(cx, cy, 5, 0, Math.PI * 2);
      ctx.fillStyle = "#fff";
      ctx.fill();
    } else if (kind === "hstreak") {
      var hg = ctx.createLinearGradient(8, 0, S - 8, 0);
      hg.addColorStop(0, "rgba(255,255,255,0)");
      hg.addColorStop(0.5, "rgba(255,255,255,0.9)");
      hg.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = hg;
      ctx.fillRect(8, cy - 5, S - 16, 10);
    } else if (kind === "circle") {
      ctx.beginPath();
      ctx.arc(cx, cy, 22, 0, Math.PI * 2);
      ctx.strokeStyle = "#f0a83d";
      ctx.lineWidth = 2.5;
      if (spec.dashed) ctx.setLineDash([5, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
    } else if (kind === "grid") {
      ctx.strokeStyle = "rgba(255,255,255,0.5)";
      ctx.lineWidth = 1.5;
      for (var li = 0; li <= 4; li++) {
        ctx.beginPath(); ctx.moveTo(10 + (li * (S - 20)) / 4, 10); ctx.lineTo(10 + (li * (S - 20)) / 4, S - 10); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(10, 10 + (li * (S - 20)) / 4); ctx.lineTo(S - 10, 10 + (li * (S - 20)) / 4); ctx.stroke();
      }
    } else if (kind === "rgblines") {
      var rc = ["#e05a5a", "#5ae05a", "#5a8ae0"];
      rc.forEach(function (c, i) {
        ctx.strokeStyle = c;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(12, 22 + i * 12);
        ctx.lineTo(S - 12 - i * 6, 22 + i * 12);
        ctx.stroke();
      });
    }
  };

  Looks.widgets = widgets;
})(Looks);
