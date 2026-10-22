(function (global) {
  "use strict";
  const clamp = v => Math.min(1, Math.max(0, Number.isFinite(Number(v)) ? Number(v) : 0));
  const clone = v => JSON.parse(JSON.stringify(v));
  function color(value) {
    if (Array.isArray(value)) return [0, 1, 2, 3].map(i => clamp(value[i] ?? (i === 3 ? 1 : 0)));
    const parts = /rgba?\(([^)]*)\)/.exec(String(value))?.[1].split(",").map(Number) || [];
    return [clamp(parts[0] / 255), clamp(parts[1] / 255), clamp(parts[2] / 255), clamp(parts[3] ?? 1)];
  }
  const rgba = c => `rgba(${255*c[0]}, ${255*c[1]}, ${255*c[2]}, ${c[3]})`;
  function midpoint(t, m = .5) {
    m = clamp(m);
    if (m === .5) return t;
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    return t <= m ? .5 * t / Math.max(m, 1e-12) : .5 + .5 * (t-m) / Math.max(1-m, 1e-12);
  }
  function reverse(stops, cyclic = false) {
    const list = clone(stops).sort((a, b) => a.position-b.position);
    return list.map((s, i) => {
      const next = { ...s, position: 1-s.position }; delete next.midpoint;
      const previous = i ? list[i-1] : cyclic ? list[list.length-1] : null;
      if (previous?.midpoint !== undefined) next.midpoint = 1-previous.midpoint;
      return next;
    }).reverse();
  }
  function sample(stops, t) {
    const list = stops.slice().sort((a, b) => a.position-b.position);
    if (!list.length) return [1, 1, 1, 1];
    if (t <= list[0].position) return color(list[0].color);
    let i = 0; while (i < list.length-1 && t > list[i+1].position) i++;
    const a = list[i], b = list[Math.min(i+1, list.length-1)], c = color(a.color), d = color(b.color);
    const f = b.position > a.position ? midpoint((t-a.position)/(b.position-a.position), a.midpoint) : 0;
    return c.map((v, j) => v+(d[j]-v)*f);
  }
  // Match the classic picker's byte-space arithmetic and string formatting
  // when adding native stops, including fractional RGB channels.
  function nativeSample(stops, t) {
    const list = stops.slice().sort((a, b) => a.position-b.position);
    let i = 0; while (i < list.length && list[i].position < t) i++;
    if (list.length === 1 || i === 0) return list[0].color;
    if (i === list.length) return list[list.length-1].color;
    const a = list[i-1], b = list[i], parse = text => Array.isArray(text) ? text.map((v, i) => i < 3 ? v*255 : v) : String(text).slice(String(text).indexOf("(")+1, -1).split(",").map(parseFloat);
    const c = parse(a.color), d = parse(b.color), f = (t-a.position)/(b.position-a.position);
    return "rgba("+c.map((n, j) => n+f*(d[j]-n)).join(", ")+")";
  }
  const api = { clamp, clone, color, rgba, midpoint, reverse, sample, nativeSample };
  if (typeof module === "object" && module.exports) module.exports = api;
  else global.ZoidiumGradientModel = api;
})(typeof window === "object" ? window : globalThis);
