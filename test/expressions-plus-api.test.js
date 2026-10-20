"use strict";
const test=require('node:test'),assert=require('node:assert/strict');
const {createAPI}=require('../plugins/expressions-plus/api');
class Sequence{} class Clip{} class Layer{} class PropertyList{}
const PZ={sequence:Sequence,clip:Clip,layer:Layer,propertyList:PropertyList};
const p=(name,value)=>({definition:{name},get:()=>value});
function graph(){
 const sequence=Object.assign(new Sequence(),{properties:{rate:p('Frame rate',30)},videoTracks:[]});
 const clip=Object.assign(new Clip(),{parent:sequence,start:10,length:100,properties:{time:p('Time',1)}});
 const layer=Object.assign(new Layer(),{parent:clip,properties:{name:p('Name','Scene'),position:p('Position',[1,2,3])},effects:[],objects:[]});clip.object=layer;
 const track={clips:[clip],getCurrentClip:()=>clip};sequence.videoTracks.push(track);
 const effect={parent:layer,properties:{name:p('Name','Glow'),radius:p('Radius',20)}};layer.effects.push(effect);
 const property=p('Opacity',.5);property.parent=layer;
 const control=p('Amount',7);control.properties={name:p('Name','Amount')};control.parent=sequence;
 const reads=[];
 const api=createAPI({PZ,owner:layer,property,frame:20,time:1,base:.5,read:(p,f)=>{reads.push(f);return p.get(f);},baseAt:(p,f)=>f/30,controls:()=>[control],methods:{random:n=>Math.sin(n),linear:(a,b,t)=>a+(b-a)*t,clamp:(v,a,b)=>v.map(n=>Math.max(a,Math.min(b,n)))}});
 return {...api,sequence,clip,layer,property,control,reads};
}
test('API crosses layers/effects/parents and paths using copied values',()=>{
 const {api,reads}=graph();
 assert.equal(api.thisObject.name,'Scene');assert.equal(api.layer('Scene').effect('Glow')('Radius'),20);
 assert.equal(api.thisComp.layer(1).effect('Glow').param('Radius'),20);
 assert.equal(api.prop('/Scene/Glow/Radius'),20);
 assert.equal(api.thisLayer.property('Position').value[1],2);
 assert.equal(api.thisObject.parent.name,'');assert.equal(api.thisObject.parent(2),api.thisSequence);
 assert.equal(api.controls.Amount,7);assert.equal(api.control('Amount'),7);assert.ok(reads.every(Number.isFinite));
 const value=api.thisLayer.property('Position').value;value[0]=900;assert.equal(api.thisLayer.property('Position').value[0],1);
 assert.equal(Object.getPrototypeOf(api),null);assert.equal(Object.getPrototypeOf(api.thisObject),null);
 assert.equal(api.thisObject.parentObject,undefined);assert.equal(api.thisObject.threeObj,undefined);
});
test('property timing, derivatives and key records use seconds and one-based indices',()=>{
 const {property,layer,sequence}=graph();property.keyframes=[{frame:0,value:0},{frame:30,value:10}];
 const {api}=createAPI({PZ,owner:layer,property,sequence,frame:15,time:.5,base:5,read:(_p,f)=>f/3,baseAt:(_p,f)=>f/3,methods:{random:()=>0,clamp(){}}});
 assert.equal(api.thisProperty.numKeys,2);assert.equal(api.thisProperty.key(2).time,1);
 assert.equal(api.thisProperty.nearestKey(.7).index,2);assert.equal(api.thisProperty.valueAtTime(.5),5);
 assert.ok(Math.abs(api.thisProperty.velocity-10)<1e-10);assert.ok(Math.abs(api.thisProperty.speed-10)<1e-10);
 assert.throws(()=>api.thisProperty.key(0),/out of range/);
});
test('seeded streams reset while existing function identities remain intact',()=>{
 const a=graph(),b=graph();a.api.seedRandom(42,true);b.api.seedRandom(42,true);
 assert.deepEqual([a.overrides.get(a.methods.random)(),a.overrides.get(a.methods.random)()],[b.overrides.get(b.methods.random)(),b.overrides.get(b.methods.random)()]);
 assert.equal(a.methods.linear.length,3);assert.equal(a.overrides.get(a.methods.linear)(.5,0,1,10,20),15);
 assert.equal(a.overrides.get(a.methods.linear)(10,20,.25),12.5);
});
