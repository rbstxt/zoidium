"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {compile}=require("../plugins/shape-plus/compiler");
const {withinCpuBudget}=require("./cpu-budget.cjs");
const {createModel}=require("../plugins/shape-plus/model");
const {PZ}=require("./shape-plus-host");
const {Content}=createModel(PZ);
const {values}=require("../plugins/shape-plus/editor-geometry");
const channel=value=>({animated:false,keyframes:[{frame:0,value,tween:1}]});
const enums=new Set(["cap","join","dashPairs","waveUnits","mode"]);
const properties=p=>Object.fromEntries(Object.entries(p).map(([k,v])=>[k,enums.has(k)?v:channel(v)]));
function fixture(n,style={},modifier) {
  const vertices=Array.from({length:n},(_,i)=>{
    const t=i/(n-1)*Math.PI*2.3,r=380+40*Math.sin(5*t);
    const d=[-r*1.6*Math.sin(t)*.05,r*.8*Math.cos(t)*.05];
    return {point:[960+r*1.6*Math.cos(t),540+r*.8*Math.sin(t)],in:d.map(v=>-v),out:d};
  });
  const path={kind:"path",id:"path",vertexIds:vertices.map((_,i)=>"v"+i),properties:{closed:0,path:{objects:values(vertices).map(channel)}}};
  const items=[path,...(modifier?[{kind:modifier,id:"modifier",properties:{}}]:[]),{kind:"stroke",id:"stroke",properties:properties({width:30,cap:"round",join:"round",...style})}];
  return items.map(item=>{const c=new Content(item.kind,item);c.load(item);return c.evaluate(0);});
}
for(const n of [60,256])for(const [name,style]of Object.entries({plain:{},dash:{dashPairs:1,dash1:20,gap1:10},squareBevel:{dashPairs:1,cap:"square",join:"bevel"},wave:{waveAmount:11,waveUnits:"length",wavelength:100},taper:{startLength:35,endLength:35},wide:{width:200}})) {
  test(`${n} vertex ${name} stroke has bounded, nonempty paint coverage`,()=>{
    const items=fixture(n,style),r=withinCpuBudget(()=>compile(items,.125/4),250,"compile");
    assert.ok(r.commands.length);assert.ok(r.commands[0].positions.length);
    if(r.commands[0].coverage)assert.equal(r.commands[0].positions.length,18,"paint quad has disjoint interiors");
  });
}
for(const modifier of ["trim","zigZag","wigglePaths"])for(const n of [60,256])test(`${modifier} on ${n} vertices keeps rendering`,()=>{
  const r=compile(fixture(n,{},modifier),.03125);assert.ok(r.commands[0]?.positions.length);
});
test("paint failure leaves another paint intact and valid content recovers",()=>{
  const items=fixture(60);const valid={...items.at(-1),id:"valid",properties:{...items.at(-1).properties,width:10}};
  Object.assign(items.at(-1).properties,{dashPairs:1,dash1:0,gap1:0});
  const result=compile([...items,valid],.03125);
  assert.ok(result.commands.find(c=>c.id==="valid")?.positions.length);
  items.at(-1).properties.dashPairs=0;
  assert.ok(compile(items,.03125).commands[0]?.positions.length);
});
test("layer build catches invalid geometry and automatically recovers",()=>{
  const {createLayerClass}=require("../plugins/shape-plus/layer");
  const Layer=createLayerClass({layer:class{}},null,null);
  let fail=true,commands;
  const layer={type:"test",frame:0,signature:null,buildCount:0,contents:[{evaluate(){if(fail)throw Error("invalid geometry");return fixture(60)[0];}}, {evaluate(){return fixture(60).at(-1);}}],parentProject:{sequence:{properties:{rate:{get:()=>30}}}},properties:{resolution:{get:()=>[1920,1080]}},engine:{setCommands(value){commands=value;}}};
  layer.tryGetParentOfType = () => layer.parentProject;
  assert.doesNotThrow(()=>Layer.prototype.build.call(layer,.03125));assert.deepEqual(commands,[]);
  fail=false;Layer.prototype.build.call(layer,.03125);assert.ok(commands[0]?.positions.length);
  const builds=layer.buildCount;Layer.prototype.build.call(layer,.03125);assert.equal(layer.buildCount,builds);
});
test("native focus detaches selection, excludes static roots and restores original roots",()=>{
  class Static{}class Item{}
  const Host={...PZ,property:{...PZ.property,static:Static}};
  const focus=require("../plugins/shape-plus/native-focus").createFocus(Host,Item);
  const original=new Host.objectList(),selection=new Host.objectList();
  const item=new Item();selection.push(item);
  const panel={selection,objects:original,options:{keyframePanel:{objects:original}}};
  focus.refresh(panel);assert.notEqual(panel.options.keyframePanel.objects,selection);
  const property=new Static();property.parent={};property.parentObject=item;
  selection.splice(0,1,property);assert.deepEqual(Array.from(panel.options.keyframePanel.objects),[item]);
  focus.refresh(panel);assert.equal(panel.options.keyframePanel.objects.length,0);
  selection.splice(0,1);focus.refresh(panel);assert.equal(panel.options.keyframePanel.objects,original);
});
test("selectItems patch tolerates drag selection of static rows and leaves native selection alone",()=>{
  const {install}=require("../plugins/shape-plus/native-ui");
  const previousWindow=global.window,previousDocument=global.document;
  class Item{}class Static{}
  class Edit {
    selectItems(){this.selection.splice(0,this.selection.length,...this.rows);}
  }
  const Host={...PZ,property:{...PZ.property,static:Static},ui:{edit:Edit,timeline:{keyframes:class{}}}};
  Host.ui.timeline.keyframes.prototype.createKeyframeTrack=()=>({});
  global.window={};global.document={querySelectorAll:()=>[],createElement:()=>({remove(){}}),head:{appendChild(){}}};
  const dispose=[];
  try {
    install(Host,class{},Item,fn=>dispose.push(fn));
    const panel=new Edit(),original=new PZ.objectList(),selected=new PZ.objectList();
    let roots=original;
    panel.options={keyframePanel:{get objects(){return roots;},set objects(value){assert.ok(!Array.from(value||[]).some(x=>x instanceof Static));roots=value;}}};
    panel.selection=selected;panel.objects=original;panel.rows=[new Item()];
    panel.selectItems();assert.notEqual(roots,selected);
    const staticRow=new Static();staticRow.parent={};staticRow.parentObject=panel.rows[0];
    panel.rows=[staticRow];assert.doesNotThrow(()=>panel.selectItems());assert.equal(roots.length,0);
    panel.rows=[];panel.selectItems();assert.equal(roots,original);
    panel.rows=[{}];panel.selectItems();assert.equal(roots,original);
  } finally {
    for(const fn of dispose.reverse())fn();
    global.window=previousWindow;global.document=previousDocument;
  }
});

test("legacy and coverage strokes have the same analytic round-capped boundary",()=>{
  const {legacyStroke,outlines}=require("../plugins/shape-plus/stroke");
  const fast=require("../plugins/shape-plus/stroke-scalable").stroke;
  const paths=[{closed:false,points:[[0,0],[200,0]]}],style={width:30,cap:"round",join:"round",miterLimit:4};
  const area=positions=>{let sum=0;for(let i=0;i<positions.length;i+=9)sum+=Math.abs((positions[i+3]-positions[i])*(positions[i+7]-positions[i+1])-(positions[i+4]-positions[i+1])*(positions[i+6]-positions[i]))/2;return sum;};
  assert.ok(Math.abs(area(legacyStroke(paths,style,.001))-(6000+Math.PI*225))<.1);
  const result=fast(paths,style,.001);
  assert.ok(result.coverage.length);assert.equal(result.length,18);
  // The coverage fan comes from the exact old segment, cap and join polygons.
  assert.equal(result.coverage.length/9,outlines(paths,style,.001).reduce((n,p)=>n+p.length-2,0));
});
test("warning deduplication and a fresh compile recover after a deadline",()=>{
  const {bounded}=require("../plugins/shape-plus/geometry-budget");
  const {report}=require("../plugins/shape-plus/geometry-failure");
  const old=console.warn,warnings=[];console.warn=value=>warnings.push(value);
  try {
    report("deadline-test",Error("failure"));report("deadline-test",Error("failure"));
    assert.equal(warnings.length,1);
    assert.doesNotThrow(()=>bounded(()=>compile(fixture(256),.03125),0));
    assert.ok(compile(fixture(60),.03125).commands[0]?.positions.length);
  }finally{console.warn=old;}
});
for(const n of [60,256])test(`${n} vertices support three dash pairs, offset, taper and wave together`,()=>{
  const items=fixture(n,{width:200,dashPairs:3,dash1:20,gap1:40,dash2:30,gap2:45,dash3:10,gap3:50,dashOffset:17,startLength:25,endLength:25,waveAmount:11,waveUnits:"length",wavelength:100},"zigZag");
  const result=withinCpuBudget(()=>compile(items,.03125),250,"complex compile");
  assert.ok(result.commands[0]?.positions.length);
});
test("128 repeated dense strokes share one coverage array and retain independent paint quads",()=>{
  const items=fixture(60,{dashPairs:1});
  const repeater=new Content("repeater",{id:"copies"});repeater.load({id:"copies",kind:"repeater",properties:properties({copies:128,position:[2,0]})});
  items.push(repeater.evaluate(0));
  const result=withinCpuBudget(()=>compile(items,.03125),250,"repeated stroke compile");
  assert.equal(result.commands.length,128);
  assert.equal(new Set(result.commands.map(c=>c.coverage)).size,1);
  assert.ok(result.commands.every(c=>c.positions.length===18&&c.coverageMatrix));
});
