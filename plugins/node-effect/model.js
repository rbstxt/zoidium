"use strict";
const {types} = require("./catalogue.js");
const MARKER = "// @zoidium-node-effect ";
const MAX_NODES = 128, MAX_LINKS = 256, MAX_BYTES = 196608;
const clone = value => JSON.parse(JSON.stringify(value));
function validate(source) {
 if (!source || typeof source !== "object" || source.version !== undefined && source.version !== 1) throw new Error("Unsupported Node Effect graph version.");
 if (!Array.isArray(source.nodes) || !Array.isArray(source.links) || source.nodes.length > MAX_NODES || source.links.length > MAX_LINKS) throw new Error("Node Effect is limited to 128 nodes and 256 links.");
 if (JSON.stringify(source).length > MAX_BYTES) throw new Error("Node Effect graph is too large.");
 const ids = new Set();
 const nodes = source.nodes.map(n=>{
  if (!n || typeof n.id!=="string" || !/^[\w-]{1,64}$/.test(n.id) || ids.has(n.id) || !Object.hasOwn(types,n.type)) throw new Error("Invalid or duplicate Node Effect node.");
  ids.add(n.id);
  const spec=types[n.type], params={};
  for (const p of spec.params) {
   let v = n.params?.[p.id] ?? p.default;
   if (p.control === "number") { if (typeof v!=="number" || !Number.isFinite(v) || Math.abs(v)>1e8) throw new Error(n.id+": invalid "+p.label+"."); }
   else if (p.control === "select") { if (!Number.isInteger(v)||v<0||v>=p.options.length) throw new Error(n.id+": invalid "+p.label+"."); }
   else if (p.control === "color") { if(typeof v!=="string" || !/^#[0-9a-f]{6}$/i.test(v)) throw new Error(n.id+": invalid color."); }
   else if (p.control === "text") { if(typeof v!=="string" || v.length>48) throw new Error(n.id+": name must be at most 48 characters."); }
   else if (p.control === "ramp") {
    if(!Array.isArray(v)||v.length<2||v.length>32||v.some(s=>!Array.isArray(s)||s.length!==5||s.some(x=>!Number.isFinite(x)||x<0||x>1))) throw new Error(n.id+": use 2 to 32 valid color stops.");
    v=clone(v).sort((a,b)=>a[0]-b[0]);
   }
   if(p.id==="taps" && (!Number.isInteger(v)||v<1||v>32))throw new Error(n.id+": Samples must be an integer from 1 to 32.");
   params[p.id]=v;
  }
  return {id:n.id,type:n.type,x:Number.isFinite(n.x)?n.x:0,y:Number.isFinite(n.y)?n.y:0,params};
 });
 const byId=new Map(nodes.map(n=>[n.id,n])), destinations=new Set();
 const links=source.links.map((l,i)=>{
  const a=byId.get(l?.from?.node),b=byId.get(l?.to?.node),key=l?.to?.node+":"+l?.to?.port;
  if(!a||!b||!types[a.type].outputs.some(p=>p.id===l.from.port)||!types[b.type].inputs.some(p=>p.id===l.to.port)||destinations.has(key)) throw new Error("Invalid Node Effect connection.");
  destinations.add(key);return {id:"l"+i,from:{node:a.id,port:l.from.port},to:{node:b.id,port:l.to.port}};
 });
 if(nodes.filter(n=>n.type==="output").length!==1) throw new Error("Node Effect needs exactly one Output node.");
 const state=new Map();
 function visit(id) {if(state.get(id)===1) throw new Error("Node Effect connections cannot form a cycle.");if(state.get(id)===2)return;state.set(id,1);for(const l of links)if(l.to.node===id)visit(l.from.node);state.set(id,2);}
 for(const n of nodes) visit(n.id);
 return {version:1,nodes,links};
}
function embed(shader,graph) { return shader.trimEnd()+"\n"+MARKER+JSON.stringify(validate(graph))+"\n"; }
function extract(shader) {
 if(typeof shader!=="string" || shader.length>MAX_BYTES*3) throw new Error("Invalid Node Effect shader.");
 const i=shader.lastIndexOf("\n"+MARKER); if(i<0) return null;
 const text=shader.slice(i+1+MARKER.length).split("\n",1)[0].trim();
 if(text.length>MAX_BYTES) throw new Error("Node Effect graph is too large.");
 return validate(JSON.parse(text));
}
function initialGraph() {
 return validate({nodes:[{id:"input",type:"layer",x:0,y:0},{id:"output",type:"output",x:320,y:0}],links:[{from:{node:"input",port:"color"},to:{node:"output",port:"color"}},{from:{node:"input",port:"alpha"},to:{node:"output",port:"alpha"}}]});
}
function uniformName(node) {
 const encoded=Array.from(node.id).map(c=>c.charCodeAt(0).toString(16).padStart(2,"0")).join("");
 return "ne_"+encoded;
}
function parameters(graph) {
 return graph.nodes.filter(n=>n.type==="parameter").map(n=>({id:n.id,uniform:uniformName(n),label:n.params.name.trim()||"Parameter",kind:n.params.kind,value:n.params.kind===1?[1,3,5].map(i=>parseInt(n.params.color.slice(i,i+2),16)/255):n.params.kind===2?[n.params.x,n.params.y]:n.params.value,min:Math.min(n.params.min,n.params.max),max:Math.max(n.params.min,n.params.max)}));
}
module.exports={MARKER,MAX_NODES,MAX_LINKS,MAX_BYTES,validate,embed,extract,initialGraph,uniformName,parameters,clone};
