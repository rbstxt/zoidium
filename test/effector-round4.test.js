"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../plugins/scene-plus/effector-core.js");
const { evaluateMesh } = require("../plugins/scene-plus/effector-evaluate.js");
const { capContours, triangulateLoop, buildVoronoiFracture } = require("../plugins/scene-plus/effector-fracture.js");
const { computeSmoothVertexNormals } = require("../plugins/scene-plus/effector-mesh.js");
const { _test } = require("../plugins/scene-plus/scene-plus.js");
const relation = { identity: true };
function base(positions) { return { positions: new Float32Array(positions), count: positions.length / 3, attributes: {}, index: null, groups: [], smooth: false }; }

test("each axis uses the full child bounds, independent of mesh partition", () => {
  const all = new Float32Array([-4,-1,-2,-3,2,1,3,-2,1,4,1,2]);
  const bounds = core.boundsOf(all);
  for (let axis = 0; axis < 3; axis++) for (const kind of ["twist", "warp"]) {
    const fn = kind === "twist" ? core.twistPositions : core.warpPositions;
    const entire = fn(new Float32Array(all), 0.8, axis % (kind === "warp" ? 2 : 3), 0, null, bounds);
    const pieces = [all.slice(0,6), all.slice(6)];
    for (const p of pieces) fn(p, 0.8, axis % (kind === "warp" ? 2 : 3), 0, null, bounds);
    assert.deepEqual(new Float32Array([...pieces[0], ...pieces[1]]), entire);
  }
});

test("Plain moves separate stock Text components rigidly with one shared linear field", () => {
  const source = base([-3,0,0,-2,0,0,-3,1,0,2,0,0,3,0,0,2,1,0]);
  const field = core.fieldForBounds({type:1,position:[0,0,0],scale:[100,100,100],falloff:0,sweep:50}, core.boundsOf(source.positions));
  const command = {kind:"plain",relation,position:[0,5,0],rotation:[0,0,0],scale:[1,1,1],field};
  const result = evaluateMesh({base:source,commands:[command],sourceId:"text",polygonCount:4});
  assert.equal(source.pieceCount,2);
  assert.ok(result.positions[1] > 4.9);
  const refined = core.subdivideStage(source,4);
  for (let i=12;i<result.count;i++) assert.equal(result.positions[i*3+1],refined.positions[i*3+1]);
  assert.equal(result.positions[1] - result.positions[4],0);
});

test("Delay modes replay earlier upstream values and are seekable", () => {
  const source = base([0,0,0,1,0,0,0,1,0]);
  const plain = time => ({kind:"plain",relation,position:[0,time,0],rotation:[0,0,0],scale:[1,1,1],field:{type:0}});
  for (const mode of [0,1,2]) {
    const evaluate = t => evaluateMesh({base:source,sourceId:"delay",polygonCount:1,commands:[plain(t),
      {kind:"delay",relation,mode,strength:1,history:Array.from({length:12},(_,i)=>[plain(Math.max(0,t-i-1))])}]}).positions;
    const expected = evaluate(18);
    for (const time of [2,50,18,0,18]) {
      const result = evaluate(time);
      if (time===18) assert.deepEqual(result,expected);
    }
    assert.ok(expected[1] < 18,"rising motion lags behind its target");
    assert.equal(expected[7]-expected[1],1,"translation keeps each character rigid");
  }
});

test("normal averaging retains a source hard edge while smoothing subdivisions", () => {
  const positions = new Float32Array([0,0,0,1,0,0,0,1,0,0,0,0,0,1,0,0,0,1]);
  const sourceNormals = new Float32Array([0,0,1,0,0,1,0,0,1,1,0,0,1,0,0,1,0,0]);
  const normals = new Float32Array(18);
  computeSmoothVertexNormals({attributes:{position:{array:positions,count:6},normal:{array:normals}},groups:[]},
    {attributes:{normal:{array:sourceNormals}}});
  assert.deepEqual(Array.from(normals.slice(0,3)),[0,0,1]);
  assert.deepEqual(Array.from(normals.slice(9,12)),[1,0,0]);
});

test("planar cap contours preserve a text counter and outward winding", () => {
  const outer = [[-2,-2,0],[2,-2,0],[2,2,0],[-2,2,0]];
  const hole = [[-1,-1,0],[-1,1,0],[1,1,0],[1,-1,0]];
  const caps = capContours([outer,hole],{nx:0,ny:0,nz:1},1e-7,512);
  let area = 0;
  for (const polygon of caps) for (const [a,b,c] of triangulateLoop(polygon,512)) {
    const signed = ((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]))/2;
    assert.ok(signed > 0); area += signed;
    const center = [(a[0]+b[0]+c[0])/3,(a[1]+b[1]+c[1])/3];
    assert.ok(Math.abs(center[0])>=1 || Math.abs(center[1])>=1,"no cap fills the counter");
  }
  assert.ok(Math.abs(area-12)<1e-8);
});

function ring(bevel, depth) {
  const out = [];
  const levels = bevel ? [[0,0],[bevel,-bevel],[depth-bevel,-bevel],[depth,0]] : [[0,0],[depth,0]];
  const corners = r => [[-r,-r],[r,-r],[r,r],[-r,r]];
  const quad = (a,b,c,d) => out.push(...a,...b,...c,...a,...c,...d);
  for (let l=0;l<levels.length-1;l++) for (const inner of [false,true]) {
    const a=corners((inner?1:2)+levels[l][1]*(inner?-1:1)), b=corners((inner?1:2)+levels[l+1][1]*(inner?-1:1));
    for (let i=0;i<4;i++) {
      const j=(i+1)%4, p=[...a[i],levels[l][0]],q=[...a[j],levels[l][0]],r=[...b[j],levels[l+1][0]],s=[...b[i],levels[l+1][0]];
      if(inner) quad(q,p,s,r); else quad(p,q,r,s);
    }
  }
  for (const z of [0,depth]) for(let i=0;i<4;i++) {
    const j=(i+1)%4,o=corners(2),h=corners(1),a=[...o[i],z],b=[...o[j],z],c=[...h[j],z],d=[...h[i],z];
    if(z===0)quad(b,a,d,c);else quad(a,b,c,d);
  }
  return new Float32Array(out);
}

test("bevelled hollow sources stay bounded and closed through both Twist/Fracture orders", () => {
  for (const bevel of [0,0.05]) for (const depth of [0.2,1,3]) {
    const positions=ring(bevel,depth), source=base(positions);
    const twist={kind:"twist",relation,axis:1,angle:0.3,offset:0,field:{type:0}};
    const fracture={kind:"fracture",relation,topology:{cells:8,seed:3,closed:true},motion:{field:{type:0}}};
    for (const commands of [[twist,fracture],[fracture,twist]]) {
      const result=evaluateMesh({base:source,commands,sourceId:"ring",polygonCount:1});
      assert.deepEqual(result.errors,[]);
      assert.ok(result.positions.every(Number.isFinite));
      assert.ok(result.positions.every(v=>Math.abs(v)<5));
    }
    const stage=buildVoronoiFracture({positions},{cells:8,seed:3,closed:true});
    assert.equal(stage.error,undefined);
    const volumes = new Float64Array(stage.pieceCount);
    for (let v=0;v<stage.count;v+=3) {
      const a=Array.from(stage.positions.slice(v*3,v*3+3)), b=Array.from(stage.positions.slice(v*3+3,v*3+6)), c=Array.from(stage.positions.slice(v*3+6,v*3+9));
      const center=a.map((x,i)=>(x+b[i]+c[i])/3);
      assert.ok(Math.max(Math.abs(center[0]),Math.abs(center[1]))>=1-1e-5,"caps stay out of the hollow source counter");
      const cross=[b[1]*c[2]-b[2]*c[1],b[2]*c[0]-b[0]*c[2],b[0]*c[1]-b[1]*c[0]];
      volumes[stage.pieceIds[v]]+=a.reduce((sum,x,i)=>sum+x*cross[i],0)/6;
    }
    assert.ok(volumes.every(v=>v>=-1e-5),"no inverted closed fragment");
    const edges=new Map(), key=v=>Array.from(stage.positions.slice(v*3,v*3+3),x=>Math.round(x*1e5)).join(":");
    for(let v=0;v<stage.count;v+=3)for(let e=0;e<3;e++) {
      const a=key(v+e),b=key(v+(e+1)%3), id=stage.pieceIds[v]+":"+(a<b?a+"|"+b:b+"|"+a);
      edges.set(id,(edges.get(id)||0)+1);
    }
    assert.equal([...edges.values()].filter(n=>n!==2).length,0,`bevel ${bevel}, depth ${depth}`);
  }
});

test("field guides show outer and falloff extents, and infinite fields draw nothing", () => {
  assert.deepEqual(_test.fieldGuidePoints({type:0}),[]);
  for (const type of [1,2,3,4]) {
    const points=_test.fieldGuidePoints({type,position:[2,3,4],rotation:[0,0,0],worldScale:[10,10,10],falloff:50,low:-5,high:5,sweep:50});
    assert.ok(points.length>0);assert.ok(points.every(Number.isFinite));
  }
});

test("field helpers implement CM3's update callback and release resources", () => {
  class Geometry {
    constructor(){this.attributes={};}
    addAttribute(name,a){this.attributes[name]=a;}
    setDrawRange(start,count){this.range={start,count};}
    dispose(){this.disposed=true;}
  }
  class Attribute {constructor(array,itemSize){this.array=array;this.itemSize=itemSize;}}
  class Material {dispose(){this.disposed=true;}}
  class Lines {
    constructor(geometry,material){this.geometry=geometry;this.material=material;this.layers={set:n=>this.layer=n};this.matrix={copy(){}};this.matrixWorld={copy(){}};}
  }
  const Original=class {};
  const T={BoxHelper:Original,LineSegments:Lines,LineBasicMaterial:Material,BufferGeometry:Geometry,BufferAttribute:Attribute};
  const dispose=_test.installFieldHelpers(T);
  const owner={properties:{field:{get:()=>2}},_fieldBounds:{min:[-1,-1,-1],max:[1,1,1]}};
  const helper=new T.BoxHelper({__zoidiumEffectorOwner:owner,matrixWorld:{}});
  assert.equal(typeof helper.update,"function");
  helper.update();assert.ok(helper.geometry.range.count>0);assert.equal(helper.layer,1);
  dispose();assert.equal(T.BoxHelper,Original);assert.equal(helper.geometry.disposed,true);assert.equal(helper.material.disposed,true);
});

test("Delay filters rotation and scale separately without shrinking rotating pieces", () => {
  const source=base([0,0,0,1,0,0,0,1,0,0,0,1]);
  source.index=new Uint16Array([0,2,1,0,1,3,0,3,2,1,2,3]);
  const plain=(rotation,scale)=>({kind:"plain",relation,position:[0,0,0],rotation,scale,field:{type:0}});
  const distance=p=>Math.hypot(p[3]-p[0],p[4]-p[1],p[5]-p[2]);
  const evaluate=(current,previous)=>evaluateMesh({base:source,sourceId:"rigid",polygonCount:1,commands:[current,
    {kind:"delay",relation,mode:1,strength:0.5,history:[[previous]]}]}).positions;
  const rotated=evaluate(plain([0,0,90],[1,1,1]),plain([0,0,0],[1,1,1]));
  assert.ok(Math.abs(distance(rotated)-1)<1e-6,"rotation remains rigid");
  assert.ok(Math.abs(rotated[3]-rotated[0]-Math.SQRT1_2)<1e-6);
  assert.ok(Math.abs(rotated[4]-rotated[1]-Math.SQRT1_2)<1e-6);
  const scaled=evaluate(plain([0,0,0],[4,4,4]),plain([0,0,0],[2,2,2]));
  assert.ok(Math.abs(distance(scaled)-3)<1e-6,"scale lags independently of rotation");
});
