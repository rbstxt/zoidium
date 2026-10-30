"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { host, fixture, editorFor } = require("./helpers/editor-identity-host.cjs");
function setup() {
  const { PZ } = host();
  const { project, layer } = fixture({ PZ });
  const editor = editorFor(PZ, project);
  const property = layer.properties.position.objects[1];
  property.keyframes.push(new PZ.keyframe(20,40,24));
  const gel = { pz_object:property, pz_valueScale:1, _gid:1 };
  const elements = Array.from(property.keyframes, kf => ({pz_object:kf,parentElement:{parentElement:gel},
    classList:{contains:()=>true},pz_handles:{}}));
  elements[0].nextElementSibling=elements[1];elements[1].previousElementSibling=elements[0];
  let move, up;
  PZ.ui.graph = function () {};
  require("../plugins/graph-plus/interaction.js")({PZ,focusNoScroll(){},beginPointerDrag(_el,_e,m,u){move=m;up=u;}});
  require("../plugins/graph-plus/operations.js")({PZ});
  const graph=Object.assign(new PZ.ui.graph(),{editor,propertyOps:new PZ.ui.properties(editor),
    svg:{getBoundingClientRect:()=>({left:0,top:0})},screenToGraph:(x,y)=>({x,y}),
    selectedKeys:()=>[elements[0]],updateHandles(){},refreshAdjacentCurves(){},updateStatus(){},updateViewBox(){}});
  const listeners={};const el={addEventListener:(type,fn)=>{listeners[type]=fn;}};
  graph.attachHandleHandlers(el,1,elements[0]);
  const event=extra=>({button:0,clientX:10,clientY:0,stopPropagation(){},preventDefault(){},...extra});
  return {graph,editor,project,property,elements,listeners,event,sequence(events, start={}){
    listeners.pointerdown(event(start));for(const change of events)move(event({clientX:20,clientY:-4,...change}));up(event(events.at(-1)));
  },drag(extra={}){
    listeners.pointerdown(event(extra));move(event({clientX:20,clientY:-4,...extra}));up(event(extra));
  }};
}
test("preset handle drag converts the segment in exactly one native history step",()=>{
  const s=setup(),before=JSON.stringify(s.project);
  s.drag();const after=JSON.stringify(s.project);
  assert.notEqual(after,before);assert.equal(s.property.keyframes[1].tween,257);
  assert.equal(s.editor.history.undoStack.length,1);
  s.editor.history.undo();assert.equal(JSON.stringify(s.project),before);
  s.editor.history.redo();assert.equal(JSON.stringify(s.project),after);
});
test("live Alt edges break and rejoin handles with one exact native undo step",()=>{
  for (const [initial, start, events, expected] of [
    [true, {}, [{}, {altKey:true}], false],
    [true, {altKey:true}, [{altKey:true}], false],
    [false, {}, [{}, {altKey:true}, {altKey:false}], true],
    [true, {}, [{altKey:true}, {altKey:false}, {altKey:true}], false]
  ]) {
    const s=setup();s.property.keyframes[0].continuousTangent=initial;
    const before=JSON.stringify(s.project);
    s.sequence(events,start);assert.equal(s.property.keyframes[0].continuousTangent,expected);
    const after=JSON.stringify(s.project);assert.equal(s.editor.history.undoStack.length,1);
    s.editor.history.undo();assert.equal(JSON.stringify(s.project),before);
    s.editor.history.redo();assert.equal(JSON.stringify(s.project),after);
  }
});
test("double-click handle reset uses one undo step",()=>{
 const s=setup();s.property.keyframes[0].controlPoints[1]=[20,5];const before=JSON.stringify(s.project);
 s.listeners.dblclick(s.event());assert.equal(s.editor.history.undoStack.length,1);
 assert.equal(JSON.stringify(s.property.keyframes[0].controlPoints),'[[-10,0],[10,0]]');
 s.editor.history.undo();assert.equal(JSON.stringify(s.project),before);
});
test("key value drags change only selected axes and share a delta across normalized axes",()=>{
 for(const grouped of [false,true]){
  const s=setup(),{graph,property,editor}=s;
  const props=Array.from(property.parent.parent.objects);
  const keys=props.map((p,i)=>{
   const gel={pz_object:p,pz_valueScale:i ? .01 : .001,_gid:i};
   return {pz_object:p.keyframes[0],parentElement:{parentElement:gel},classList:{contains:()=>true},
    addEventListener(){}};
  });
  const selected=grouped?keys:[keys[1]];let move,up;
  const PZ={ui:{graph:function(){},properties:{prototype:{setValue:graph.propertyOps.setValue}}}};
  require("../plugins/graph-plus/interaction.js")({PZ,focusNoScroll(){},beginPointerDrag(_el,_e,m,u){move=m;up=u;}});
  // Exercise the drag closure with the native property operations and history.
  graph.selectedKeys=()=>selected;graph.timeKeys=x=>x;graph.updateKeyframe=()=>{};
  graph.snapFrame=x=>Math.round(x);graph.updateLegend=()=>{};
  PZ.ui.graph.prototype.attachKeyframeHandlers.call(graph,keys[1]);
  const before=JSON.stringify(s.project),values=props.map(p=>p.keyframes[0].value);
  keys[1]._g2down(s.event());move(s.event({clientY:-10,ctrlKey:true}));up(s.event());
  assert.deepEqual(props.map((p,i)=>p.keyframes[0].value-values[i]),grouped?[1000,1000]:[0,1000]);
  assert.equal(editor.history.undoStack.length,1);
  editor.history.undo();assert.equal(JSON.stringify(s.project),before);
 }
});

test("Pan tool bypasses key and handle edits",()=>{
 const s=setup();s.graph.tool="pan";const before=JSON.stringify(s.project);
 s.listeners.pointerdown(s.event());assert.equal(s.editor.history.undoStack.length,0);
 assert.equal(JSON.stringify(s.project),before);
});
