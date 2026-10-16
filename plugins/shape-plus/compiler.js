"use strict";
const { primitive } = require("./primitives.js");
const { triangulate } = require("./fill.js");
const { stroke } = require("./stroke.js");
const identity = [1, 0, 0, 1, 0, 0];
function matrix(p) {
  const a = p.anchor || [0, 0], t = p.position || [0, 0], s = p.scale || [1, 1], c = Math.cos(p.rotation || 0), n = Math.sin(p.rotation || 0);
  const m = [c * s[0], n * s[0], -n * s[1], c * s[1], t[0], t[1]];
  m[4] -= m[0] * a[0] + m[2] * a[1]; m[5] -= m[1] * a[0] + m[3] * a[1];
  return m;
}
const transform = (p, m) => [m[0] * p[0] + m[2] * p[1] + m[4], m[1] * p[0] + m[3] * p[1] + m[5]];
function transformCommand(command, m) {
  if (command.kind === "isolation") return { ...command, commands: command.commands.map(c => transformCommand(c, m)) };
  const positions = [];
  for (let i = 0; i < command.positions.length; i += 3) positions.push(...transform(command.positions.slice(i, i + 2), m), 0);
  if (!command.gradient) return { ...command, positions };
  const a = m, b = command.gradient.matrix;
  const combined = [a[0]*b[0]+a[2]*b[1], a[1]*b[0]+a[3]*b[1], a[0]*b[2]+a[2]*b[3], a[1]*b[2]+a[3]*b[3], ...transform([b[4],b[5]],a)];
  return { ...command, positions, gradient: { ...command.gradient, matrix: combined } };
}
// Contents run top-to-bottom for path collection, bottom-to-top for paint.
// A parent paint sees paths in groups above it, in the parent's coordinates.
// A group's own paints run in its local coordinates BEFORE its transform.
function compile(contents, tolerance = .125, depth = 0, budget = { coordinates: 0, points: 0 }) {
  if (depth > 16) throw Error("Shape+ group depth budget exceeded");
  const advanced = list => list.some(item => ["trim", "roundCorners", "repeater", "gradientFill", "gradientStroke", "twist", "zigZag", "puckerBloat", "wigglePaths", "wiggleTransform", "offsetPaths", "mergePaths"].includes(item.kind) || item.properties.composite === "above" || item.contents && advanced(item.contents));
  if (advanced(contents)) return require("./compiler-procedural.js").procedural(contents, tolerance, depth, budget, { matrix, transform, transformCommand });
  const paths = [], schedule = [];
  for (const item of contents) {
    const p = item.properties;
    if (p.enabled === 0) continue;
    if (item.kind === "group") {
      const m = matrix(p), scale = Math.max(Math.hypot(m[0], m[1]), Math.hypot(m[2], m[3]), 1e-6);
      const child = compile(item.contents, tolerance / scale, depth + 1, budget);
      paths.push(...child.paths.map(path => ({ ...path, points: path.points.map(point => transform(point, m)) })));
      const commands = child.commands.map(c => transformCommand(c, m));
      schedule.push(p.opacity < 1 ? [{ kind: "isolation", id: item.id, opacity: Math.max(0, p.opacity), commands }] : commands);
    } else if (item.kind === "fill" || item.kind === "stroke") {
      const positions = item.kind === "fill" ? triangulate(paths.map(path => path.points), p.fillRule) : stroke(paths, p, tolerance);
      budget.coordinates += positions.length;
      if (budget.coordinates > 1800000) throw Error("Shape+ geometry budget exceeded");
      schedule.push([{ kind: "paint", id: item.id, color: p.color.slice(), opacity: Math.max(0, Math.min(1, p.opacity)), positions }]);
    } else {
      const path = primitive(item, tolerance);
      budget.points += path.points.length;
      if (budget.points > 16384) throw Error("Shape+ path collection budget exceeded");
      paths.push(path);
    }
  }
  const commands = schedule.reverse().flat();
  if (depth === 0) {
    let coordinates = 0;
    const check = list => { for (const command of list) {
      if (command.kind === "isolation") check(command.commands);
      else {
        coordinates += command.positions.length;
        if (coordinates > 1800000 || !command.positions.every(Number.isFinite)) throw Error("Shape+ geometry budget exceeded");
      }
    } };
    check(commands);
  }
  return { paths, commands };
}
module.exports = { compile, matrix, transform, transformCommand, identity };
