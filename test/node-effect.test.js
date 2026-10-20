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
test("shader validation links before accepting code and disposes failed shaders",()=>{
 const {createShaderCheck}=require("../plugins/node-effect/shader-check.js");
 for(const fail of ["compile","link",null]) {
  const events=[];
  const gl={VERTEX_SHADER:1,FRAGMENT_SHADER:2,COMPILE_STATUS:3,LINK_STATUS:4,
   createShader:type=>({type}),createProgram:()=>({}),shaderSource(){},compileShader(){},attachShader(){},linkProgram(){events.push("link");},
   getShaderParameter:shader=>fail!=="compile"||shader.type!==2,getShaderInfoLog:()=>"Test compile error",getProgramParameter:()=>fail!=="link",getProgramInfoLog:()=>"Test link error",
   deleteShader(){events.push("shader disposed");},deleteProgram(){events.push("program disposed");},getExtension:()=>({loseContext(){events.push("context disposed");}})};
  const check=createShaderCheck({createElement:()=>({getContext:()=>gl})});
  if(fail)assert.throws(()=>check.check("source"),/Shader/);else check.check("source");
  assert.equal(events.filter(e=>e==="shader disposed").length,2);assert.ok(events.includes("program disposed"));check.dispose();assert.ok(events.includes("context disposed"));
 }
});
test("sampling tap counts and total shader work are bounded",()=>{
 for(let mode=0;mode<4;mode++)assert.equal(compile(graph("blur",{mode,taps:32})).samples,mode<2?25:32);
 assert.throws(()=>compile(graph("blur",{taps:33})),/Samples/);assert.throws(()=>compile(graph("blur",{taps:1.5})),/Samples/);
 const g={nodes:[{id:"o",type:"output"}],links:[]};let last=null;
 for(let i=0;i<11;i++) {
  const blur="blur"+i,mix="mix"+i;g.nodes.push({id:blur,type:"blur",params:{taps:25}},{id:mix,type:"mix"});
  g.links.push({from:{node:blur,port:"color"},to:{node:mix,port:"b"}});
  if(last)g.links.push({from:{node:last,port:"color"},to:{node:mix,port:"a"}});last=mix;
 }
 g.links.push({from:{node:last,port:"color"},to:{node:"o",port:"color"}});assert.throws(()=>compile(g),/256 source samples/);
 assert.equal(compile(graph("edge")).samples,9);assert.equal(compile(graph("sample")).samples,1);
});
test("all recipes validate, round trip and fit the sample budget",()=>{
 const recipes=require("../plugins/node-effect/recipes.js");assert.deepEqual(recipes.map(r=>r.label),["Glow","Chromatic aberration","Displacement by noise","Duotone"]);
 for(const recipe of recipes){const result=compile(recipe.graph);assert.deepEqual(model.extract(result.shader),result.graph);assert.ok(result.samples<=256);}
});
test("blur averages premultiplied source samples and preserves alpha separately",()=>{
 const result=compile(graph("blur",{mode:1,taps:25}));assert.match(result.shader,/sum\+=vec4\(s.rgb\*s.a,s.a\)\*w/);assert.match(result.shader,/sum.rgb\/sum.a/);assert.match(result.shader,/sum.a\/total/);
});
test("native parameter installation uses array-list operations and nonserialized labels",()=>{
 const {install}=require("../plugins/node-effect/parameters.js"),list=[{old:true}];
 const PZ={property:{type:{VECTOR2:1},create(definition){return{definition,properties:{name:{definition:{}},load(value){this.loaded=value;}},load(value){this.loaded=value;},set(value){this.value=value;}};}}};
 const effect={customProperties:list};const data=records(compile(graph("parameter",{kind:2,x:.2,y:.7,name:"Point"})));
 install(PZ,effect,data);assert.equal(list.length,1);assert.deepEqual(list[0].value,[.2,.7]);assert.equal(list[0].definition.name,"Point");assert.equal(Object.hasOwn(JSON.parse(JSON.stringify(list[0].definition)),"name"),false);assert.equal(list[0].properties.name.definition.readOnly,true);assert.equal(effect.fragmentShaderNeedsUpdate,true);
});
