"use strict";
const {types} = require("./catalogue.js");
const model = require("./model.js");
const header = require("./glsl.js");
const {compileSampling}=require("./sampling.js");
const f = n => {if(!Number.isFinite(n)) throw new Error("Invalid shader constant.");return Number.isInteger(n)?n.toFixed(1):String(n);};
const scalar = x => `vec4(vec3(${x}),1.0)`;
const rgb = x => `vec4(${x},1.0)`;
function literal(value) {
 if(typeof value === "number") return scalar(f(value));
 if(typeof value === "string" && /^#[\da-f]{6}$/i.test(value))return rgb(`vec3(${[1,3,5].map(i=>f(parseInt(value.slice(i,i+2),16)/255)).join(",")})`);
 return "vec4(0.0,0.0,0.0,1.0)";
}
function compile(source) {
 const graph=model.validate(source),byId=new Map(graph.nodes.map(n=>[n.id,n])),incoming=new Map(graph.links.map(l=>[l.to.node+":"+l.to.port,l.from]));
 const parameters=model.parameters(graph),vars=new Map(),lines=[],functions=[];
 let counter=0,samples=0;
 const cost=count=>{samples+=count;if(samples>256)throw new Error("Node Effect is limited to 256 source samples per pixel.");};
 function emit(nodeId) {
  if(vars.has(nodeId))return vars.get(nodeId);
  const node=byId.get(nodeId),p=node.params,spec=types[node.type],outs={};
  const input=(id,fallback)=>{
   const l=incoming.get(nodeId+":"+id);
   if(l)return emit(l.node)[l.port];
   return fallback ?? literal(p[id]);
  };
  const num=(id)=>{
   const link=incoming.get(nodeId+":"+id),source=link&&byId.get(link.node);
   const color=source&&types[source.type].outputs.find(o=>o.id===link.port)?.type==="color" && !(source.type==="parameter"&&source.params.kind===2);
   return color?`dot((${input(id)}).rgb,vec3(0.3,0.59,0.11))`:`(${input(id)}).x`;
  },col=(id)=>`(${input(id)}).rgb`,pos=()=>`(${input("uv","vec4(vUv,0.0,1.0)")}).xy`;
  const add=(port,expression)=>{const name="n"+(counter++);lines.push(` vec4 ${name}=${expression};`);outs[port]=name;};
  const out=(e)=>add(spec.outputs[0].id,e);
  const all=(e)=>{out(scalar(e));};
  switch(node.type) {
   case "layer":cost(1);add("color","ne_sample(vUv)");add("alpha",scalar(`(${outs.color}).a`));break;
   case "uv":out("vec4(vUv,0.0,1.0)");break;
   case "pixel":out("vec4(vUv*resolution,0.0,1.0)");break;
   case "resolution":out("vec4(resolution,0.0,1.0)");break;
   case "time":all("ne_time");break;
   case "parameter": {const name=model.uniformName(node);out(p.kind===0?scalar(name):p.kind===1?rgb(name):`vec4(${name},0.0,1.0)`);break;}
   case "noise":{const q=`(${pos()}*${num("scale")}+vec2(${num("time")},${num("seed")}))`;add("out",scalar(`ne_noise(${q})`));add("color",rgb(`vec3(ne_noise(${q}),ne_noise(${q}+17.3),ne_noise(${q}+41.7))`));break;}
   case "voronoi":all(`ne_voronoi(${pos()}*${num("scale")},${num("time")})[${p.mode}]`);break;
   case "gradient":{const q=pos(),a=num("angle");all(p.mode===0?`dot(${q}-0.5,vec2(cos(${a}),sin(${a})))+0.5`:p.mode===1?`length(${q}-0.5)*2.0`:`atan((${q}).y-0.5,(${q}).x-0.5)/6.2831853+0.5`);break;}
   case "checker":add("out",scalar(`mod(floor((${pos()}).x*${num("scale")})+floor((${pos()}).y*${num("scale")}),2.0)`));add("color",rgb(`mix(${col("a")},${col("b")},${outs.out}.x)`));break;
   case "wave":all(`0.5+0.5*sin(dot(${pos()},vec2(cos(${num("angle")}),sin(${num("angle")})))*${num("scale")}*6.2831853+${num("time")})`);break;
   case "math":all(`ne_math(${num("a")},${num("b")},${num("c")},${p.mode})`);break;
   case "vectorMath":{
    const a=col("a"),b=col("b"),m=p.mode;
    const expr=[`${a}+${b}`,`${a}-${b}`,`${a}*${b}`,`vec3(ne_div((${a}).x,(${b}).x),ne_div((${a}).y,(${b}).y),ne_div((${a}).z,(${b}).z))`,`length(${a})>0.0?normalize(${a}):vec3(0.0)`,`vec3(dot(${a},${b}))`,`vec3(length(${a}))`,`vec3(distance(${a},${b}))`,`cross(${a},${b})`][m];
    add("out",rgb(expr));add("value",scalar(`${outs.out}.x`));break;
   }
   case "mapRange":{let t=`ne_div(${num("value")}-${num("fromMin")},${num("fromMax")}-${num("fromMin")})`;if(p.clamp)t=`clamp(${t},0.0,1.0)`;all(`mix(${num("toMin")},${num("toMax")},${t})`);break;}
   case "clamp":all(`clamp(${num("value")},min(${num("min")},${num("max")}),max(${num("min")},${num("max")}))`);break;
   case "mix":out(rgb(`ne_mix(${col("a")},${col("b")},${num("factor")},${p.mode})`));break;
   case "colorRamp":{
    const name="ne_ramp"+counter++,stops=p.stops;
    const v=s=>`vec4(${s.slice(1).map(f).join(",")})`;
    const body=[`vec4 ${name}(float t){`, ` t=clamp(t,0.0,1.0);`,` if(t<${f(stops[0][0])})return ${v(stops[0])};`];
    for(let i=0;i<stops.length-1;i++){
     const a=stops[i],b=stops[i+1],prev=stops[Math.max(0,i-1)],after=stops[Math.min(stops.length-1,i+2)];
     body.push(` if(t<${f(b[0])}){float u=clamp((t-${f(a[0])})/${f(b[0]-a[0]||1)},0.0,1.0);`);
     if(p.interpolation===0)body.push(`return ${v(a)};}`);
     else if(p.interpolation===3)body.push(`return clamp(0.5*(2.0*${v(a)}+(-${v(prev)}+${v(b)})*u+(2.0*${v(prev)}-5.0*${v(a)}+4.0*${v(b)}-${v(after)})*u*u+(-${v(prev)}+3.0*${v(a)}-3.0*${v(b)}+${v(after)})*u*u*u),0.0,1.0);}`);
     else body.push(`return mix(${v(a)},${v(b)},${p.interpolation===2?"u*u*(3.0-2.0*u)":"u"});}`);
    }
    body.push(`return ${v(stops[stops.length-1])};}`);functions.push(body.join("\n"));
    add("color",`${name}(${num("factor")})`);add("alpha",scalar(`${outs.color}.a`));break;
   }
   case "separateRGB":case "separateHSV":{
    const value=node.type==="separateRGB"?col("color"):`ne_hsv(${col("color")})`;
    spec.outputs.forEach((o,i)=>add(o.id,scalar(`(${value})[${i}]`)));break;
   }
   case "combineRGB":case "combineHSV":{
    const keys=node.type==="combineRGB"?["r","g","b"]:["h","s","v"],v=`vec3(${keys.map(num).join(",")})`;out(rgb(node.type==="combineRGB"?v:`ne_rgb(${v})`));break;
   }
   case "hue":out(rgb(`ne_rgb(ne_hsv(${col("color")})*vec3(1.0,${num("saturation")},${num("value")})+vec3(${num("hue")},0.0,0.0))`));break;
   case "brightness":out(rgb(`(${col("color")}-0.5)*(1.0+${num("contrast")})+0.5+${num("brightness")}`));break;
   case "levels":out(rgb(`mix(vec3(${num("outBlack")}),vec3(${num("outWhite")}),pow(clamp((${col("color")}-${num("black")})/max(${num("white")}-${num("black")},1.0e-12),0.0,1.0),vec3(1.0/max(${num("gamma")},1.0e-6))))`));break;
   case "invert":out(rgb(`mix(${col("color")},1.0-${col("color")},clamp(${num("factor")},0.0,1.0))`));break;
   case "output":{
    if(!incoming.has(nodeId+":color"))cost(1);
    const color=input("color","ne_sample(vUv)"),alpha=num("alpha");
    lines.push(` float ne_alpha=clamp(${alpha},0.0,1.0);`,` gl_FragColor=vec4((${color}).rgb*ne_alpha,ne_alpha);`);break;
   }
   default:{
    if(!compileSampling(node,{input,num,col,add,functions,cost,allocate:prefix=>"ne_"+prefix+(counter++)}))throw new Error(node.id+": unsupported node.");
    if(outs.color) {add("alpha",scalar(`${outs.color}.a`));if(node.type==="edge")add("out",scalar(`${outs.color}.x`));}
   }
  }
  vars.set(nodeId,outs);return outs;
 }
 emit(graph.nodes.find(n=>n.type==="output").id);
 const time=graph.nodes.some(n=>n.type==="time");
 const uniforms=parameters.map(p=>`uniform ${["float","vec3","vec2"][p.kind]} ${p.uniform};`);
 if(time)uniforms.push("uniform float ne_time;");
 const shader=header+uniforms.join("\n")+"\n"+functions.join("\n")+"\nvoid main(){\n"+lines.join("\n")+"\n}\n";
 if(shader.length>model.MAX_BYTES)throw new Error("Compiled Node Effect exceeds the shader size limit.");
 return {graph,shader:model.embed(shader,graph),parameters,time,samples};
}
module.exports={compile,literal};
