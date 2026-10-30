"use strict";
const {test}=require("node:test"),assert=require("node:assert/strict");
const {PZ}=require("./shape-plus-host"),{createModel,clone}=require("../plugins/shape-plus/model");
const {holdValue}=require("../plugins/shape-plus/text-properties");
test("Source Text holds keys even when incoming keys have numeric tweens",()=>{
 const {Content}=createModel(PZ);const node=new Content("text");
 node.load({properties:{sourceText:{animated:true,keyframes:[{frame:0,value:"A",tween:1},{frame:30,value:"日本語",tween:1}]}}});
 assert.equal(node.properties.sourceText.get(15),"A");
 assert.equal(node.evaluate(15).properties.sourceText,"A");assert.equal(node.evaluate(30).properties.sourceText,"日本語");
 assert.equal(node.properties.name.get(),"日本語");
 assert.equal(holdValue({expression:{},get:frame=>"frame "+frame},12),"frame 12");
 const saved=clone(node),restored=new Content("text");restored.load(saved);assert.deepEqual(clone(restored),saved);
 assert.equal(restored.evaluate(15).properties.sourceText,"A");
});
test("text retains font references, paragraph properties and unknown axis channels",()=>{
 const {Content}=createModel(PZ);const node=new Content("text");
 const data={id:"text",properties:{font:"font-ref",fallbackFont:"jp-ref",textMode:"box",alignment:"justifyLeft",axis_wght:{animated:true,keyframes:[{frame:0,value:100,tween:1},{frame:30,value:900,tween:1}]}}};
 node.load(data);const saved=clone(node);assert.equal(saved.properties.font.keyframes[0].value,"font-ref");assert.equal(saved.properties.fallbackFont.keyframes[0].value,"jp-ref");
 assert.deepEqual(saved.properties.axis_wght,data.properties.axis_wght);
});
test("text controls include the owning clip's offset in local time",()=>{
 const {localFrame}=require("../plugins/shape-plus/text-properties");
 const property={tryGetParentOfType:()=>({start:20,offset:7})};
 assert.equal(localFrame(property,{playback:{currentFrame:30}},{clip:class{}}),17);
});

test("font, style and paragraph choices are native held dynamic channels",()=>{
 const {Content}=createModel(PZ);const node=new Content("text");
 node.load({properties:{font:{animated:true,keyframes:[{frame:0,value:"font-a",tween:1},{frame:30,value:"font-b",tween:1}]},textMode:{animated:true,keyframes:[{frame:0,value:"point",tween:1},{frame:30,value:"box",tween:1}]}}});
 assert.equal(node.evaluate(15).properties.font,"font-a");assert.equal(node.evaluate(30).properties.font,"font-b");
 assert.equal(node.evaluate(15).properties.textMode,"point");assert.equal(node.evaluate(30).properties.textMode,"box");
 for(const key of ["font","fallbackFont","fontStyle","caps","alignment","textMode"])assert.equal(node.properties[key].definition.dynamic,true);
});
test("inactive custom axis keys and expressions survive font switches and save/load",()=>{
 const {axes}=require("../plugins/shape-plus/text-properties");
 class PropertyList extends PZ.propertyList {
  add(key,definition){this[key]=new PZ.property(definition);this[key].parent=this;}
  remove(key){delete this[key];}
 }
 const host={...PZ,propertyList:PropertyList}, {Content}=createModel(host);
 const custom={animated:true,expression:"value + 2",keyframes:[{frame:0,value:3,tween:1},{frame:30,value:7,tween:1}]};
 const node=new Content("text");node.load({properties:{axis_custom:custom}});
 const withAxis={axes:{custom:{min:0,default:1,max:10}},style:"Regular",instances:[]}, without={axes:{},style:"Regular",instances:[]};
 axes(host,node,withAxis);assert.deepEqual(clone(node).properties.axis_custom,custom);
 axes(host,node,without);assert.equal(node.properties.axis_custom,undefined);
 const saved=clone(node);assert.deepEqual(saved.axisStore.axis_custom,custom);
 const restored=new Content("text");restored.load(saved);axes(host,restored,without);assert.deepEqual(clone(restored).axisStore.axis_custom,custom);
 axes(host,restored,withAxis);assert.deepEqual(clone(restored).properties.axis_custom,custom);assert.equal(clone(restored).axisStore,undefined);
});
