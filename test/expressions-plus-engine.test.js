"use strict";
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {installEngine}=require('../plugins/expressions-plus/engine');
const cache=process.env.ZOIDIUM_RESOURCE_DIR||path.join(__dirname,'../.zoidium-resources');
const core=path.join(cache,'core-1.0.102.js');
function host(){
 const c=vm.createContext({PZ:{},ISNODE:true,console:{log(){},warn(){},error(){}},setTimeout,clearTimeout,performance,TextEncoder,TextDecoder,URL});
 vm.runInContext(fs.readFileSync(path.join(cache,'three.r91.min.js'),'utf8'),c);vm.runInContext(fs.readFileSync(core,'utf8'),c);
 const PZ=c.PZ,originals=[];
 const document={body:{appendChild(){}},createElement(){const realm=vm.createContext({});return {setAttribute(){},remove(){},contentWindow:{Function:vm.runInContext('Function',realm)}};}};
 const engine=installEngine({PZ,document,patch(holder,key,make){originals.push([holder,key,holder[key]]);holder[key]=make(holder[key]);}});
 const root=new PZ.object,owner=new PZ.object;owner.parent=root;owner.properties=new PZ.propertyList({a:{name:'A',dynamic:true,type:0,value:7},b:{name:'B',dynamic:true,type:0,value:11}},owner);owner.properties.load();
 return {PZ,engine,owner,a:owner.properties.a,b:owner.properties.b};
}
test('native getters fall back to their own keyframes and clear recovered errors',{skip:!fs.existsSync(core)},()=>{
 const {PZ,engine,a}=host();a.expression=new PZ.expression('const a=3; value+a');assert.equal(a.get(0),10);
 a.expression=new PZ.expression('unknown');assert.equal(a.get(0),7);assert.match(engine.error(a),/unknown/);
 a.expression=new PZ.expression('throw "bad expression"');assert.equal(a.get(0),7);assert.match(engine.error(a),/bad expression/);
 a.expression=new PZ.expression('sin.constructor("return 29")()');assert.equal(a.get(0),7);assert.match(engine.error(a),/cannot call/);
 a.expression=new PZ.expression('21');assert.equal(a.get(0),21);assert.equal(engine.error(a),null);
});
test('cycles report an error and both properties use their own base values',{skip:!fs.existsSync(core)},()=>{
 const {PZ,engine,a,b}=host();a.expression=new PZ.expression('thisObject.property("B").value + 1');b.expression=new PZ.expression('thisObject.property("A").value + 1');
 assert.equal(a.get(0),7);assert.match(engine.error(a),/cycle/);assert.equal(b.get(0),11);assert.match(engine.error(b),/cycle/);
});
test('base values and extended API are sampled without previous-frame state',{skip:!fs.existsSync(core)},()=>{
 const {PZ,a}=host();a.expression=new PZ.expression('seedRandom(15,true); value + random()');
 const expected=a.get(30);for(const f of [0,90,5,30])assert.equal(a.get(f),expected);
});
