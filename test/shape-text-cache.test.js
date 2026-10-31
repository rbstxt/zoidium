"use strict";
const {test}=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs");
const {fontId,layoutKey,createCache}=require("../plugins/shape-plus/text-cache");
const geometry=require("../plugins/shape-plus/text-geometry"),{compile}=require("../plugins/shape-plus/compiler");
const {expandText}=require("../plugins/shape-plus/text-paths");
const host=require("./shape-plus-host").PZ;
function fakeFont(){return {axes:{wght:{default:400}},coordinates:values=>({wght:values.wght??400})};}
test("layout and glyph keys include font identity, axes, size, tracking and tolerance",()=>{
 const a=fakeFont(),b=fakeFont(),p={sourceText:"A",fontSize:20,tracking:0,axis_wght:400};
 assert.equal(fontId(a),fontId(a));assert.notEqual(fontId(a),fontId(b));
 assert.equal(layoutKey(a,null,p),layoutKey(a,null,{...p,name:"Renamed",enabled:0}));
 for(const [key,value]of Object.entries({sourceText:"V",fontSize:21,tracking:10,axis_wght:500}))assert.notEqual(layoutKey(a,null,p),layoutKey(a,null,{...p,[key]:value}));
 assert.notEqual(layoutKey(a,null,p),layoutKey(b,null,p));assert.notEqual(layoutKey(a,null,p),layoutKey(a,b,p));
 const glyph={font:a,g:1,coordinates:{wght:400},scaleX:1,scaleY:1};
 assert.notEqual(geometry.geometryKey(glyph,.125),geometry.geometryKey(glyph,.0625));
 assert.notEqual(geometry.geometryKey(glyph,.125),geometry.geometryKey({...glyph,coordinates:{wght:900}},.125));
});
test("derived caches evict by accounted bytes and do not retain unbounded keys",()=>{
 const cache=createCache(500);cache.set("a",1,150);cache.set("b",2,150);assert.equal(cache.get("a"),1);cache.set("c",3,150);
 assert.equal(cache.get("b"),undefined);assert.equal(cache.get("a"),1);assert.ok(cache.stats().bytes<=500);
 for(let i=0;i<1000;i++)cache.set(String(i),i,100);assert.ok(cache.stats().bytes<=500);cache.clear();assert.equal(cache.stats().bytes,0);
});
const rectangle=(x,y,w=10,h=10)=>({closed:true,points:[[x,y],[x+w,y],[x+w,y+h],[x,y+h]]});
function batch(x,y=0){return {key:"rect",x,y,canonical:[rectangle(0,0)]};}
function paths(batches){return batches.flatMap(b=>b.canonical.map(p=>({...p,textGlyph:b,textOrigin:true,points:p.points.map(p=>[p[0]+b.x,p[1]+b.y])})));}
test("per-glyph fill rejects intersections, containment and touching for both winding rules",()=>{
 for(const rule of ["nonzero","even-odd"]){
  assert.ok(geometry.glyphFill(paths([batch(0),batch(20)]),rule));
  assert.equal(geometry.glyphFill(paths([batch(0),batch(5)]),rule),null);
  assert.equal(geometry.glyphFill(paths([batch(0),batch(10)]),rule),null);
  // Identical rectangles share every edge; a shared edge or corner touches.
  assert.equal(geometry.glyphFill(paths([batch(0),batch(0)]),rule),null);
  assert.equal(geometry.glyphFill(paths([batch(10),batch(10)]),rule),null);
  const corner={key:"corner",x:10,y:10,canonical:[rectangle(0,0)]};assert.equal(geometry.glyphFill(paths([batch(0),corner]),rule),null);
  const inner={key:"inner",x:2,y:2,canonical:[rectangle(0,0,3,3)]};assert.equal(geometry.glyphFill(paths([batch(0),inner]),rule),null);
 }
 const sloped={key:"triangle",x:20,y:0,canonical:[{closed:true,points:[[0,0],[10,0],[5,10]]}]};
 assert.equal(geometry.glyphFill(paths([batch(0),sloped]),"nonzero"),null);
 assert.equal(geometry.glyphFill(paths([batch(0),batch(20)]),"nonzero","gradientFill"),null);
});
test("text slab sweep produces the original compound vertices including crossings and holes",()=>{
 const old=require("../plugins/shape-plus/fill").triangulate,fast=require("../plugins/shape-plus/text-fill").triangulate;
 let seed=1;const random=()=>((seed=Math.imul(seed,1664525)+1013904223>>>0)/2**32);
 for(let i=0;i<60;i++){
  const contours=Array.from({length:3},()=>Array.from({length:6},()=>[random()*40,random()*40]));
  for(const rule of ["nonzero","even-odd"])assert.deepEqual(fast(contours,rule),old(contours,rule));
 }
});
test("layout reuse, frame order and font-file replacement remain deterministic",async()=>{
 class PropertyList extends host.propertyList{add(key,definition){this[key]=new host.property(definition);this[key].parent=this;}remove(key){delete this[key];}}
 const bytes=fs.readFileSync("test/fixtures/shape-text/RobotoFlex-subset.ttf");let file=new Blob([bytes]),disposed;
 const asset={source:1,get file(){return file;}},project={assets:{load:()=>asset,unload(){}}};
 const PZ={...host,propertyList:PropertyList,project:class{},asset:{type:{FONT:1},source:{FILE:1},font:class{constructor(asset){this.asset=asset;}}}};
 const {createService}=require("../plugins/shape-plus/text-service");
 const service=createService({PZ,getAsset:(_,name)=>fs.readFileSync(name,"utf8"),lifecycle:{onDispose:fn=>{disposed=fn;}}});
 const {Content}=require("../plugins/shape-plus/model").createModel(PZ,service),node=new Content("text");node.tryGetParentOfType=()=>project;
 node.load({properties:{font:"fixture",sourceText:"AV office"}});await node.prepare(0);
 const a=node.evaluate(0);assert.equal(node.evaluate(0).textLayout,a.textLayout);assert.ok(JSON.stringify(a).length<5000);
 node.properties.axis_wght.data={animated:true,keyframes:[{frame:0,value:100,tween:1},{frame:30,value:900,tween:1}]};
 const first=node.evaluate(0),last=node.evaluate(30);assert.notEqual(first.textLayout,last.textLayout);assert.equal(node.evaluate(0).textLayout,first.textLayout);
 const replacement=fs.readFileSync("test/fixtures/shape-text/CFF2-test.otf");
 file=new Blob([replacement]);await node.prepare(0);const replaced=node.evaluate(0).textLayout;assert.notEqual(replaced,first.textLayout);assert.notDeepEqual(replaced.glyphs[0].paths,first.textLayout.glyphs[0].paths);node.unload();disposed();
});
function region(commands){const paints=commands.filter(c=>c.kind==="paint");return Array.from({length:1600},(_,i)=>{const x=(i%80)*5+.371,y=Math.floor(i/80)*5+.229;return paints.map(c=>{const p=c.positions;for(let j=0;j<p.length;j+=9){const cross=(a,b,px,py)=>(p[b]-p[a])*(py-p[a+1])-(p[b+1]-p[a+1])*(px-p[a]);const signs=[cross(j,j+3,x,y),cross(j+3,j+6,x,y),cross(j+6,j,x,y)];if(signs.every(v=>v>=0)||signs.every(v=>v<=0))return 1;}return 0;}).join("");});}
test("Trim and Repeater order cannot reuse pre-modifier glyph fill geometry",async()=>{
 const {createLoader}=require("../plugins/shape-plus/text-engine"),{layoutText}=require("../plugins/shape-plus/text-layout");
 const engine=await createLoader((_,name)=>fs.readFileSync(name,"utf8"),name=>require("../plugins/shape-plus/"+name))();
 const bytes=fs.readFileSync("test/fixtures/shape-text/RobotoFlex-subset.ttf"),font=engine.open(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.length),"fixture");
 const {Content}=require("../plugins/shape-plus/model").createModel(host,{evaluate:(_,p)=>layoutText(font,null,p)});
 const make=(kind,p={})=>{const node=new Content(kind);node.load({properties:p});return node.evaluate(0);};
 const text=make("text",{sourceText:"A V"}),fill=make("fill"),trim=make("trim",{mode:"individual",end:{animated:false,keyframes:[{frame:0,value:75,tween:1}]}}),repeat=make("repeater");
 const cases=[[text,trim,repeat,fill],[text,repeat,trim,fill],[text,fill,repeat,trim]];
 for(const contents of cases){const optimized=compile(contents),reference=compile(expandText(contents));assert.deepEqual(region(optimized.commands),region(reference.commands));}
 assert.notDeepEqual(region(compile(cases[0]).commands),region(compile(cases[1]).commands));font.dispose();
});
test("keyed fonts stay loaded across scrubs and release when their keys are removed",async()=>{
 class PropertyList extends host.propertyList{add(key,definition){this[key]=new host.property(definition);this[key].parent=this;}remove(key){delete this[key];}}
 const bytes=fs.readFileSync("test/fixtures/shape-text/RobotoFlex-subset.ttf"), assets={a:{source:1,file:new Blob([bytes])},b:{source:1,file:new Blob([bytes])}},loads=[],unloads=[];
 const project={assets:{load(ref){loads.push(ref);return assets[ref];},unload(asset){unloads.push(asset);}}};
 const PZ={...host,propertyList:PropertyList,project:class{},asset:{type:{FONT:1},source:{FILE:1},font:class{constructor(asset){this.asset=asset;}}}};
 let dispose;const service=require("../plugins/shape-plus/text-service").createService({PZ,getAsset:(_,name)=>fs.readFileSync(name,"utf8"),lifecycle:{onDispose:fn=>{dispose=fn;}}});
 const node=new (require("../plugins/shape-plus/model").createModel(PZ,service).Content)("text");node.tryGetParentOfType=()=>project;
 node.load({properties:{font:{animated:true,keyframes:[{frame:0,value:"a",tween:0},{frame:30,value:"b",tween:0}]}}});
 await node.prepare(0);await node.prepare(30);await node.prepare(0);assert.deepEqual(loads,["a","b"]);assert.equal(unloads.length,0);
 node.properties.font.data.keyframes.pop();await node.prepare(0);assert.deepEqual(unloads,[assets.b]);
 node.unload();assert.deepEqual(unloads,[assets.b,assets.a]);dispose();
});
test("releasing a preset decoder does not emit an asset deletion outside history",async()=>{
 class PropertyList extends host.propertyList{add(key,definition){this[key]=new host.property(definition);this[key].parent=this;}remove(key){delete this[key];}}
 const file=new Blob([fs.readFileSync("test/fixtures/shape-text/RobotoFlex-subset.ttf")]),asset={source:2,file,references:0};let removed=0,dispose;
 const project={assets:{load(){asset.references++;return asset;},unload(){removed++;}}};
 const PZ={...host,propertyList:PropertyList,project:class{},asset:{type:{FONT:1},source:{FILE:1},font:class{constructor(a){this.asset=a;}}}};
 const service=require("../plugins/shape-plus/text-service").createService({PZ,getAsset:(_,name)=>fs.readFileSync(name,"utf8"),lifecycle:{onDispose:fn=>{dispose=fn;}}});
 const node=new (require("../plugins/shape-plus/model").createModel(PZ,service).Content)("text");node.tryGetParentOfType=()=>project;node.load({properties:{font:"preset"}});
 await node.prepare(0);assert.equal(asset.references,1);node.unload();assert.equal(asset.references,0);assert.equal(removed,0);dispose();
});
