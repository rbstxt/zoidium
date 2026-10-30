"use strict";
const {test}=require("node:test"),assert=require("node:assert/strict");
const {PZ}=require("./shape-plus-host"),{createModel,clone}=require("../plugins/shape-plus/model");
const {holdValue}=require("../plugins/shape-plus/text-properties");
test("Source Text holds keys even when incoming keys have numeric tweens",()=>{
 const {Content}=createModel(PZ);const node=new Content("text");
 node.load({properties:{sourceText:{animated:true,keyframes:[{frame:0,value:"A",tween:1},{frame:30,value:"日本語",tween:1}]}}});
 assert.equal(node.evaluate(15).properties.sourceText,"A");assert.equal(node.evaluate(30).properties.sourceText,"日本語");
 assert.equal(node.properties.name.get(),"日本語");
 assert.equal(holdValue({expression:{},get:frame=>"frame "+frame},12),"frame 12");
 const saved=clone(node),restored=new Content("text");restored.load(saved);assert.deepEqual(clone(restored),saved);
 assert.equal(restored.evaluate(15).properties.sourceText,"A");
});
test("text retains font references, paragraph properties and unknown axis channels",()=>{
 const {Content}=createModel(PZ);const node=new Content("text");
 const data={id:"text",properties:{font:"font-ref",fallbackFont:"jp-ref",textMode:"box",alignment:"justifyLeft",axis_wght:{animated:true,keyframes:[{frame:0,value:100,tween:1},{frame:30,value:900,tween:1}]}}};
 node.load(data);const saved=clone(node);assert.equal(saved.properties.font,"font-ref");assert.equal(saved.properties.fallbackFont,"jp-ref");
 assert.deepEqual(saved.properties.axis_wght,data.properties.axis_wght);
});
