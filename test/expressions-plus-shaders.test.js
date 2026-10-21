"use strict";
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {analyze,expandIncludes,installShaders}=require('../plugins/expressions-plus/shaders');
const {host,core}=require('./expressions-plus-harness');
test('include expansion is bounded, deduplicated, comment-aware and opt-in',()=>{
 const source='precision highp float;\nvoid main(){gl_FragColor=vec4(1.0);}\n';assert.equal(expandIncludes(source),source);assert.equal(analyze(source).used,false);
 const expanded=expandIncludes('// #include <zoidium/noise>\n// #include <zoidium/hash>\n// #include <zoidium/color>\n// #include <zoidium/sdf>');
 assert.equal((expanded.match(/float zHash\(float/g)||[]).length,1);assert.match(expanded,/float zNoise\(vec3/);assert.match(expanded,/vec3 zSrgbToLinear/);assert.match(expanded,/float zSdCircle/);
 assert.throws(()=>expandIncludes('// #include <zoidium/missing>'),/Unknown/);
 assert.equal(expandIncludes('/*\n// #include <zoidium/missing>\n*/'),'/*\n// #include <zoidium/missing>\n*/');
});
test('uniform discovery ignores comments and handles precision and supported dimensions',()=>{
 assert.deepEqual(analyze('// uniform float zTime;\nuniform highp float zFrame;\nuniform vec4 ctl_Color;\n/*uniform float ctl_Missing;*/').uniforms,[{name:'zFrame',type:'float',size:1},{name:'ctl_Color',type:'vec4',size:4}]);
});
test('comma-separated automatic uniform declarations are discovered',()=>{assert.deepEqual(analyze('uniform float zTime, zFrame;').uniforms.map(u=>u.name),['zTime','zFrame']);});
test('native shader hook preserves raw source and binds local time, frame and absolute control values',{skip:!fs.existsSync(core)},()=>{
 const {THREE}=host();class Sequence{}class Clip{}class Shader{
  updateFragmentShader(){this.pass.material.fragmentShader=this.properties.fragShader.get();this.pass.uniforms={tDiffuse:{value:null}};}
  update(frame){if(this.dirty){this.updateFragmentShader();this.dirty=false;}this.pass.enabled=true;return frame;}
 }
 const p=value=>({get:()=>value}),sequence=Object.assign(new Sequence(),{properties:{rate:p(30)}}),clip=Object.assign(new Clip(),{start:10,parent:sequence,properties:{time:{get:f=>f/15}}});
 const amount={properties:{name:p('Amount')},get:f=>f};const point={properties:{name:p('Point')},get:()=>[1,2,3]};const errors=[];
 const PZ={sequence:Sequence,clip:Clip,effect:{shader:Shader}};
 installShaders({PZ,THREE,store:{list:()=>[amount,point]},engine:{read:(p,f)=>p.get(f)},patch:(h,k,f)=>{h[k]=f(h[k]);}});
 const raw='precision highp float;\n// #include <zoidium/noise>\nuniform float zTime;\nuniform float zFrame;\nuniform float ctl_Amount;\nuniform vec3 ctl_Point;\nvoid main(){gl_FragColor=vec4(zNoise(vec2(zTime)));}';
 const effect=Object.assign(new Shader(),{parent:clip,dirty:true,properties:{fragShader:p(raw)},pass:{uniforms:{},material:{}},onShaderError:{update:e=>errors.push(e)}});
 assert.equal(effect.update(30),30);assert.deepEqual(errors,[]);assert.equal(effect.properties.fragShader.get(),raw);assert.match(effect.pass.material.fragmentShader,/float zNoise/);
 assert.equal(effect.pass.uniforms.zTime.value,2);assert.equal(effect.pass.uniforms.zFrame.value,30);assert.equal(effect.pass.uniforms.ctl_Amount.value,40);assert.equal(effect.pass.uniforms.ctl_Point.value.toArray().join(','),'1,2,3');
 const plain='void main(){gl_FragColor=vec4(1.0);}';effect.properties.fragShader=p(plain);effect.dirty=true;effect.update(4);assert.equal(effect.pass.material.fragmentShader,plain);assert.deepEqual(Object.keys(effect.pass.uniforms),['tDiffuse']);
});
