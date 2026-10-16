"use strict";
const MAX_VERTICES=256, MAX_COMMANDS=4096;
const add=(a,b)=>a.map((v,k)=>v+b[k]);
const sub=(a,b)=>a.map((v,k)=>v-b[k]);
const mix=(a,b,t)=>a.map((v,k)=>v+(b[k]-v)*t);
function arcs(start,end,rx,ry,rotation,large,sweep) {
  rx=Math.abs(rx);ry=Math.abs(ry);
  if(start[0]===end[0]&&start[1]===end[1])return [];
  if(!rx||!ry)return [[start,start,end,end]];
  const phi=rotation*Math.PI/180,c=Math.cos(phi),s=Math.sin(phi);
  const dx=(start[0]-end[0])/2,dy=(start[1]-end[1])/2,x=c*dx+s*dy,y=-s*dx+c*dy;
  const radius=x*x/(rx*rx)+y*y/(ry*ry);
  if(radius>1){const scale=Math.sqrt(radius);rx*=scale;ry*=scale;}
  const factor=(large===sweep?-1:1)*Math.sqrt(Math.max(0,(rx*rx*ry*ry-rx*rx*y*y-ry*ry*x*x)/(rx*rx*y*y+ry*ry*x*x)));
  const cx=factor*rx*y/ry,cy=-factor*ry*x/rx;
  const center=[c*cx-s*cy+(start[0]+end[0])/2,s*cx+c*cy+(start[1]+end[1])/2];
  const u=[(x-cx)/rx,(y-cy)/ry],v=[(-x-cx)/rx,(-y-cy)/ry];
  const angle=Math.atan2(u[1],u[0]);let delta=Math.atan2(u[0]*v[1]-u[1]*v[0],u[0]*v[0]+u[1]*v[1]);
  if(!sweep&&delta>0)delta-=2*Math.PI;if(sweep&&delta<0)delta+=2*Math.PI;
  // At most 45 degrees per cubic reduces the circular approximation error.
  const n=Math.ceil(Math.abs(delta)/(Math.PI/4)),step=delta/n;
  const point=t=>[center[0]+rx*c*Math.cos(t)-ry*s*Math.sin(t),center[1]+rx*s*Math.cos(t)+ry*c*Math.sin(t)];
  const tangent=t=>[-rx*c*Math.sin(t)-ry*s*Math.cos(t),-rx*s*Math.sin(t)+ry*c*Math.cos(t)];
  const result=[];
  for(let i=0;i<n;i++) {
    const a=angle+i*step,b=a+step,k=4/3*Math.tan(step/4),p=i?point(a):start,q=i===n-1?end:point(b);
    result.push([p,add(p,tangent(a).map(v=>v*k)),sub(q,tangent(b).map(v=>v*k)),q]);
  }
  return result;
}
function parsePath(text) {
  if(typeof text!=="string"||text.length>262144)throw Error("SVG path text budget exceeded");
  const token=/[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?/g;
  const tokens=[];let end=0;
  for(const match of text.matchAll(token)) {
    if(!/^[\s,]*$/.test(text.slice(end,match.index)))throw Error("Invalid SVG path token");
    tokens.push(match[0]);end=match.index+match[0].length;
    if(tokens.length>32768)throw Error("SVG path token budget exceeded");
  }
  if(!/^[\s,]*$/.test(text.slice(end)))throw Error("Invalid SVG path text");
  let i=0,command=null,previous=null,current=[0,0],start=[0,0],lastCubic=null,lastQuad=null,contour=null,commands=0;
  const result=[];
  const number=()=>{const value=Number(tokens[i++]);if(!Number.isFinite(value)||Math.abs(value)>1e6)throw Error("Invalid or excessive SVG coordinate");return value;};
  const flag=()=>{const token=tokens[i];if(!token||!/[01]/.test(token[0]))throw Error("Invalid SVG arc flag");const result=Number(token[0]);if(token.length===1)i++;else tokens[i]=token.slice(1);return result;};
  const vertex=point=>({point:point.slice(),in:[0,0],out:[0,0]});
  const begin=point=>{contour={vertices:[vertex(point)],closed:false};result.push(contour);start=point.slice();current=point.slice();};
  const line=end=>{contour.vertices.push(vertex(end));current=end;};
  const cubic=(a,b,end)=>{const last=contour.vertices.at(-1);last.out=sub(a,current);const v=vertex(end);v.in=sub(b,end);contour.vertices.push(v);current=end;};
  while(i<tokens.length) {
    if(++commands>MAX_COMMANDS)throw Error("SVG command budget exceeded");
    if(/^[a-zA-Z]$/.test(tokens[i]))command=tokens[i++];
    if(!command||!/[MmLlHhVvCcSsQqTtAaZz]/.test(command))throw Error("Unsupported SVG path command");
    const kind=command.toUpperCase(),relative=command!==kind,origin=current.slice();
    const point=()=>{const p=[number(),number()];return relative?add(origin,p):p;};
    if(kind!=="M"&&!contour)throw Error("SVG path must begin with Move");
    if(kind==="M") {begin(point());command=relative?"l":"L";}
    else if(kind==="Z") {
      contour.closed=true;
      if(contour.vertices.length>1&&Math.hypot(...sub(current,start))<1e-10) {
        contour.vertices[0].in=contour.vertices.at(-1).in;contour.vertices.pop();
      }
      current=start.slice();command=null;
    } else if(kind==="L")line(point());
    else if(kind==="H")line([number()+(relative?origin[0]:0),origin[1]]);
    else if(kind==="V")line([origin[0],number()+(relative?origin[1]:0)]);
    else if(kind==="C") {const a=point(),b=point(),p=point();cubic(a,b,p);lastCubic=b;}
    else if(kind==="S") {const a=["C","S"].includes(previous)?sub(origin,sub(lastCubic,origin)):origin,b=point(),p=point();cubic(a,b,p);lastCubic=b;}
    else if(kind==="Q"||kind==="T") {
      const q=kind==="Q"?point():["Q","T"].includes(previous)?sub(origin,sub(lastQuad,origin)):origin,p=point();
      cubic(mix(origin,q,2/3),mix(p,q,2/3),p);lastQuad=q;
    } else if(kind==="A") {
      const rx=number(),ry=number(),rotation=number(),large=flag(),sweep=flag(),p=point();
      if(![0,1].includes(large)||![0,1].includes(sweep))throw Error("Invalid SVG arc flag");
      for(const span of arcs(origin,p,rx,ry,rotation,!!large,!!sweep))cubic(span[1],span[2],span[3]);
      current=p;
    }
    if(kind!=="C"&&kind!=="S")lastCubic=null;
    if(kind!=="Q"&&kind!=="T")lastQuad=null;
    previous=kind;
    if(contour.vertices.length>MAX_VERTICES||result.length>256)throw Error("SVG path vertex budget exceeded");
  }
  if(!result.length)throw Error("SVG has no path data");
  return result;
}
function pathText(path) {
  const vertices=path.vertices;if(!vertices.length)return "";
  const pair=p=>p.map(v=>Number(v.toFixed(6))).join(" ");
  let text="M"+pair(vertices[0].point);
  const count=path.closed?vertices.length:vertices.length-1;
  for(let i=0;i<count;i++) {
    const a=vertices[i],b=vertices[(i+1)%vertices.length];
    if(a.out.some(v=>v!==0)||b.in.some(v=>v!==0))text+=" C"+pair(add(a.point,a.out))+" "+pair(add(b.point,b.in))+" "+pair(b.point);
    else text+=" L"+pair(b.point);
  }
  return text+(path.closed?" Z":"");
}
module.exports={parsePath,arcs,pathText};
