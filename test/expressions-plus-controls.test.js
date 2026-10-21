"use strict";
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {host,core}=require('./expressions-plus-harness');
const {createControlsStore,decode,KINDS}=require('../plugins/expressions-plus/controls');
function setup(){
 const {PZ}=host();const store=createControlsStore({PZ,patch:(h,k,f)=>{h[k]=f(h[k]);}});const seq=new PZ.sequence();
 // Native sequence initialization needs a project for schedule analysis. The
 // property list is the actual save/copy-paste path under test here.
 store.ensure(seq);seq.properties.load();return {PZ,store,seq};
}
test('all control types survive native properties serialization, copying and keys',{skip:!fs.existsSync(core)},()=>{
 const {PZ,store,seq}=setup();for(const kind of Object.keys(KINDS))store.add(seq,kind);
 const slider=store.list(seq)[0];slider.animated=true;slider.keyframes.push(new PZ.keyframe(100,30,1));
 assert.equal(slider.get(15),50);assert.equal(store.list(seq)[4].get(0).join(','),'0,0');
 const saved=JSON.parse(JSON.stringify(seq.properties));assert.equal(typeof saved.zoidiumControls,'string');
 const copy=new PZ.sequence();store.ensure(copy);copy.properties.load(saved);
 assert.deepEqual(store.snapshot(copy),store.snapshot(seq));assert.equal(store.list(copy)[0].get(15),50);
 assert.deepEqual(store.list(copy).map(p=>p.definition.zoidiumControlKind).join(','),Object.keys(KINDS).join(','));
 assert.ok(slider.getAddress().length>1);
});
test('rename, reorder, removal, restoration and unique IDs retain control channels',{skip:!fs.existsSync(core)},()=>{
 const {store,seq}=setup();const a=store.add(seq,'Slider'),b=store.add(seq,'Slider');
 assert.equal(store.label(b),'Slider 2');const before=store.snapshot(seq);
 store.rename(seq,a,'Amount');store.move(seq,a,1);assert.equal(store.label(store.list(seq)[1]),'Amount');
 assert.throws(()=>store.rename(seq,a,'Slider 2'),/unique/);store.remove(seq,b);assert.equal(store.list(seq).length,1);
 store.restore(seq,before);assert.deepEqual(store.snapshot(seq),before);
 assert.equal(new Set(store.snapshot(seq).controls.map(p=>p.type.zoidiumControlId)).size,2);
});
test('an untouched sequence omits control storage, and invalid payloads are rejected',{skip:!fs.existsSync(core)},()=>{
 const {store,seq}=setup();assert.equal(JSON.parse(JSON.stringify(seq.properties)).zoidiumControls,undefined);
 assert.equal(store.list(seq).length,0);assert.throws(()=>decode('{bad'),SyntaxError);
 assert.throws(()=>decode({version:2,controls:[]}),/Unsupported/);
 assert.throws(()=>decode({version:1,controls:[{type:{zoidiumControlId:'c1',zoidiumControlKind:'Date'}}]}),/Invalid/);
});
test('enabling after native load recovers retained sequence control data',{skip:!fs.existsSync(core)},()=>{
 const {PZ,store,seq}=setup();store.add(seq,'Slider',{name:'Restored',value:9});
 const payload=JSON.parse(JSON.stringify(seq.properties)).zoidiumControls;
 const target=new PZ.sequence();target.properties.load();const nativeJSON=target.toJSON;
 target.toJSON=function(){const data=nativeJSON.call(this);return {...data,properties:{...JSON.parse(JSON.stringify(data.properties)),zoidiumControls:payload}};};
 store.ensure(target);assert.equal(store.list(target).length,1);assert.equal(store.label(store.list(target)[0]),'Restored');assert.equal(store.list(target)[0].get(0),9);
});
test('reactivation reuses the native child list and keeps its property addresses',{skip:!fs.existsSync(core)},()=>{
 const {PZ,store,seq}=setup();store.add(seq,'Slider',{value:3});const address=store.list(seq).getAddress(),before=store.snapshot(seq);store.detach(seq);
 const next=createControlsStore({PZ,patch:(h,k,f)=>{h[k]=f(h[k]);}});next.ensure(seq);
 assert.deepEqual(next.list(seq).getAddress(),address);assert.equal(seq.children.filter(child=>child.name==='Controls').length,1);assert.deepEqual(next.snapshot(seq),before);assert.equal(next.list(seq).visible,true);
});
