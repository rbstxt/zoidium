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
test("native list mutations that notify by themselves refresh the text flag",()=>{
 // Native object lists fire onListChanged from their own splice and push,
 // like the panel, undo and paste paths do. This mock notifies without a
 // manual update() call, proving the watcher alone keeps the flag current.
 function live(items=[]){const result=list(items);for(const method of ["push","pop","splice"]) {const original=result[method];result[method]=(...args)=>{const value=original.apply(result,args);result.onListChanged.update();return value;};}return result;}
 const children=live([{kind:"rectangle"}]),root=live([{kind:"group",contents:children}]);
 const state=trackContents(root);
 assert.equal(state.read(),false);assert.equal(state.scans,1);
 children.push({kind:"text"});assert.equal(state.read(),true);assert.equal(state.scans,2);
 children.splice(1,1);assert.equal(state.read(),false);assert.equal(state.scans,3);
 root.splice(0,1);assert.equal(state.read(),false);
 root.push({kind:"text"});assert.equal(state.read(),true);
 state.dispose();
});
