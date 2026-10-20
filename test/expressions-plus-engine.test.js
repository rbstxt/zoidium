"use strict";
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {host,core}=require('./expressions-plus-harness');
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

