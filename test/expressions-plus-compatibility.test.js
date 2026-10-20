"use strict";
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {compile,sandboxFunction}=require('../plugins/expressions-plus/compiler');
const {createCallGuard}=require('../plugins/expressions-plus/call-guard');
const acorn=require('../plugins/expressions-plus/vendor/acorn.txt');
const cache=process.env.ZOIDIUM_RESOURCE_DIR || path.join(__dirname,'../.zoidium-resources');
const core=path.join(cache,'core-1.0.102.js');
function corpus(){
 const sources=new Set(['time','frame','sin(time)*20','var t=time*3; [sin(t),cos(t),0]','var sum=0; for(var i=0;i<20;i++)sum+=i; sum','var x=[1,2,3]; x[1]*frame','random(frame)','gaussRandom(frame,0,1)','linear(10,20,.25)','lerp([1,2],[3,4],.5)','ease(.3)','ease(.3,"Cubic","Out")','add([1,2,3],[4,5,6])','normalize([3,4])','length([3,4])','clamp([1,-2,3],0,2)','shake(time,2,3)','wave(frame)','properties.Strength || 0','var key="con"+"structor"; [1,2,3][key] === [4][key] ? 23 : 0','sin.constructor === [].constructor.constructor','random.constructor === sin.constructor','var f=sin.constructor; [f].indexOf(f)','var n=0; do{n++}while(n<3); n','var a=frame%3; switch(a){case 0:a=4;break;default:a=5;} a']);
 function walk(n){if(!n||typeof n!=='object')return; if(n.type==='Property'&&(n.key?.name==='expression'||n.key?.value==='expression')&&n.value?.type==='Literal'&&typeof n.value.value==='string')sources.add(n.value.value); for(const value of Object.values(n)){if(Array.isArray(value))value.forEach(walk);else if(value&&typeof value==='object')walk(value);}}
 function json(n){if(!n||typeof n!=='object')return; if(typeof n.expression==='string')sources.add(n.expression);for(const v of Object.values(n))json(v);}
 function files(dir){for(const f of fs.readdirSync(dir,{withFileTypes:true})){if(f.name==='vendor'||f.name==='alipfx')continue;const p=path.join(dir,f.name);if(f.isDirectory())files(p);else if(f.name.endsWith('.js')){try{walk(acorn.parse(fs.readFileSync(p,'utf8'),{ecmaVersion:'latest',allowReturnOutsideFunction:true}));}catch{ /* Some plugins use a different module grammar. */ }}else if(f.name.endsWith('.json')&&f.name!=='bundle.json'){try{json(JSON.parse(fs.readFileSync(p,'utf8')));}catch{ /* Non-JSON authored inputs are not an expression corpus. */ }}}}
 files(path.join(__dirname,'../plugins'));files(__dirname);return sources;
}
test('actual cached CM3 accepts the authored/plugin corpus with equal guarded results at 41 frames',{skip:!fs.existsSync(core)},()=>{
 const c=vm.createContext({PZ:{},ISNODE:true,console:{log(){},warn(){},error(){}},setTimeout,clearTimeout,performance,TextEncoder,TextDecoder,URL});
 vm.runInContext(fs.readFileSync(path.join(cache,'three.r91.min.js'),'utf8'),c);
 vm.runInContext(fs.readFileSync(core,'utf8'),c);
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../plugins/trapcode-suite/trapcode-expressions.js'),'utf8'),c);
 Object.assign(c.PZ.expression.methods,c.PZ.trapcode.expressionMethods);
 const methods=c.PZ.expression.methods;
 const doc={body:{appendChild(){}},createElement(){const realm=vm.createContext({});return {setAttribute(){},remove(){},contentWindow:{Function:vm.runInContext('Function',realm)}};}};
 let accepted=0,comparisons=0;
 for(const source of corpus()){
  const legacy=new c.PZ.expression(source);if(legacy.error)continue;
  const modern=sandboxFunction(doc,compile(source,Object.keys(methods)).code),guard=createCallGuard();
  const norm=value=> typeof value==='function'?'function':JSON.stringify(value);
  for(let frame=0;frame<=120;frame+=3){
   let a,b,ae,be;try{a=legacy.fn(frame,frame/30,methods,{Strength:2});}catch(e){ae=e.name;}
   try{guard.reset();b=modern(frame,frame/30,methods,{Strength:2},modern.zoidiumPure.Math,{...guard,api:{},pure:modern.zoidiumPure});}catch(e){be=e.name;}
   assert.equal(be,ae,source+' exception at '+frame);assert.equal(norm(b),norm(a),source+' at '+frame);comparisons++;
  }accepted++;
 }
 assert.ok(accepted>=25);console.log('Expressions+ native corpus:',accepted,'accepted sources,',comparisons,'comparisons');
});
