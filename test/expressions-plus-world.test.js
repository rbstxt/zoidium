"use strict";
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {host,core}=require('./expressions-plus-harness');
const {createWorldProvider,projectPoint,unprojectPoint}=require('../plugins/expressions-plus/world');
const {createEvaluator}=require('../plugins/constraints/track-to-evaluate');
const p=value=>({get:()=>value});
function setup(options={}){
 const runtime=host(),THREE=options.THREE||runtime.THREE;class Layer{}class Scene extends Layer{}class Object3D{}class Clip{}
 Layer.scene=Scene;Object3D.camera=class extends Object3D{};
 const PZ={layer:Layer,object3d:Object3D,clip:Clip,observable:runtime.PZ.observable,property:runtime.PZ.property};
 const sequence={properties:{resolution:p([1920,1080])},videoTracks:[]};
 const clip=Object.assign(new Clip(),{parent:sequence,start:0,length:100});
 const scene=Object.assign(new Scene(),{parent:clip,type:4,properties:{name:p('Scene')},objects:[]});clip.object=scene;
 const track={parent:sequence,track3d:false,enabled:true,clips:[clip],getCurrentClip:()=>clip};sequence.videoTracks.push(track);clip.parent=track;
 const object=(parent,position=[0,0,0],rotation=[0,0,0],scale=[1,1,1])=>{const o=Object.assign(new Object3D(),{parent,properties:{position:p(position),rotation:p(rotation),scale:p(scale)},objects:[],threeObj:new THREE.Object3D()});parent.objects.push(o);return o;};
 const camera=object(scene,[0,0,80]);camera.type=6;camera.threeObj=new THREE.PerspectiveCamera(60,1920/1080,.1,5000);camera.update=function(frame){this.threeObj.position.fromArray(this.properties.position.get(frame));this.threeObj.rotation.fromArray([...this.properties.rotation.get(frame),'XYZ']);};
 const provider=createWorldProvider({PZ,THREE,patch:options.patch,createConstraintEvaluator:createEvaluator});
 const context=absolute=>({absolute,sequence,cache:new Map(),read:(p,f)=>p.get(f)});
 return {PZ,THREE,sequence,scene,object,camera,provider,context,track,Clip,Scene,native:runtime.PZ};
}
const approx=(a,b)=>{assert.equal(a.length,b.length);a.forEach((v,i)=>assert.ok(Math.abs(v-b[i])<1e-8,`${a} != ${b}`));};
test('projection and inverse use composition pixels and explicit NDC depth',{skip:!fs.existsSync(core)},()=>{
 const {THREE}=setup(),camera=new THREE.PerspectiveCamera(60,16/9,.1,5000);camera.position.z=80;camera.updateMatrixWorld(true);
 const point=[10,5,0],pixel=projectPoint(THREE,point,camera,[1920,1080]);assert.ok(pixel[0]>960&&pixel[1]<540);approx(unprojectPoint(THREE,pixel,camera,[1920,1080]),point);
});
test('world helpers sample parent groups at the requested frame without touching live poses',{skip:!fs.existsSync(core)},()=>{
 const {scene,object,provider,context}=setup();const group=object(scene,[3,0,0],[0,0,Math.PI/2],[2,2,2]),child=object(group,[1,0,0]);child.properties.position={get:f=>[f/30,0,0]};
 child.threeObj.position.set(999,999,999);const before=child.threeObj.position.toArray();
 const api=provider(child,context(30));approx(api.worldPosition(),[3,2,0]);approx(api.fromWorld(api.toWorld([1,2,3])),[1,2,3]);approx(api.worldRotation(),[0,0,Math.PI/2]);approx(child.threeObj.position.toArray(),before);
 for(const frame of [90,0,30])approx(provider(child,context(frame)).worldPosition(),[3,frame/15,0]);
});
test('Track To is solved on the mirrored hierarchy at the same frame',{skip:!fs.existsSync(core)},()=>{
 const {scene,object,provider,context}=setup();const tracker=object(scene),target=object(scene,[10,0,0]);
 Object.assign(tracker.properties,{zoidiumTrackTo:p('target'),zoidiumTrackAxis:p(2),zoidiumUpAxis:p(1),zoidiumInfluence:p(100)});target.properties.zoidiumId=p('target');
 approx(provider(tracker,context(0)).worldRotation(),[0,Math.PI/2,0]);approx(tracker.threeObj.rotation.toArray().slice(0,3),[0,0,0]);
});
test('screen helpers select shared camera layers only on tracked scene tracks',{skip:!fs.existsSync(core)},()=>{
 const {scene,object,provider,context,sequence,track,Clip,Scene}=setup();const child=object(scene,[10,0,0]);
 const native=provider(child,context(0)).toScreen();
 const sharedScene=Object.assign(new Scene(),{type:9,objects:[],properties:{name:p('Camera')}}),clip=Object.assign(new Clip(),{start:0,length:100,object:sharedScene});const sharedTrack={enabled:true,track3d:false,clips:[clip],getCurrentClip:()=>clip};sharedScene.parent=clip;clip.parent=sharedTrack;sharedTrack.parent=sequence;sequence.videoTracks.unshift(sharedTrack);
 const camera=object(sharedScene,[0,0,40]);camera.type=6;const {THREE}=setup();camera.threeObj=new THREE.PerspectiveCamera(60,16/9,.1,5000);camera.update=function(f){this.threeObj.position.fromArray(this.properties.position.get(f));this.threeObj.rotation.set(0,0,0);};
 track.track3d=true;const api=provider(child,context(0)),pixel=api.toScreen();assert.ok(pixel[0]>native[0]);approx(api.fromScreen(pixel),[0,0,0]);
});
test('unrelated expression transforms are not pulled into a world dependency',{skip:!fs.existsSync(core)},()=>{
 const {scene,object,provider,context}=setup();const target=object(scene,[3,0,0]),unrelated=object(scene);unrelated.properties.position={get(){throw new Error('Unrelated property must not be read');}};approx(provider(target,context(0)).worldPosition(),[3,0,0]);
});

test('twenty world samples allocate only the requested ancestor chain in a 420-object scene',{skip:!fs.existsSync(core)},()=>{
 const {THREE}=host();let allocations=0;
 const counted={...THREE,Object3D:class extends THREE.Object3D{constructor(){super();allocations++;}}};
 const {scene,object,provider,context}=setup({THREE:counted});
 const group=object(scene,[3,0,0]),child=object(group,[1,2,3]);
 for(let i=3;i<420;i++)object(scene);
 allocations=0;
 for(let i=0;i<20;i++)approx(provider(child,context(30)).worldPosition(),[4,2,3]);
 assert.equal(allocations,60);
});

test('world mirrors include recursive Track To dependencies, targets and their ancestors',{skip:!fs.existsSync(core)},()=>{
 const {scene,object,provider,context}=setup();
 const group=object(scene,[2,3,0]),tracker=object(group,[0,1,0]),targetGroup=object(scene,[10,0,0]),target=object(targetGroup,[0,4,0]),end=object(scene,[20,4,0]);
 const track=(node,id)=>Object.assign(node.properties,{zoidiumTrackTo:p(id),zoidiumTrackAxis:p(2),zoidiumUpAxis:p(1),zoidiumInfluence:p(100)});
 target.properties.zoidiumId=p('target');end.properties.zoidiumId=p('end');track(tracker,'target');track(targetGroup,'end');
 end.properties.position={get:f=>[20+f,4,0]};
 for(const frame of [0,1.125,30.5,0]){
   const api=provider(tracker,context(frame));
   approx(api.fromWorld(api.toWorld([1,2,3])),[1,2,3]);
   assert.ok(api.worldRotation().every(Number.isFinite));
 }
 // Reciprocal constraints remain cycles and leave both authored rotations.
 targetGroup.properties.zoidiumId=p('group');end.properties.zoidiumTrackTo=p('group');
 approx(provider(targetGroup,context(0)).worldRotation(),[0,0,0]);
});

test('structure revision invalidates IDs and parents on native list edits, reload and undo',{skip:!fs.existsSync(core)},()=>{
 const undo=[],patch=(holder,key,make)=>{const original=holder[key];holder[key]=make(original);undo.push(()=>{holder[key]=original;});};
 const {scene,object,camera,provider,context,native}=setup({patch});
 try{
   const a=object(scene,[2,0,0]),b=object(scene,[10,0,0]),child=object(a,[1,0,0]),target=object(scene,[20,0,0]);
   for(const node of [scene,camera,a,b,child,target])if(node.objects)node.objects=Object.assign(new native.objectList(),node.objects);
   const id=new native.property.static({name:'ID',value:'target'});id.load();target.properties.zoidiumId=id;
   Object.assign(child.properties,{zoidiumTrackTo:p('target'),zoidiumInfluence:p(100)});
   let reads=0;const original=id.get;id.get=function(){reads++;return original.call(this);};
   for(let i=0;i<20;i++)approx(provider(child,context(0)).worldPosition(),[3,0,0]);
   // One index read and one constraint-evaluator read per sample.
   assert.equal(reads,21);
   a.objects.splice(0,1);b.objects.push(child);child.parent=b;
   approx(provider(child,context(.5)).worldPosition(),[11,0,0]);
   b.objects.splice(0,1);a.objects.push(child);child.parent=a;
   approx(provider(child,context(0)).worldPosition(),[3,0,0]);
   id.load('renamed');
   approx(provider(child,context(0)).worldRotation(),[0,0,0]);
   id.load('target');
   approx(provider(child,context(0)).worldRotation(),[0,Math.PI/2,0]);
   scene.objects.splice(scene.objects.indexOf(target),1);
   approx(provider(child,context(0)).worldRotation(),[0,0,0]);
   scene.objects.push(target);
   approx(provider(child,context(0)).worldRotation(),[0,Math.PI/2,0]);
 }finally{undo.reverse().forEach(fn=>fn());}
});

test('camera and parent expressions sample exact sub-frame times in any order',{skip:!fs.existsSync(core)},()=>{
 const {scene,object,camera,provider,context}=setup(),group=object(scene),child=object(group,[2,1,0]);
 group.properties.position={get:f=>[f/3,f/7,0]};camera.properties.position={get:f=>[f/5,0,80+f]};
 const results=new Map();
 for(const frame of [0,12,12.125,12.5,12.875,30,12.125,0]){
   const api=provider(child,context(frame)),pixel=api.toScreen([1,2,0]);
   approx(api.fromScreen(pixel),[1,2,0]);
   if(results.has(frame))assert.deepEqual(pixel,results.get(frame));else results.set(frame,pixel);
 }
 assert.notDeepEqual(results.get(12),results.get(12.125));
});
