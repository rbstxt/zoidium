"use strict";
// The slab sweep shared with fill.js: spatial intersection pruning and an
// active-edge sweep. Text-origin paths may pass per-glyph groups; ordinary
// shapes call without groups and stay in one compound arrangement.
const { check } = require("./geometry-budget.js");
const cross = (a, b) => a[0] * b[1] - a[1] * b[0];
function area(points) {
  let sum = 0;
  for (let i = 0; i < points.length; i++) sum += cross(points[i], points[(i + 1) % points.length]);
  return sum / 2;
}
// Horizontal arrangement: split slabs at every vertex AND segment crossing.
// Within a slab edge order is fixed, so winding transitions bound disjoint
// trapezoids. This resolves holes, overlaps and self-intersections explicitly.
// No triangle overlaps another interior: alpha is applied once per paint.
function triangulate(contours, rule = "nonzero", groups) {
  const edges = [], levels = [];
  for (const [contourIndex, points] of contours.entries()) {
    if (points.length < 3) continue;
    for (let i = 0; i < points.length; i++) {
      const a = points[i], b = points[(i + 1) % points.length];
      if (!a.concat(b).every(Number.isFinite)) throw Error("Shape+ nonfinite polygon");
      levels.push(a[1]);
      if (levels.length > 16384 || edges.length > 4096) throw Error("Shape+ polygon edge budget exceeded");
      if (a[1] !== b[1]) edges.push({ a, b, min: Math.min(a[1], b[1]), max: Math.max(a[1], b[1]), sign: b[1] > a[1] ? 1 : -1, index: edges.length, group: groups?.[contourIndex] });
    }
  }
  if (edges.length > 4096) throw Error("Shape+ polygon edge budget exceeded");
  // Preserve the original logical work charge while rejecting pairs with
  // disjoint X ranges before their intersection arithmetic.
  for(let i=0;i<edges.length;i++)for(let n=0;n<Math.floor((edges.length-1)/256)-Math.floor(i/256);n++)check();
  const ordered=edges.map(edge=>({...edge,minX:Math.min(edge.a[0],edge.b[0]),maxX:Math.max(edge.a[0],edge.b[0])})).sort((a,b)=>a.minX-b.minX||a.index-b.index);
  for(let i=0;i<ordered.length;i++)for(let j=i+1;j<ordered.length&&ordered[j].minX<=ordered[i].maxX;j++) {
    const first=ordered[i],second=ordered[j],e=first.index<second.index?first:second,f=first.index<second.index?second:first;
    if (Math.max(e.min,f.min)>=Math.min(e.max,f.max))continue;
    const r=[e.b[0]-e.a[0],e.b[1]-e.a[1]],v=[f.b[0]-f.a[0],f.b[1]-f.a[1]],den=cross(r,v);
    if(Math.abs(den)<1e-12)continue;
    const d=[f.a[0]-e.a[0],f.a[1]-e.a[1]],t=cross(d,v)/den,u=cross(d,r)/den;
    if(t>0&&t<1&&u>0&&u<1)levels.push(e.a[1]+r[1]*t);
    if(levels.length>65536)throw Error("Shape+ crossing budget exceeded");
  }
  const ys = [...new Set(levels)].sort((a, b) => a - b), positions = [];
  const xAt = (edge, y) => edge.a[0] + (y - edge.a[1]) * (edge.b[0] - edge.a[0]) / (edge.b[1] - edge.a[1]);
  function triangle(a, b, c) {
    const signed = cross([b[0] - a[0], b[1] - a[1]], [c[0] - a[0], c[1] - a[1]]);
    if (Math.abs(signed) > 1e-10) positions.push(a[0],a[1],0,b[0],b[1],0,c[0],c[1],0);
    if (positions.length > 1800000) throw Error("Shape+ triangle budget exceeded");
  }
  let work=0;
  for(let i=0;i<ys.length-1;i++) {
    check(); if(ys[i+1]-ys[i]<1e-10)continue;
    work+=edges.length;if(work>16000000)throw Error("Shape+ arrangement work budget exceeded");
  }
  const grouped = new Map();
  for(const edge of edges) {const key=groups?edge.group:0;if(!grouped.has(key))grouped.set(key,[]);grouped.get(key).push(edge);}
  for(const subset of grouped.values()) {
  let cursor=0,active=[];
  const starts=subset.slice().sort((a,b)=>a.min-b.min||a.index-b.index),min=starts[0]?.min,max=Math.max(...subset.map(e=>e.max));
  for (let i=0;i<ys.length-1;i++) {
    const low=ys[i],high=ys[i+1],mid=(low+high)/2;
    if(high-low<1e-10||mid<=min||mid>=max)continue;
    active=active.filter(e=>e.max>mid);
    while(cursor<starts.length&&starts[cursor].min<mid){if(starts[cursor].max>mid)active.push(starts[cursor]);cursor++;}
    active.sort((a,b)=>xAt(a,mid)-xAt(b,mid)||a.index-b.index);
    let winding = 0, left = null;
    for (let j = 0; j < active.length;) {
      const edge = active[j], x = xAt(edge, mid), before = rule === "even-odd" ? Math.abs(winding) % 2 !== 0 : winding !== 0;
      do { winding += active[j].sign; j++; } while (j < active.length && Math.abs(xAt(active[j], mid) - x) < 1e-9);
      const inside = rule === "even-odd" ? Math.abs(winding) % 2 !== 0 : winding !== 0;
      if (!before && inside) left = edge;
      if (before && !inside && left) {
        const a = [xAt(left, low), low], b = [xAt(edge, low), low], c = [xAt(edge, high), high], d = [xAt(left, high), high];
        triangle(a, b, c); triangle(a, c, d); left = null;
      }
    }
  }
  }
  return positions;
}
module.exports = { triangulate };
