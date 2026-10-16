"use strict";
const { area, triangulate } = require("./fill.js");
const { distance } = require("./path.js");
const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
const scaled = (a, s) => [a[0] * s, a[1] * s];
const cross = (a, b) => a[0] * b[1] - a[1] * b[0];
function arc(center, radius, from, sweep, tolerance) {
  if (!(radius > 0)) return [center.slice()];
  const step = 2 * Math.acos(Math.max(-1, Math.min(1, 1 - tolerance / radius)));
  const count = Math.max(1, Math.ceil(Math.abs(sweep) / Math.max(step, .01)));
  if (count > 2048) throw Error("Shape+ stroke arc budget exceeded");
  return Array.from({ length: count + 1 }, (_, i) => add(center, [radius * Math.cos(from + sweep * i / count), radius * Math.sin(from + sweep * i / count)]));
}
function outlines(paths, style, tolerance = .125) {
  const polygons = []; let radius = Math.max(0, style.width) / 2;
  if (!radius) return polygons;
  let vertices = 0;
  const push = polygon => {
    vertices += polygon.length;
    if (vertices > 16384) throw Error("Shape+ stroke outline budget exceeded");
    if (area(polygon) < 0) polygon.reverse(); polygons.push(polygon);
  };
  for (const path of paths) {
    const indices = path.points.map((_, i) => i).filter(i => !i || distance(path.points[i], path.points[i - 1]) > 1e-9);
    const points = indices.map(i => path.points[i]);
    if (path.closed && points.length > 1 && distance(points[0], points[points.length - 1]) < 1e-9) points.pop();
    const radii = path.widths && indices.map(i => Math.max(0, path.widths[i]) / 2);
    radius = radii?.[0] ?? Math.max(0, style.width) / 2;
    const n = points.length, count = path.closed ? n : n - 1;
    if (n < 2) {
      if (n && style.cap === "round") push(arc(points[0], radius, 0, 2 * Math.PI, tolerance));
      if (n && style.cap === "square") push([[-radius, -radius], [radius, -radius], [radius, radius], [-radius, radius]].map(p => add(p, points[0])));
      continue;
    }
    const directions = [], normals = [];
    for (let i = 0; i < count; i++) {
      const p = points[i], q = points[(i + 1) % n], length = distance(p, q);
      const d = [(q[0] - p[0]) / length, (q[1] - p[1]) / length], normal = [-d[1] * (radii?.[i] ?? radius), d[0] * (radii?.[i] ?? radius)];
      const endNormal = [-d[1] * (radii?.[(i + 1) % n] ?? radius), d[0] * (radii?.[(i + 1) % n] ?? radius)];
      directions.push(d); normals.push(normal);
      const a = !path.closed && i === 0 && style.cap === "square" ? add(p, scaled(d, -(radii?.[i] ?? radius))) : p;
      const b = !path.closed && i === count - 1 && style.cap === "square" ? add(q, scaled(d, radii?.[(i + 1) % n] ?? radius)) : q;
      push([add(a, normal), add(a, scaled(normal, -1)), add(b, scaled(endNormal, -1)), add(b, endNormal)]);
    }
    for (let i = path.closed ? 0 : 1; i < (path.closed ? n : n - 1); i++) {
      radius = radii?.[i] ?? radius;
      const previous = (i - 1 + count) % count, next = i % count;
      const a = directions[previous], b = directions[next], turn = cross(a, b), dot = a[0] * b[0] + a[1] * b[1], p = points[i];
      if (Math.abs(turn) < 1e-10) {
        if (dot < 0 && style.join === "round") push(arc(p, radius, 0, 2 * Math.PI, tolerance));
        continue;
      }
      const sign = turn > 0 ? -1 : 1, u = scaled([-a[1] * radius, a[0] * radius], sign), v = scaled([-b[1] * radius, b[0] * radius], sign);
      if (style.join === "round") {
        const start = Math.atan2(u[1], u[0]), sweep = Math.atan2(turn, dot);
        push([p, ...arc(p, radius, start, sweep, tolerance)]);
      } else {
        const intersection = add(add(p, u), scaled(a, cross([v[0] - u[0], v[1] - u[1]], b) / turn));
        if (style.join === "miter" && distance(intersection, p) <= radius * Math.max(1, style.miterLimit)) push([p, add(p, u), intersection, add(p, v)]);
        else push([p, add(p, u), add(p, v)]);
      }
    }
    if (!path.closed && style.cap === "round") {
      const start = directions[0], end = directions[count - 1];
      push([points[0], ...arc(points[0], radii?.[0] ?? radius, Math.atan2(start[1], start[0]) + Math.PI / 2, Math.PI, tolerance)]);
      push([points[n - 1], ...arc(points[n - 1], radii?.[n - 1] ?? radius, Math.atan2(end[1], end[0]) - Math.PI / 2, Math.PI, tolerance)]);
    }
  }
  return polygons;
}
function stroke(paths, style, tolerance) {
  const profiled = style.dashPairs > 0 || style.startLength > 0 || style.endLength > 0 || style.waveAmount > 0;
  if(!profiled&&paths.some(path=>path.proceduralGeometry)) {
    const topology=require("./topology.js");
    return topology.tessellate(topology.strokeRegion(paths,style,tolerance),"nonzero");
  }
  const polygons=outlines(profiled ? require("./stroke-profile.js").profile(paths, style) : paths, style, tolerance);
  if(paths.some(path=>path.proceduralGeometry)) {
    // New nonlinear/topology geometry can produce many tiny join rectangles.
    // Union them with the bounded clipping stage before slab triangulation.
    // Existing paths retain their original floating-point arrangement exactly.
    return require("./topology.js").tessellate(polygons.map(points=>({closed:true,points})),"nonzero",true);
  }
  return triangulate(polygons, "nonzero");
}
module.exports = { arc, outlines, stroke };
