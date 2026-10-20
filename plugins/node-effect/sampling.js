"use strict";
// Sampling nodes always read the effect's input layer. All neighborhood
// accumulation is premultiplied, then converted back to graph color.
function compileSampling(node,{input,num,col,add,functions,allocate,cost}) {
 const p=node.params,uv=`(${input("uv","vec4(vUv,0.0,1.0)")}).xy`;
 if(node.type==="sample") {
  cost(1);add("color",`ne_sample(${uv})`);return true;
 }
 if(node.type==="blur") {
  const name=allocate("blur"),count=p.mode<2?Math.min(5,Math.floor(Math.sqrt(p.taps))):p.taps;
  cost(p.mode<2?count*count:count);
  const lines=[`vec4 ${name}(vec2 uv,float radius,float angle,vec2 center){vec4 sum=vec4(0.0);float total=0.0;`];
  if(p.mode<2) {
   for(let y=0;y<count;y++)for(let x=0;x<count;x++) {
    const dx=count===1?0:x/(count-1)*2-1,dy=count===1?0:y/(count-1)*2-1,weight=p.mode===1?Math.exp(-2*(dx*dx+dy*dy)):1;
    lines.push(`{vec4 s=ne_sample(uv+vec2(${dx.toFixed(8)},${dy.toFixed(8)})*radius/resolution);float w=${weight.toFixed(8)};sum+=vec4(s.rgb*s.a,s.a)*w;total+=w;}`);
   }
  }else for(let i=0;i<count;i++) {
   const t=count===1?0:i/(count-1)*2-1;
   const offset=p.mode===2?`vec2(cos(angle),sin(angle))*radius*${t.toFixed(8)}/resolution`:`(uv-center)*radius*${t.toFixed(8)}/max(resolution.x,resolution.y)`;
   lines.push(`{vec4 s=ne_sample(uv+${offset});sum+=vec4(s.rgb*s.a,s.a);total+=1.0;}`);
  }
  lines.push("return vec4(sum.a>0.000001?sum.rgb/sum.a:vec3(0.0),sum.a/total);}");functions.push(lines.join("\n"));
  add("color",`${name}(${uv},${num("radius")},${num("angle")},vec2(${num("cx")},${num("cy")}))`);return true;
 }
 if(node.type==="edge") {
  cost(9);const name=allocate("edge");
  const lines=[`vec4 ${name}(vec2 uv,float radius,float strength){float gx=0.0,gy=0.0;float alpha=0.0;`];
  const sx=[[-1,0,1],[-2,0,2],[-1,0,1]],sy=[[-1,-2,-1],[0,0,0],[1,2,1]];
  for(let y=0;y<3;y++)for(let x=0;x<3;x++)lines.push(`{vec4 s=ne_sample(uv+vec2(${(x-1).toFixed(1)},${(y-1).toFixed(1)})*radius/resolution);float l=dot(s.rgb*s.a,vec3(0.3,0.59,0.11));gx+=l*${sx[y][x].toFixed(1)};gy+=l*${sy[y][x].toFixed(1)};${x===1&&y===1?"alpha=s.a;":""}}`);
  lines.push("return vec4(vec3(length(vec2(gx,gy))*strength),alpha);}");functions.push(lines.join("\n"));
  add("color",`${name}(${uv},${num("radius")},${num("strength")})`);return true;
 }
 return false;
}
module.exports={compileSampling};
