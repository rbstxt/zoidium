"use strict";
const { check } = require("./geometry-budget.js");
const C = require("./vendor/clipper.js");
const GRID = 1024,
  MAX_POINTS = 32768,
  MAX_INTERSECTIONS = 262144;
// Clipping errors are caught at the paint boundary. Never open an alert.
C.Error = (message) => {
  throw Error("Shape+ clipping: " + message);
};
// Containment tests per work unit (about one microsecond each).
const CONTAINMENT_PER_UNIT = 200;
// Clipper is private to this bundle. Keep its hot methods stable between
// operations, and charge work only while a clipping operation is active.
let clippingWork = null;
const proto = C.Clipper.prototype;
for (const name of ["BuildIntersectList", "FixupOutPolygon", "JoinCommonEdges", "ProcessEdgesAtTopOfScanbeam"]) {
  const saved = proto[name];
  proto[name] = function (...args) {
    if (clippingWork) check();
    return saved.apply(this, args);
  };
}
const simplePolygons = proto.DoSimplePolygons;
proto.DoSimplePolygons = function () {
  if (!clippingWork) return simplePolygons.call(this);
  // Without a repeated coordinate the original quadratic pass is a no-op.
  for (const record of this.m_PolyOuts) {
    check();
    if (!record.Pts || record.IsOpen) continue;
    const seen = new Set();
    let point = record.Pts;
    do {
      const key = point.Pt.X + "," + point.Pt.Y;
      if (seen.has(key)) {
        check();
        return simplePolygons.call(this);
      }
      seen.add(key);
      point = point.Next;
    } while (point !== record.Pts);
  }
};
// Containment searches charge the product of the two rings' lengths.
// Polygon appends and area tests charge their linear ring walks.
const ring = (point) => { let length = 0, current = point; do { length++; current = current.Next; } while (current !== point && length < 1e6); return length; };
for (const [name, cost] of [
  ["Poly2ContainsPoly1", (inner, outer) => ring(inner) * ring(outer) / CONTAINMENT_PER_UNIT],
  ["UpdateOutPtIdxs", (record) => ring(record.Pts) / CONTAINMENT_PER_UNIT],
  ["GetBottomPt", (point) => ring(point) / CONTAINMENT_PER_UNIT],
  ["Area", (point) => (point ? ring(point) : 0) / CONTAINMENT_PER_UNIT],
]) {
  const saved = proto[name];
  proto[name] = function (...args) {
    if (clippingWork) check(1 + cost(...args));
    return saved.apply(this, args);
  };
}
// These predicates run inside duplicate searches and active-edge sorting,
// before IntersectEdges gets a chance to run. Reset counts per operation.
for (const [owner, name] of [[C.IntPoint, "op_Equality"], [C.Clipper, "TopX"]]) {
  const saved = owner[name];
  owner[name] = function (...args) {
    if (clippingWork && (++clippingWork.probes & 1023) === 0) check();
    return saved.apply(this, args);
  };
}
const intersectEdges = proto.IntersectEdges;
proto.IntersectEdges = function (...args) {
  if (clippingWork) {
    if ((clippingWork.visits & 255) === 0) check();
    if (++clippingWork.visits > MAX_INTERSECTIONS)
      throw Error("Shape+ clipping intersection budget exceeded");
  }
  return intersectEdges.apply(this, args);
};
function intersectionBudget(work) {
  const previous = clippingWork;
  clippingWork = { probes: 0, visits: 0 };
  try {
    return work();
  } finally {
    clippingWork = previous;
  }
}
function integerPaths(paths, maxPoints = MAX_POINTS, minPoints = 3) {
  let count = 0;
  return paths
    .map((path) => {
      if (!path.closed) throw Error("Shape+ topology requires closed contours");
      return path.points.map((point) => {
        if (++count > maxPoints)
          throw Error("Shape+ clipping point budget exceeded");
        if (!point.every((v) => Number.isFinite(v) && Math.abs(v) <= 1e6))
          throw Error("Shape+ clipping coordinate budget exceeded");
        // Symmetric ties away from zero. The result stays below 2^30.
        const q = (x) => Math.sign(x) * Math.floor(Math.abs(x) * GRID + 0.5);
        return { X: q(point[0]), Y: q(point[1]) };
      });
    })
    .filter((path) => path.length >= minPoints);
}
function clip(subject, other, mode) {
  const engine = new C.Clipper(C.Clipper.ioStrictlySimple),
    result = [];
  engine.AddPaths(subject, C.PolyType.ptSubject, true);
  engine.AddPaths(other, C.PolyType.ptClip, true);
  const types = {
    add: C.ClipType.ctUnion,
    subtract: C.ClipType.ctDifference,
    intersect: C.ClipType.ctIntersection,
    exclude: C.ClipType.ctXor,
  };
  if (
    !intersectionBudget(() => engine.Execute(
      types[mode],
      result,
      C.PolyFillType.pftNonZero,
      C.PolyFillType.pftNonZero,
    ))
  )
    throw Error("Shape+ clipping failed");
  return result;
}
function output(polygons, id) {
  if (polygons.reduce((n, p) => n + p.length, 0) > 131072)
    throw Error("Shape+ clipping output budget exceeded");
  // Preserve Clipper's outer/hole winding. Canonical start/order breaks ties
  // without relying on engine traversal order or the previous frame.
  const paths = polygons
    .filter((p) => p.length >= 3)
    .map((p) => {
      let first = 0;
      for (let i = 1; i < p.length; i++)
        if (
          p[i].X < p[first].X ||
          (p[i].X === p[first].X && p[i].Y < p[first].Y)
        )
          first = i;
      return p
        .slice(first)
        .concat(p.slice(0, first))
        .map((v) => [v.X / GRID, v.Y / GRID]);
    });
  paths.sort(
    (a, b) =>
      a[0][0] - b[0][0] ||
      a[0][1] - b[0][1] ||
      a.length - b.length ||
      JSON.stringify(a).localeCompare(JSON.stringify(b)),
  );
  return paths.map((points, i) => ({
    id: id + ":" + i,
    closed: true,
    points,
    proceduralGeometry: true,
  }));
}
function merge(paths, p, id = "merge", maxPoints = MAX_POINTS) {
  if (p.mode === "merge")
    return paths.map((path) => ({ ...path, vertices: undefined }));
  const integers = integerPaths(paths, maxPoints);
  if (!integers.length) return [];
  let result;
  if (p.mode === "add") result = clip(integers, [], "add");
  else {
    result = clip([integers[0]], [], "add");
    if (p.mode === "subtract")
      result = clip(result, clip(integers.slice(1), [], "add"), "subtract");
    else
      for (const polygon of integers.slice(1))
        result = clip(result, [polygon], p.mode);
  }
  return output(p.clean ? C.Clipper.CleanPolygons(result, 1) : result, id);
}
function offset(paths, p, tolerance = 0.125, id = "offset") {
  const integers = clip(integerPaths(paths), [], "add"),
    amount = p.amount ?? 10;
  if (!Number.isFinite(amount) || Math.abs(amount) > 100000)
    throw Error("Shape+ offset amount budget exceeded");
  if (amount === 0) return output(integers, id);
  const arcTolerance = Math.max(1 / GRID, Math.min(tolerance, 0.25));
  const estimate =
    integers.reduce((n, path) => n + path.length, 0) *
    (3 + Math.PI * Math.sqrt(Math.abs(amount) / arcTolerance));
  if (estimate > 2097152) throw Error("Shape+ offset work budget exceeded");
  const engine = new C.ClipperOffset(
    Math.max(1, Math.min(100, p.miterLimit ?? 4)),
    arcTolerance * GRID,
  );
  // Clipper's square join is not a bevel. Replace only this instance's corner
  // emitter with the two exact displaced edge endpoints. Concavity cleanup,
  // negative splitting/removal and winding still use Clipper's offset union.
  engine.DoSquare = function (j, k) {
    for (const normal of [this.m_normals[k], this.m_normals[j]])
      this.m_destPoly.push({
        X: C.ClipperOffset.Round(this.m_srcPoly[j].X + this.m_delta * normal.X),
        Y: C.ClipperOffset.Round(this.m_srcPoly[j].Y + this.m_delta * normal.Y),
      });
  };
  const miter=engine.DoMiter;
  engine.DoMiter=function(j,k,r){
    if(Math.sqrt(2/r)>Math.max(1,Math.min(100,p.miterLimit??4)))this.DoSquare(j,k);
    else miter.call(this,j,k,r);
  };
  const join = {
    miter: C.JoinType.jtMiter,
    round: C.JoinType.jtRound,
    bevel: C.JoinType.jtSquare,
  }[p.join || "miter"];
  if (join === undefined) throw Error("Invalid Shape+ offset join");
  engine.AddPaths(integers, join, C.EndType.etClosedPolygon);
  const result = [];
  const generate = engine.DoOffset;
  engine.DoOffset = function (delta) {
    generate.call(this, delta);
    if (this.m_destPolys.reduce((sum, path) => sum + path.length, 0) > 131072)
      throw Error("Shape+ offset output budget exceeded");
  };
  intersectionBudget(() => engine.Execute(result, amount * GRID));
  return output(result, id);
}
function strokeRegion(paths, p, tolerance = 0.125) {
  const width = Math.max(0, p.width || 0);
  if (!width) return [];
  if (!Number.isFinite(width) || width > 200000)
    throw Error("Shape+ stroke region width budget exceeded");
  const count = paths.reduce((n, path) => n + path.points.length, 0);
  if (
    count > 131072 ||
    count *
      (3 + Math.PI * Math.sqrt(width / 2 / Math.max(1 / GRID, tolerance))) >
      32768
  )
    throw Error("Shape+ stroke region work budget exceeded");
  const engine = new C.ClipperOffset(
    Math.max(1, p.miterLimit || 4),
    Math.max(1, tolerance * GRID),
  );
  const bevel = function (j, k) {
    for (const normal of [this.m_normals[k], this.m_normals[j]])
      this.m_destPoly.push({
        X: C.ClipperOffset.Round(this.m_srcPoly[j].X + this.m_delta * normal.X),
        Y: C.ClipperOffset.Round(this.m_srcPoly[j].Y + this.m_delta * normal.Y),
      });
  };
  engine.DoSquare = bevel;
  const miter = engine.DoMiter;
  engine.DoMiter = function (j, k, r) {
    if (Math.sqrt(2 / r) > Math.max(1, p.miterLimit || 4))
      bevel.call(this, j, k);
    else miter.call(this, j, k, r);
  };
  const join = {
    miter: C.JoinType.jtMiter,
    round: C.JoinType.jtRound,
    bevel: C.JoinType.jtSquare,
  }[p.join || "miter"];
  const cap = {
    butt: C.EndType.etOpenButt,
    round: C.EndType.etOpenRound,
    square: C.EndType.etOpenSquare,
  }[p.cap || "butt"];
  for (const path of paths) {
    let source=path.points,end=path.closed?C.EndType.etClosedLine:cap;
    if(!path.closed&&p.cap==="square"&&source.length>1) {
      source=source.map(point=>point.slice());
      const extend=(index,other)=>{
        const a=source[index],b=source[other],dx=a[0]-b[0],dy=a[1]-b[1],length=Math.hypot(dx,dy);
        if(length)source[index]=[a[0]+dx/length*width/2,a[1]+dy/length*width/2];
      };
      extend(0,1);extend(source.length-1,source.length-2);end=C.EndType.etOpenButt;
    }
    const points=integerPaths([{points:source,closed:true}],16384,1)[0];
    if(points)engine.AddPath(points,join,end);
  }
  const generate = engine.DoOffset;
  engine.DoOffset = function (delta) {
    generate.call(this, delta);
    if (this.m_destPolys.reduce((n, p) => n + p.length, 0) > 131072)
      throw Error("Shape+ stroke region budget exceeded");
  };
  const result = [];
  intersectionBudget(() => engine.Execute(result, (width * GRID) / 2));
  return output(result, "stroke");
}
// Earcut receives only simple Clipper polygons, with explicit hole ancestry.
// It never receives unresolved crossings or guesses the input winding rule.
function tessellate(paths, rule = "nonzero", clean = false) {
  const engine = new C.Clipper(C.Clipper.ioStrictlySimple),
    tree = new C.PolyTree();
  let subject = integerPaths(
    paths.map((path) => ({ ...path, closed: true })),
    131072,
  );
  if (clean) subject = C.Clipper.CleanPolygons(clip(subject, [], "add"), 1);
  engine.AddPaths(subject, C.PolyType.ptSubject, true);
  const fill =
    rule === "even-odd" ? C.PolyFillType.pftEvenOdd : C.PolyFillType.pftNonZero;
  intersectionBudget(() =>
    engine.Execute(C.ClipType.ctUnion, tree, fill, fill),
  );
  const positions = [],
    earcut = require("./vendor/earcut.js"),
    stack = [...tree.Childs()];
  let points = 0;
  const contour = (node) => node.Contour();
  while (stack.length) {
    const node = stack.pop();
    stack.push(...node.Childs());
    if (node.IsHole()) continue;
    const outer = contour(node);
    if (outer.length < 3) continue;
    const data = [],
      holes = [];
    const append = (polygon) => {
      for (const point of polygon) data.push(point.X / GRID, point.Y / GRID);
    };
    append(outer);
    for (const child of node.Childs())
      if (child.IsHole()) {
        const hole = contour(child);
        if (hole.length < 3) continue;
        holes.push(data.length / 2);
        append(hole);
      }
    points += data.length / 2;
    if (points > 131072)
      throw Error("Shape+ resolved polygon point budget exceeded");
    const indices = earcut(data, holes, 2);
    for (let i = 0; i < indices.length; i += 3) {
      const a = indices[i] * 2,
        b = indices[i + 1] * 2,
        c = indices[i + 2] * 2;
      const area =
        (data[b] - data[a]) * (data[c + 1] - data[a + 1]) -
        (data[b + 1] - data[a + 1]) * (data[c] - data[a]);
      if (Math.abs(area) > 1e-10)
        for (const index of [a, b, c])
          positions.push(data[index], data[index + 1], 0);
      if (positions.length > 1800000)
        throw Error("Shape+ resolved triangle budget exceeded");
    }
  }
  return positions;
}
module.exports = {
  merge,
  offset,
  integerPaths,
  tessellate,
  strokeRegion,
  GRID,
};
