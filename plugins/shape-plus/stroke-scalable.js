"use strict";
const { check } = require("./geometry-budget.js");
// Coverage is accumulated with blending disabled, then sampled once by the
// paint quad. Overlapping pieces never apply paint opacity more than once.
function stroke(paths, style, tolerance, polygons) {
  const profiled = style.dashPairs > 0 || style.startLength > 0 || style.endLength > 0 || style.waveAmount > 0;
  if (!polygons) {
    const source = profiled ? require("./stroke-profile.js").profile(paths, style) : paths;
    polygons = require("./stroke.js").outlines(source, style, tolerance, 262144);
  }
  const coverage = [];
  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  for(const polygon of polygons) {
    check();
    for(const p of polygon) {
      if(!p.every(Number.isFinite))throw Error("Shape+ nonfinite stroke");
      minX=Math.min(minX,p[0]);maxX=Math.max(maxX,p[0]);minY=Math.min(minY,p[1]);maxY=Math.max(maxY,p[1]);
    }
    for(let i=1;i<polygon.length-1;i++) {
      const a=polygon[0],b=polygon[i],c=polygon[i+1];
      if(Math.abs((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]))>1e-10)coverage.push(...a,0,...b,0,...c,0);
    }
    if(coverage.length>7200000)throw Error("Shape+ stroke coverage budget exceeded");
  }
  if(!coverage.length)return [];
  const positions=[minX,minY,0,maxX,minY,0,maxX,maxY,0,minX,minY,0,maxX,maxY,0,minX,maxY,0];
  positions.coverage=coverage;
  return positions;
}
module.exports={stroke};
