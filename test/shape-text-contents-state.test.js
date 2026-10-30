"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {trackContents}=require("../plugins/shape-plus/contents-state");
function list(items=[]){const result=[...items],listeners=new Set();result.onListChanged={watch:fn=>listeners.add(fn),unwatch:fn=>listeners.delete(fn),update:()=>{for(const fn of [...listeners])fn();}};return result;}
test("contents text flag reuses its result and invalidates on nested structural changes",()=>{
 const children=list([{kind:"rectangle"}]),root=list([{kind:"group",contents:children}]);const state=trackContents(root);
 assert.equal(state.read(),false);for(let i=0;i<100;i++)assert.equal(state.read(),false);assert.equal(state.scans,1);
 children.push({kind:"text"});children.onListChanged.update();assert.equal(state.read(),true);assert.equal(state.scans,2);
 children.pop();children.onListChanged.update();assert.equal(state.read(),false);
 root.push({kind:"text"});root.onListChanged.update();assert.equal(state.read(),true);
 state.dispose();
});
