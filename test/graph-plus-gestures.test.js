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
  return {graph,editor,project,property,elements,listeners,event,drag(extra={}){
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
test("Alt handle drag breaks and rejoins tangents with exact native undo",()=>{
  const s=setup();
  for(const continuous of [true,false]){
    s.property.keyframes[0].continuousTangent=continuous;
    const before=JSON.stringify(s.project),depth=s.editor.history.undoStack.length;
    s.drag({altKey:true});assert.equal(s.property.keyframes[0].continuousTangent,!continuous);
    const after=JSON.stringify(s.project);
    assert.equal(s.editor.history.undoStack.length-depth,1);
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
