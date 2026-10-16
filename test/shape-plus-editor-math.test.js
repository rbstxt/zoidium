"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const g = require("../plugins/shape-plus/editor-geometry.js");
const { topology } = require("../plugins/shape-plus/editor-topology.js");
const { evaluate, verticesToCubics } = require("../plugins/shape-plus/path.js");
const points = [{ point: [0,0], in: [0,0], out: [60,90] }, { point: [200,40], in: [-70,120], out: [0,0] }];
const near = (a,b) => assert.ok(Math.hypot(a[0]-b[0],a[1]-b[1]) < 1e-7, `${a} != ${b}`);
function animated() {
  return { id: "path", kind: "path", vertexIds: ["a","b"], vertexModes: {}, properties: { closed: 0, path: { objects: g.values(points).map((value,i) => ({ animated: true, keyframes: [{frame:0,value,tween:7,controlPoints:[[1,2],[3,4]]},{frame:30,value:value+i*2,tween:257,controlPoints:[[5,6],[7,8]]}] })) } } };
}
test("handle, anchor, segment hit priority is fixed in CSS pixels", () => {
  const p = g.vertices(g.values(points)); p[0].out = [200,40];
  assert.equal(g.hit(p,false,[200,40],1).kind,"handle");
  assert.equal(g.hit(p,false,[0,0],1).kind,"anchor");
  const curve = verticesToCubics(points,false)[0];
  assert.equal(g.hit(points,false,evaluate(curve,.5),1).kind,"segment");
  assert.equal(g.hit(points,false,[-5,0],2),null);
  assert.equal(g.hit(points,false,[-3,0],2).kind,"anchor");
});
test("De Casteljau split preserves densely sampled cubic at arbitrary t", () => {
  const curve = verticesToCubics(points,false)[0];
  for (const t of [.001,.13,.5,.913,.999]) {
    const curves = verticesToCubics(g.insert(points,0,t,false),false);
    for (let i=0;i<=1000;i++) { const u=i/1000; near(evaluate(curve,u),u<=t?evaluate(curves[0],u/t):evaluate(curves[1],(u-t)/(1-t))); }
  }
});
test("topology insertion and deletion preserve every key and tween", () => {
  const data=animated(), before=JSON.stringify(data), result=topology(data,{kind:"insert",index:0,t:.37,id:"new"});
  assert.equal(JSON.stringify(data),before); assert.deepEqual(result.vertexIds,["a","new","b"]);
  for(let k=0;k<2;k++) {
    const original=verticesToCubics(g.vertices(data.properties.path.objects.map(c=>c.keyframes[k].value)),false)[0];
    const split=verticesToCubics(g.vertices(result.properties.path.objects.map(c=>c.keyframes[k].value)),false);
    for(let i=0;i<=400;i++) {const u=i/400;near(evaluate(original,u),u<=.37?evaluate(split[0],u/.37):evaluate(split[1],(u-.37)/.63));}
    result.properties.path.objects.forEach(c=>assert.equal(c.keyframes[k].tween,data.properties.path.objects[0].keyframes[k].tween));
  }
  const removed=topology(result,{kind:"delete",ids:["new"]});
  assert.deepEqual(removed.vertexIds,["a","b"]);
  assert.equal(removed.properties.path.objects.length,12);
  assert.equal(topology(removed,{kind:"delete",ids:["a","b"]}),null);
  const reverse=topology(topology(data,{kind:"reverse"}),{kind:"reverse"});assert.deepEqual(reverse,data);
});
test("unsynchronized or expression-driven channels refuse topology without dropping keys", () => {
  const data=animated(); data.properties.path.objects[1].keyframes.pop(); assert.throws(()=>topology(data,{kind:"reverse"}),/Synchronize/);
  data.properties.path.expression="frame";assert.throws(()=>topology(data,{kind:"reverse"}),/Expression/);
});
test("handle constraints and 45 degree constraints", () => {
  const vertex=points[0]; near(g.handle(vertex,"out",[30,40],"symmetric").in,[-30,-40]);
  const v={...vertex,in:[-10,0]}; near(g.handle(v,"out",[30,40],"smooth").in,[-6,-8]);
  near(g.handle(v,"out",[30,40],"independent").in,[-10,0]); near(g.constrain([10,8]),[Math.sqrt(82),Math.sqrt(82)]);
  const corner=g.setMode(points,0,"corner",false);near(corner[0].out,[0,0]);
});
test("snapping prefers anchors, scales threshold by zoom, and has one grid spacing", () => {
  assert.deepEqual(g.snap([48,49],[[47,48]],{enabled:true,scale:2}),[47,48]);
  assert.deepEqual(g.snap([48,49],[],{enabled:true,scale:2}),[50,50]);
  assert.deepEqual(g.snap([45,44],[],{enabled:true,scale:2}),[45,44]);
  assert.deepEqual(g.snap([48,49],[],{enabled:false}),[48,49]);
});
