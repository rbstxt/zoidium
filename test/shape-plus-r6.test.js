"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {compile}=require("../plugins/shape-plus/compiler");
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
    const start=performance.now(),r=compile(fixture(n,style),.125/4);
    assert.ok(r.commands.length);assert.ok(r.commands[0].positions.length);
    assert.ok(performance.now()-start<250,"compile exceeded 250 ms");
    if(r.commands[0].coverage)assert.equal(r.commands[0].positions.length,18,"paint quad has disjoint interiors");
  });
}
for(const modifier of ["trim","zigZag","wigglePaths"])for(const n of [60,256])test(`${modifier} on ${n} vertices keeps rendering`,()=>{
  const r=compile(fixture(n,{},modifier),.03125);assert.ok(r.commands[0]?.positions.length);
});
test("paint failure leaves another paint intact and valid content recovers",()=>{
  const items=fixture(60);const valid={...items.at(-1),id:"valid",properties:{...items.at(-1).properties,width:10}};
  items.at(-1).properties.width=NaN;
  const result=compile([...items,valid],.03125);
  assert.ok(result.commands.find(c=>c.id==="valid")?.positions.length);
  items.at(-1).properties.width=30;
  assert.ok(compile(items,.03125).commands[0]?.positions.length);
});
test("layer build catches invalid geometry and automatically recovers",()=>{
  const {createLayerClass}=require("../plugins/shape-plus/layer");
  const Layer=createLayerClass({layer:class{}},null,null);
  let fail=true,commands;
  const layer={type:"test",frame:0,signature:null,buildCount:0,contents:[{evaluate(){if(fail)throw Error("invalid geometry");return fixture(60)[0];}}, {evaluate(){return fixture(60).at(-1);}}],parentProject:{sequence:{properties:{rate:{get:()=>30}}}},properties:{resolution:{get:()=>[1920,1080]}},engine:{setCommands(value){commands=value;}}};
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
