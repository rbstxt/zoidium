"use strict";
const C = require("./vendor/clipper.js");
const GRID = 1024, MAX_POINTS = 4096, MAX_INTERSECTIONS = 262144;
// All failures propagate to the host instead of opening a blocking alert.
C.Error = message => { throw Error("Shape+ clipping: " + message); };
function integerPaths(paths) {
  let count = 0;
  return paths.map(path => {
    if (!path.closed) throw Error("Shape+ topology requires closed contours");
    return path.points.map(point => {
      if (++count > MAX_POINTS) throw Error("Shape+ clipping point budget exceeded");
      if (!point.every(v => Number.isFinite(v) && Math.abs(v) <= 1e6)) throw Error("Shape+ clipping coordinate budget exceeded");
      // Symmetric ties away from zero. The result stays below 2^30.
      const q = x => Math.sign(x) * Math.floor(Math.abs(x) * GRID + .5);
      return { X:q(point[0]), Y:q(point[1]) };
    });
  }).filter(path => path.length >= 3);
}
function clip(subject, other, mode) {
  const engine = new C.Clipper(C.Clipper.ioStrictlySimple), result = [];
  let visits = 0;
  const intersect = engine.IntersectEdges;
  engine.IntersectEdges = function(...args) {
    if (++visits > MAX_INTERSECTIONS) throw Error("Shape+ clipping intersection budget exceeded");
    return intersect.apply(this,args);
  };
  engine.AddPaths(subject,C.PolyType.ptSubject,true);
  engine.AddPaths(other,C.PolyType.ptClip,true);
  const types={add:C.ClipType.ctUnion,subtract:C.ClipType.ctDifference,intersect:C.ClipType.ctIntersection,exclude:C.ClipType.ctXor};
  if (!engine.Execute(types[mode],result,C.PolyFillType.pftNonZero,C.PolyFillType.pftNonZero)) throw Error("Shape+ clipping failed");
  return result;
}
function output(polygons,id) {
  if (polygons.reduce((n,p)=>n+p.length,0)>16384) throw Error("Shape+ clipping output budget exceeded");
  // Preserve Clipper's outer/hole winding. Canonical start/order breaks ties
  // without relying on engine traversal order or the previous frame.
  const paths=polygons.filter(p=>p.length>=3).map(p=>{
    let first=0;
    for(let i=1;i<p.length;i++) if(p[i].X<p[first].X || p[i].X===p[first].X&&p[i].Y<p[first].Y) first=i;
    return p.slice(first).concat(p.slice(0,first)).map(v=>[v.X/GRID,v.Y/GRID]);
  });
  paths.sort((a,b)=>a[0][0]-b[0][0]||a[0][1]-b[0][1]||a.length-b.length||JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return paths.map((points,i)=>({id:id+":"+i,closed:true,points}));
}
function merge(paths,p,id="merge") {
  if(p.mode==="merge") return paths.map(path=>({...path,vertices:undefined}));
  const integers=integerPaths(paths);
  if(!integers.length) return [];
  let result;
  if(p.mode==="add") result=clip(integers,[],"add");
  else {
    result=clip([integers[0]],[],"add");
    if(p.mode==="subtract") result=clip(result,clip(integers.slice(1),[],"add"),"subtract");
    else for(const polygon of integers.slice(1)) result=clip(result,[polygon],p.mode);
  }
  return output(result,id);
}
function offset(paths,p,tolerance=.125,id="offset") {
  const integers=clip(integerPaths(paths),[],"add"), amount=p.amount??10;
  if(!Number.isFinite(amount)||Math.abs(amount)>100000) throw Error("Shape+ offset amount budget exceeded");
  if(amount===0) return output(integers,id);
  const arcTolerance=Math.max(1/GRID,Math.min(tolerance,.25));
  const estimate=integers.reduce((n,path)=>n+path.length,0)*(3+Math.PI*Math.sqrt(Math.abs(amount)/arcTolerance));
  if(estimate>262144) throw Error("Shape+ offset work budget exceeded");
  const engine=new C.ClipperOffset(Math.max(1,Math.min(100,p.miterLimit??4)),arcTolerance*GRID);
  // Clipper's square join is not a bevel. Replace only this instance's corner
  // emitter with the two exact displaced edge endpoints. Concavity cleanup,
  // negative splitting/removal and winding still use Clipper's offset union.
  engine.DoSquare=function(j,k){
    for(const normal of [this.m_normals[k],this.m_normals[j]]) this.m_destPoly.push({
      X:C.ClipperOffset.Round(this.m_srcPoly[j].X+this.m_delta*normal.X),
      Y:C.ClipperOffset.Round(this.m_srcPoly[j].Y+this.m_delta*normal.Y),
    });
  };
  const join={miter:C.JoinType.jtMiter,round:C.JoinType.jtRound,bevel:C.JoinType.jtSquare}[p.join||"miter"];
  if(join===undefined) throw Error("Invalid Shape+ offset join");
  engine.AddPaths(integers,join,C.EndType.etClosedPolygon);
  const result=[]; engine.Execute(result,amount*GRID);
  return output(result,id);
}
module.exports={merge,offset,integerPaths,GRID};
