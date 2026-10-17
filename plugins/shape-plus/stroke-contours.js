"use strict";
const { arc } = require("./stroke.js");
const { distance } = require("./path.js");
const cross = (a,b) => a[0]*b[1]-a[1]*b[0];
// Cancel shared segment/join spokes before union. The winding of this ribbon
// equals the winding sum of the old quads and join sectors, including turns
// back on themselves. Clipper resolves the remaining self intersections once.
function contours(paths, style, tolerance) {
  const result = [];
  for (const path of paths) {
    require("./geometry-budget.js").check();
    const indices = path.points.map((_,i)=>i).filter(i=>!i||distance(path.points[i],path.points[i-1])>1e-9);
    if (path.closed && indices.length>1 && distance(path.points[indices[0]],path.points[indices.at(-1)])<1e-9) indices.pop();
    const points=indices.map(i=>path.points[i]), radii=indices.map(i=>Math.max(0,path.widths?.[i]??style.width)/2), n=points.length;
    if(n<2) { result.push(...require("./stroke.js").outlines([{...path,points}],style,tolerance,262144)); continue; }
    const count=path.closed?n:n-1, directions=[];
    for(let i=0;i<count;i++) {
      const p=points[i],q=points[(i+1)%n],len=distance(p,q);
      directions.push([(q[0]-p[0])/len,(q[1]-p[1])/len]);
    }
    const displaced=(p,d,r,side)=>[p[0]-d[1]*r*side,p[1]+d[0]*r*side];
    function sidePoints(side) {
      const out=[];
      for(let i=0;i<n;i++) {
        const p=points[i],r=radii[i],a=directions[(i-1+count)%count],b=directions[i%count];
        if(!path.closed&&(i===0||i===n-1)) {
          const d=i===0?directions[0]:directions.at(-1),end=p.slice();
          if(style.cap==="square") {const s=i===0?-r:r;end[0]+=d[0]*s;end[1]+=d[1]*s;}
          out.push(displaced(end,d,r,side));continue;
        }
        const u=displaced(p,a,r,side),v=displaced(p,b,r,side),turn=cross(a,b),dot=a[0]*b[0]+a[1]*b[1];
        out.push(u);
        if(turn*side<0) {
          if(style.join==="round") out.push(...arc(p,r,Math.atan2(u[1]-p[1],u[0]-p[0]),Math.atan2(turn,dot),tolerance).slice(1));
          else if(style.join==="miter"&&Math.abs(turn)>1e-10) {
            const t=cross([v[0]-u[0],v[1]-u[1]],b)/turn,hit=[u[0]+a[0]*t,u[1]+a[1]*t];
            if(distance(hit,p)<=r*Math.max(1,style.miterLimit))out.push(hit);
          }
        } else if(Math.abs(turn)<1e-10&&dot<0&&style.join==="round") {
          out.push(...arc(p,r,Math.atan2(u[1]-p[1],u[0]-p[0]),-side*Math.PI,tolerance).slice(1));
        } else out.push(p);
        out.push(v);
      }
      return out;
    }
    const left=sidePoints(1),right=sidePoints(-1);
    if(path.closed) {result.push(right, left.reverse());continue;}
    const polygon=right;
    if(style.cap==="round") {const p=points.at(-1),d=directions.at(-1);polygon.push(...arc(p,radii.at(-1),Math.atan2(d[1],d[0])-Math.PI/2,Math.PI,tolerance).slice(1));}
    polygon.push(...left.reverse());
    if(style.cap==="round") {const p=points[0],d=directions[0];polygon.push(...arc(p,radii[0],Math.atan2(d[1],d[0])+Math.PI/2,Math.PI,tolerance).slice(1));}
    result.push(polygon);
  }
  return result;
}
module.exports={contours};
