"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),crypto=require("node:crypto"),fs=require("node:fs"),path=require("node:path");
const model=require("../plugins/node-effect/model.js"),{compile}=require("../plugins/node-effect/compiler.js"),{types,mathModes,blendModes,rampSample}=require("../plugins/node-effect/catalogue.js"),{records}=require("../plugins/node-effect/parameters.js");
function graph(type,params={},port) {return {nodes:[{id:"n",type,params},{id:"o",type:"output"}],links:[{from:{node:"n",port:port||types[type].outputs[0].id},to:{node:"o",port:"color"}}]};}
test("every node and option has a stable compiled GLSL golden",()=>{
 const hashes={};
 for(const [type,spec]of Object.entries(types)) {
  if(type==="output")continue;
  const modes=spec.params.find(p=>p.id==="mode")?.options.length||1;
  for(let mode=0;mode<modes;mode++)for(const output of spec.outputs) {
   const {shader}=compile(graph(type,{mode},output.id));
   hashes[type+"-"+mode+"-"+output.id]=crypto.createHash("sha256").update(shader).digest("hex");
  }
 }
 assert.deepEqual(hashes,JSON.parse(fs.readFileSync(path.join(__dirname,"fixtures/node-effect-glsl.json"),"utf8")));
});
test("embedded graph survives JSON save and an existing plugin marker",()=>{
 const result=compile(model.initialGraph());
 const shader=JSON.parse(JSON.stringify({shader:result.shader})).shader;
 assert.deepEqual(model.extract(shader+'// @zoidium-plugin {"id":"node-effect"}\n'),result.graph);
 assert.equal(model.extract("void main(){}"),null);
 assert.throws(()=>model.extract(shader.replace('"version":1','"version":2')),/version/);
 assert.throws(()=>model.extract(shader.replace('"nodes"','"bad"')),/limited/);
});
test("validation rejects cycles, duplicates, bad ports and unbounded graphs",()=>{
 const base=model.initialGraph();assert.throws(()=>model.validate({...base,version:2}),/version/);
 assert.throws(()=>model.validate({...base,nodes:[...base.nodes,base.nodes[0]]}),/duplicate/);
 assert.throws(()=>model.validate({...base,links:[...base.links,base.links[0]]}),/connection/);
 assert.throws(()=>model.validate({...base,links:[{from:{node:"input",port:"bad"},to:{node:"output",port:"color"}}]}),/connection/);
 assert.throws(()=>model.validate({...base,nodes:Array(129).fill(base.nodes[0])}),/limited/);
 assert.throws(()=>model.validate(graph("math",{a:Infinity})),/invalid/);
 assert.throws(()=>model.validate(graph("math",{mode:31})),/invalid/);
 const cycle=graph("math");cycle.links.push({from:{node:"n",port:"out"},to:{node:"n",port:"a"}});assert.throws(()=>model.validate(cycle),/cycle/);
 assert.throws(()=>model.validate(graph("colorRamp",{stops:Array(33).fill([0,0,0,0,1])})),/stops/);
 assert.throws(()=>model.validate({nodes:[{id:"n",type:"__proto__"}],links:[]}),/Invalid/);
});
test("parameter identity survives rename with complete key/tween metadata",()=>{
 const initial=compile(graph("parameter",{name:"Gain"}));
 const first=records(initial)[0];first.keyframes=[{value:.25,frame:0,tween:1,controlPoints:[[-10,0],[10,0]]},{value:2,frame:30,tween:258,continuousTangent:false}];first.animated=true;
 const renamed=compile(graph("parameter",{name:"Exposure"}));const result=records(renamed,[first]);
 assert.equal(result[0].properties.name,first.properties.name);assert.deepEqual(result[0].keyframes,first.keyframes);assert.equal(result[0].type.zoidiumLabel,"Exposure");assert.equal(result[0].animated,true);
 assert.equal(records(compile(graph("parameter",{kind:1})),[first])[0].type.type,4);
});
test("Time is a serialized native expression and parameters are uniforms",()=>{
 const compiled=compile(graph("time"));assert.equal(records(compiled)[0].expression,"time");assert.match(compiled.shader,/uniform float ne_time;/);
 const p=compile(graph("parameter"));assert.match(p.shader,new RegExp("uniform float "+p.parameters[0].uniform+";"));assert.doesNotMatch(p.shader,/#define ne_/);
});
test("compile is deterministic and source sampling uses uvScale with alpha conversion",()=>{
 const a=compile(model.initialGraph());assert.equal(a.shader,compile(a.graph).shader);
 assert.match(a.shader,/texture2D\(tDiffuse,uv\*uvScale\)/);assert.match(a.shader,/p.rgb\/p.a/);assert.match(a.shader,/rgb\*ne_alpha/);
 const positioned=model.clone(a.graph);positioned.nodes[0].x+=20;
 assert.equal(compile(positioned).shader.split(model.MARKER)[0],a.shader.split(model.MARKER)[0]);
});
test("Math and Mix names match Material+ and ramp interpolation has numerical pins",()=>{
 const source=fs.readFileSync(path.join(__dirname,"../plugins/material-plus/graph-buffers.js"),"utf8");
 assert.deepEqual(mathModes,JSON.parse(source.match(/var MATH_MODES = (\[[^;]+\]);/)[1]));
 assert.equal(blendModes.length,19);
 const stops=[[0,0,0,0,.25],[1,1,.5,.25,1]];
 assert.deepEqual(rampSample(stops,.5,1,[]),[.5,.25,.125,.625]);assert.deepEqual(rampSample(stops,.5,0,[]),[0,0,0,.25]);
 assert.deepEqual(rampSample(stops,1,1,[]),[1,.5,.25,1]);
});
test("checked-in default shader matches the compiler",()=>{
 assert.equal(fs.readFileSync(path.join(__dirname,"../plugins/node-effect/default.glsl"),"utf8"),compile(model.initialGraph()).shader);
});
test("parameter default changes update unanimated defaults and preserve animation",()=>{
 const a=compile(graph("parameter",{value:.2})),first=records(a)[0];first.keyframes=[{value:.2,frame:0}];first.animated=false;
 const b=compile(graph("parameter",{value:.8}));assert.equal(records(b,[first])[0].keyframes[0].value,.8);
 first.animated=true;assert.equal(records(b,[first])[0].keyframes[0].value,.2);
 const color=records(compile(graph("parameter",{kind:1,color:"#ff8040"})))[0];assert.deepEqual(color.type.zoidiumDefault,[1,128/255,64/255]);
});
