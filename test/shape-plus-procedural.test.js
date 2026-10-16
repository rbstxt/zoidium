"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { trim, dash, widthAt, roundCorners } = require("../plugins/shape-plus/operators.js");
const { colorAt, stops } = require("../plugins/shape-plus/paint.js");
const { compile, matrix, transform } = require("../plugins/shape-plus/compiler.js");
const { repeaterCopies } = require("../plugins/shape-plus/compiler-procedural.js");
const { stroke } = require("../plugins/shape-plus/stroke.js");
const { area } = require("../plugins/shape-plus/fill.js");
const { primitivePath } = require("../plugins/shape-plus/primitives.js");
const { flattenPath, lengthTable } = require("../plugins/shape-plus/path.js");
const { createModel } = require("../plugins/shape-plus/model.js");
const { PZ } = require("./shape-plus-host.js");
const line = n => ({ points:[[0,0],[n,0]],closed:false });
const near = (a,b,eps=1e-7)=>assert.ok(Math.abs(a-b)<eps,`${a} != ${b}`);
const length = paths=>paths.reduce((s,p)=>s+lengthTable(p.points,p.closed).total,0);
const meshArea = p=>{let sum=0;for(let i=0;i<p.length;i+=9)sum+=Math.abs(area([p.slice(i,i+2),p.slice(i+3,i+5),p.slice(i+6,i+8)]));return sum;};
const model = data=>{const {Content}=createModel(PZ);return data.map(item=>{const n=new Content(item.kind,item);n.load(item);return n.evaluate(0);});};
const rect = {kind:"rectangle",id:"r",properties:{}};
const fill = id=>({kind:"fill",id,properties:{}});
const op = (kind,properties={})=>({kind,id:kind,properties});
test("dashes have exact lengths, phase wrapping and a closed seam without duplicate caps",()=>{
  const style={dashPairs:1,dash1:10,gap1:5,dashOffset:0,width:2,join:"miter",miterLimit:4,cap:"butt"};
  const pieces=dash([line(40)],style);
  assert.deepEqual(pieces.map(p=>p.points.map(p=>p[0])),[[0,10],[15,25],[30,40]]);
  near(meshArea(stroke([line(40)],style,.001)),60);
  near(meshArea(stroke([line(40)],{...style,cap:"square"},.001)),72);
  near(meshArea(stroke([line(40)],{...style,cap:"round"},.0001)),60+3*Math.PI,.002);
  assert.deepEqual(dash([line(40)],{...style,dashOffset:-3}),dash([line(40)],{...style,dashOffset:12}));
  const square={points:[[0,0],[10,0],[10,10],[0,10]],closed:true};
  const seam=dash([square],{...style,dash1:20,gap1:10,dashOffset:10});
  assert.equal(seam.length,1);near(length(seam),30);
  assert.throws(()=>dash([line(1e8)],{...style,dash1:.001,gap1:.001}),/budget/);
  assert.throws(()=>dash([line(10)],{...style,dash1:0,gap1:0}),/positive/);
});
test("taper and wave use full post-trim length, including dashed fragments",()=>{
  const p={width:20,startLength:50,endLength:25,startWidth:0,endWidth:50};
  near(widthAt(0,100,p),0);near(widthAt(25,100,p),10);near(widthAt(50,100,p),20);near(widthAt(100,100,p),10);
  near(widthAt(25,100,{width:20,waveAmount:50,waveUnits:"cycles",waveCycles:1}),30);
  near(widthAt(25,100,{width:20,waveAmount:50,waveUnits:"length",wavelength:100}),30);
  const p2={...p,dashPairs:1,dash1:10,gap1:10,cap:"butt",join:"round",miterLimit:4};
  const positions=stroke([line(100)],p2,.125);assert.ok(positions.every(Number.isFinite));
  assert.ok(Math.max(...positions.filter((_,i)=>i%3===1))>9);
});
test("trim unequal paths distinguishes simultaneous and individual domains",()=>{
  const paths=[line(100),line(300)],p={start:0,end:50,offset:0};
  assert.deepEqual(trim(paths,{...p,mode:"simultaneous"}).map(p=>length([p])),[50,150]);
  assert.deepEqual(trim(paths,{...p,mode:"individual"}).map(p=>length([p])),[100,100]);
  const square={points:[[0,0],[10,0],[10,10],[0,10]],closed:true};
  const result=trim([square],{start:0,end:50,offset:270});assert.equal(result.length,1);near(length(result),20);assert.equal(result[0].closed,false);
  assert.deepEqual(result,trim([square],{start:0,end:50,offset:-90}));
  assert.equal(trim([square],{start:0,end:100,offset:37})[0].closed,true);
  assert.equal(trim([square],{start:50,end:50,offset:0}).length,0);
});
test("gradient known colors use explicit premultiplied encoded sRGB and stable stop ordering",()=>{
  const value=stops([{position:1,color:"rgba(0,0,255,0)"},{position:0,color:"rgba(255,0,0,1)"}]);
  assert.deepEqual(colorAt(value,0),[1,0,0,1]);assert.deepEqual(colorAt(value,.5),[.5,0,0,.5]);assert.deepEqual(colorAt(value,1),[0,0,0,0]);
  assert.throws(()=>stops(Array(17).fill([0,[1,1,1,1]])),/16/);
});
test("repeater transforms, offsets, ramp and fractional final copy are analytic",()=>{
  const p={copies:3.5,offset:1,anchor:[10,0],position:[100,0],scale:[1,1],rotation:Math.PI/2,startOpacity:1,endOpacity:.4};
  const copies=repeaterCopies(p,matrix);assert.equal(copies.length,4);
  copies.forEach((c,i)=>near(c.opacity,[1,.8,.6,.2][i]));
  const point=transform([20,0],copies[0].matrix);near(point[0],110);near(point[1],10);
  assert.throws(()=>repeaterCopies({...p,offset:.5,scale:[-1,1]},matrix),/nonnegative/);
});
test("paint ordering, modifier dependencies and group scoping matrix",()=>{
  const items=model([rect,fill("one"),fill("two"),op("trim",{end:{animated:false,keyframes:[{frame:0,value:50,tween:1}]}})]);
  const result=compile(items);assert.deepEqual(result.commands.map(c=>c.id),["two","one"]);
  near(meshArea(result.commands[0].positions),20000);
  const nested=model([{kind:"group",id:"g",properties:{},contents:[rect,fill("inner")]},op("trim",{end:{animated:false,keyframes:[{frame:0,value:50,tween:1}]}}),fill("outer")]);
  const compiled=compile(nested);near(meshArea(compiled.commands[0].positions),20000);near(meshArea(compiled.commands[1].positions),20000);
  const above=model([rect,fill("one"),{...fill("two"),properties:{composite:"above"}}]);assert.deepEqual(compile(above).commands.map(c=>c.id),["one","two"]);
  const below=model([fill("one"),rect,op("trim")]);assert.equal(compile(below).commands[0].positions.length,0);
});
test("repeater before paint combines paths; after paint repeats transformed paints",()=>{
  const repeat=op("repeater");
  const before=compile(model([rect,repeat,fill("f")])),after=compile(model([rect,fill("f"),repeat]));
  assert.equal(before.commands.length,1);assert.equal(after.commands.length,3);
  near(meshArea(before.commands[0].positions),80000);near(meshArea(after.commands[0].positions),40000);
  const xs=after.commands.map(c=>Math.min(...c.positions.filter((_,i)=>i%3===0)));assert.deepEqual(xs,[100,0,-100]);
  repeat.properties.composite="above";const reversed=compile(model([rect,fill("f"),repeat]));assert.deepEqual(reversed.commands.map(c=>Math.min(...c.positions.filter((_,i)=>i%3===0))),[-100,0,100]);
});
test("round corners uses authored vertices with tangent circle cubics and half-edge clamps",()=>{
  const cubic=primitivePath({kind:"rectangle",id:"r",properties:{size:[100,100],position:[0,0],roundness:0}});
  const rounded=roundCorners({...flattenPath(cubic,.125),vertices:cubic.vertices},10,.125);
  assert.equal(rounded.vertices.length,8);assert.deepEqual(rounded.vertices[0].point,[-50,-40]);
  near(rounded.vertices[0].out[1],-5.522847498307934);
  const clamped=roundCorners({...flattenPath(cubic,.125),vertices:cubic.vertices},1e8,.125);
  assert.deepEqual(clamped.vertices[0].point,[-50,0]);assert.ok(clamped.points.flat().every(Number.isFinite));
});
test("all new contents serialize and evaluate identically across reloads and shuffled frames",()=>{
  const {Content}=createModel(PZ);
  for(const kind of ["gradientFill","gradientStroke","trim","repeater","roundCorners","stroke"]){
    const n=new Content(kind);n.load({});const data=JSON.parse(JSON.stringify(n));const next=new Content(kind,data);next.load(data);
    assert.deepEqual(JSON.parse(JSON.stringify(next)),data);
    for(const frame of [30,0,7.5,15,0])assert.deepEqual(next.evaluate(frame),n.evaluate(frame));
  }
});
