"use strict";
const { createCache, fontId } = require("./text-cache.js");
const { flattenPath } = require("./path.js");
const { trim } = require("./operators.js");
const { triangulate } = require("./fill.js");
const geometry = createCache(8 * 1024 * 1024), paints = createCache(8 * 1024 * 1024);
function size(paths) { return 128 + paths.reduce((n,p)=>n+p.points.length*48+(p.vertices?.length||0)*192,0); }
function geometryKey(glyph,tolerance) {
  return JSON.stringify([fontId(glyph.font),glyph.g,glyph.font.coordinates(glyph.coordinates),glyph.scaleX,glyph.scaleY,tolerance]);
}
function textGeometry(item,tolerance) {
  const result=[], keys=new Map();
  for(const glyph of item.textLayout?.glyphs || []) {
    if(!keys.has(glyph.font))keys.set(glyph.font,new Map());
    const byCoordinates=keys.get(glyph.font);
    if(!byCoordinates.has(glyph.coordinates))byCoordinates.set(glyph.coordinates,new Map());
    const local=byCoordinates.get(glyph.coordinates),metrics=glyph.g+":"+glyph.scaleX+":"+glyph.scaleY;
    if(!local.has(metrics))local.set(metrics,geometryKey(glyph,tolerance));
    const key=local.get(metrics);
    let canonical=geometry.get(key);
    if(!canonical) {
      canonical=(glyph.contours || []).map(path=>{
        const vertices=path.vertices.map(v=>({point:[v.point[0]*glyph.scaleX,v.point[1]*glyph.scaleY],in:[v.in[0]*glyph.scaleX,v.in[1]*glyph.scaleY],out:[v.out[0]*glyph.scaleX,v.out[1]*glyph.scaleY]}));
        return {...flattenPath({closed:path.closed,vertices},tolerance),vertices};
      });
      geometry.set(key,canonical,size(canonical));
    }
    const batch={key,canonical,x:glyph.x,y:glyph.y};
    for(const path of canonical) result.push({...path,textGlyph:batch,textOrigin:true,points:path.points.map(p=>[p[0]+glyph.x,p[1]+glyph.y]),vertices:path.vertices.map(v=>({...v,point:[v.point[0]+glyph.x,v.point[1]+glyph.y]}))});
  }
  return result;
}
function trimBatches(paths,p,safe=true) {
  const batches=new Map();
  return paths.map(path=>{
    const old=path.textGlyph;
    if(!old)return path;
    if(!safe || p.mode==="individual")return {...path,textGlyph:undefined};
    if(!batches.has(old)) {
      const key=old.key+"|trim:"+JSON.stringify([p.start,p.end,p.offset,p.mode]);
      let canonical=geometry.get(key);
      if(!canonical){canonical=trim(old.canonical,p);geometry.set(key,canonical,size(canonical));}
      batches.set(old,{...old,key,canonical});
    }
    return {...path,textGlyph:batches.get(old)};
  });
}
// Bounds reject distant pairs. Remaining pairs require segment-intersection
// and filled-containment checks. Touching contours use the compound fill.
function filled(point,paths,rule) {
  let winding=0;
  for(const path of paths)for(let i=0;i<path.length;i++){
    const a=path[i],b=path[(i+1)%path.length];
    if((a[1]<=point[1]&&b[1]>point[1])||(b[1]<=point[1]&&a[1]>point[1])) {
      const x=a[0]+(point[1]-a[1])*(b[0]-a[0])/(b[1]-a[1]);
      if(x>point[0])winding+=b[1]>a[1]?1:-1;
    }
  }
  return rule==="even-odd"?Math.abs(winding)%2!==0:winding!==0;
}
function intersect(a,b,c,d) {
  const eps=1e-9;
  if(Math.max(a[0],b[0])+eps<Math.min(c[0],d[0])||Math.max(c[0],d[0])+eps<Math.min(a[0],b[0])||Math.max(a[1],b[1])+eps<Math.min(c[1],d[1])||Math.max(c[1],d[1])+eps<Math.min(a[1],b[1]))return false;
  const cross=(p,q,r)=>(q[0]-p[0])*(r[1]-p[1])-(q[1]-p[1])*(r[0]-p[0]);
  const ab1=cross(a,b,c),ab2=cross(a,b,d),cd1=cross(c,d,a),cd2=cross(c,d,b);
  return ((ab1<=eps&&ab2>=-eps)||(ab2<=eps&&ab1>=-eps))&&((cd1<=eps&&cd2>=-eps)||(cd2<=eps&&cd1>=-eps));
}
function disjoint(batches,rule="nonzero") {
  const boxes=batches.map(batch=>{
    let left=Infinity,right=-Infinity,bottom=Infinity,top=-Infinity;
    const paths=batch.canonical.map(path=>path.points.map(p=>[p[0]+batch.x,p[1]+batch.y]));
    for(const path of paths)for(const p of path){left=Math.min(left,p[0]);right=Math.max(right,p[0]);bottom=Math.min(bottom,p[1]);top=Math.max(top,p[1]);}
    return {left,right,bottom,top,paths};
  }).filter(b=>b.left!==Infinity).sort((a,b)=>a.left-b.left);
  for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length&&boxes[j].left<=boxes[i].right+1e-9;j++) {
    const a=boxes[i],b=boxes[j];
    if(b.bottom>a.top+1e-9||b.top<a.bottom-1e-9)continue;
    for(const p of a.paths)for(const q of b.paths)for(let k=0;k<p.length;k++)for(let l=0;l<q.length;l++)
      if(intersect(p[k],p[(k+1)%p.length],q[l],q[(l+1)%q.length]))return false;
    if(a.paths.some(p=>p.some(v=>filled(v,b.paths,rule)))||b.paths.some(p=>p.some(v=>filled(v,a.paths,rule))))return false;
  }
  return true;
}
function glyphFill(paths,rule,paintType="fill") {
  if(paintType!=="fill")return null;
  if(!["nonzero","even-odd"].includes(rule)||!paths.length||paths.some(p=>!p.textGlyph))return null;
  const batches=[...new Set(paths.map(p=>p.textGlyph))];
  // Sloped/cubic glyph edges gain extra slab vertices in a compound fill.
  // Their Float32 rasterization is not necessarily identical to separate
  // triangulations. Keep the compound arrangement unless every edge is axial.
  if(batches.some(batch=>batch.canonical.some(path=>path.points.some((p,i)=>{
    const q=path.points[(i+1)%path.points.length];return p[0]!==q[0]&&p[1]!==q[1];
  }))))return null;
  if(!disjoint(batches,rule))return null;
  const positions=[];
  for(const batch of batches) {
    const key=JSON.stringify([batch.key,rule]);
    let cached=paints.get(key);
    if(!cached){cached=triangulate(batch.canonical.map(p=>p.points),rule);paints.set(key,cached,128+cached.length*8);}
    for(let i=0;i<cached.length;i+=3){positions.push(cached[i]+batch.x,cached[i+1]+batch.y,0);if(positions.length>1800000)throw Error("Shape+ triangle budget exceeded");}
  }
  return positions;
}
function fillGroups(paths,rule) { if(!paths.length||paths.some(path=>!path.textGlyph))return undefined;const batches=[...new Set(paths.map(path=>path.textGlyph))];return disjoint(batches,rule)?paths.map(path=>path.textGlyph):undefined; }
module.exports={fillGroups,textGeometry,trimBatches,glyphFill,disjoint,geometryKey,stats:()=>({geometry:geometry.stats(),paints:paints.stats()}),clear(){geometry.clear();paints.clear();}};
