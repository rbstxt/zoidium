"use strict";
const { flattenPath } = require("./path.js");
const vertex = (point, incoming = [0, 0], outgoing = [0, 0]) => ({ point, in: incoming, out: outgoing });
function primitivePath(item) {
  const p = item.properties, center = p.position || [0, 0], vertices = [];
  if (item.kind === "rectangle") {
    const w = Math.abs(p.size[0]) / 2, h = Math.abs(p.size[1]) / 2, r = Math.min(w, h, Math.max(0, p.roundness)), k = .5522847498307936;
    if (!r) vertices.push(...[[-w, -h], [w, -h], [w, h], [-w, h]].map(v => vertex(v)));
    else {
      const points = [[-w + r, -h], [w - r, -h], [w, -h + r], [w, h - r], [w - r, h], [-w + r, h], [-w, h - r], [-w, -h + r]];
      const handles = [[[ -k*r,0],[0,0]], [[0,0],[k*r,0]], [[0,-k*r],[0,0]], [[0,0],[0,k*r]], [[k*r,0],[0,0]], [[0,0],[-k*r,0]], [[0,k*r],[0,0]], [[0,0],[0,-k*r]]];
      points.forEach((v, i) => vertices.push(vertex(v, ...handles[i])));
    }
  } else if (item.kind === "ellipse") {
    const x = Math.abs(p.size[0]) / 2, y = Math.abs(p.size[1]) / 2, k = .5522847498307936;
    vertices.push(vertex([x, 0], [0, -y*k], [0, y*k]), vertex([0, y], [x*k, 0], [-x*k, 0]), vertex([-x, 0], [0, y*k], [0, -y*k]), vertex([0, -y], [-x*k, 0], [x*k, 0]));
  } else if (item.kind === "polystar") {
    const count = Math.max(3, Math.min(128, Math.round(p.points))), star = p.mode !== "polygon", n = count * (star ? 2 : 1);
    const raw = [];
    for (let i = 0; i < n; i++) {
      const theta = p.rotation + Math.PI / 2 + i / n * Math.PI * 2, r = star && i % 2 ? p.innerRadius : p.outerRadius;
      raw.push([r * Math.cos(theta), r * Math.sin(theta)]);
    }
    // Rounded corners cut at most half of either adjacent edge. The cubic
    // interpolates the cut with tangent controls, preserving a fixed order.
    for (let i = 0; i < n; i++) {
      const a = raw[(i - 1 + n) % n], b = raw[i], c = raw[(i + 1) % n];
      const f = Math.max(0, Math.min(1, (star && i % 2 ? p.innerRoundness : p.outerRoundness) / 100)) * .5;
      const u = [b[0] + (a[0] - b[0]) * f, b[1] + (a[1] - b[1]) * f], v = [b[0] + (c[0] - b[0]) * f, b[1] + (c[1] - b[1]) * f];
      vertices.push(vertex(u, [0, 0], [(b[0] - u[0]) * 2/3, (b[1] - u[1]) * 2/3]), vertex(v, [(b[0] - v[0]) * 2/3, (b[1] - v[1]) * 2/3], [0, 0]));
    }
  } else if (item.kind === "path") {
    const values = p.path;
    for (let i = 0; i < item.vertexIds.length; i++) vertices.push(vertex(values.slice(i * 6, i * 6 + 2), values.slice(i * 6 + 2, i * 6 + 4), values.slice(i * 6 + 4, i * 6 + 6)));
    return { id: item.id, vertices, closed: !!p.closed };
  } else throw Error("Unknown Shape+ path: " + item.kind);
  for (const v of vertices) v.point = [v.point[0] + center[0], v.point[1] + center[1]];
  return { id: item.id, vertices, closed: true };
}
function primitive(item, tolerance) { return flattenPath(primitivePath(item), tolerance); }
module.exports = { primitive, primitivePath };
