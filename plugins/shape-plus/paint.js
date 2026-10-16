"use strict";
const { clamp } = require("./operators.js");
function stops(value) {
  if (!Array.isArray(value) || value.length < 2 || value.length > 16) throw Error("Shape+ gradients require 2 to 16 stops");
  return value.map(stop => {
    const position = Array.isArray(stop) ? stop[0] : stop.position;
    let color = Array.isArray(stop) ? stop[1] : stop.color;
    if (typeof color === "string") {
      const rgba = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/.exec(color);
      const hex = /^#([\da-f]{6})$/i.exec(color);
      if (rgba) color = [Number(rgba[1])/255, Number(rgba[2])/255, Number(rgba[3])/255, Number(rgba[4] ?? 1)];
      else if (hex) color = [0, 2, 4].map(i => parseInt(hex[1].slice(i, i + 2), 16)/255).concat(1);
    }
    if (!Number.isFinite(position) || !Array.isArray(color) || color.length < 3 || !color.every(Number.isFinite)) throw Error("Invalid Shape+ gradient stop");
    return [clamp(position), [clamp(color[0]), clamp(color[1]), clamp(color[2]), clamp(color[3] ?? 1)]];
  }).sort((a, b) => a[0] - b[0]);
}
function gradient(p) {
  return { type: p.gradientType, start: p.startPoint.slice(), end: p.endPoint.slice(), highlightLength: p.highlightLength || 0,
    highlightAngle: p.highlightAngle || 0, stops: stops(p.stops), matrix: [1, 0, 0, 1, 0, 0] };
}
// The host's existing paints use encoded sRGB. Interpolate premultiplied
// encoded sRGB explicitly, then source-over, matching that compositing space.
function colorAt(stops, t) {
  let a = stops[0], b = stops.at(-1);
  for (let i = 1; i < stops.length; i++) if (t <= stops[i][0]) { a = stops[i - 1]; b = stops[i]; break; }
  const f = clamp((t - a[0]) / Math.max(1e-9, b[0] - a[0]));
  const premul = stop => [...stop[1].slice(0, 3).map(c => c * stop[1][3]), stop[1][3]];
  const x = premul(a), y = premul(b);
  return x.map((c, k) => c + (y[k] - c) * f);
}
module.exports = { stops, gradient, colorAt };
