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

test('Trapcode seven-argument compiled calls retain Math identity and guarded API evaluation',{skip:!fs.existsSync(core)},()=>{
 const {PZ,a}=host();new Function('PZ',fs.readFileSync(path.join(__dirname,'../plugins/trapcode-suite/trapcode-expressions.js'),'utf8'))(PZ);PZ.trapcode.installExpressionSupport(PZ);
 a.expression=new PZ.expression('sin === cos ? 1 : 2');assert.equal(a.get(0),2);
 a.expression=new PZ.expression('const n=2; value+n');assert.equal(a.get(0),9);
 a.expression=new PZ.expression('sin["con"+"structor"]("return 29")()');assert.equal(a.get(0),7);assert.match(a.expression.error,/cannot call/);
});
test('disposal can restore native compiled entries for existing legacy expressions',{skip:!fs.existsSync(core)},()=>{
 const {PZ,a,engine}=host();a.expression=new PZ.expression('sin(time)+3');assert.equal(a.expression.fn(0,1,PZ.expression.methods,{}),Math.sin(1)+3);
 engine.restore({forEachItemOfType(_type,visit){visit(a);}});
 assert.doesNotMatch(a.expression.fn.toString(),/__z/);assert.equal(a.expression.fn(0,1,PZ.expression.methods,{}),Math.sin(1)+3);
});
test('legacy extra arguments keep native helper semantics; modern programs opt into AE overloads',{skip:!fs.existsSync(core)},()=>{
 const {PZ,a}=host();a.expression=new PZ.expression('linear(.5,0,1,10,20)');assert.equal(a.get(0),0);
 a.expression=new PZ.expression('const t=.5; linear(t,0,1,10,20)');assert.equal(a.get(0),15);
});
test('modern programs are bounded while CM3-compatible finite loops retain native results',{skip:!fs.existsSync(core)},()=>{
 const {PZ,a}=host({stepLimit:1000});a.expression=new PZ.expression('var n=0; for(var i=0;i<5000;i++)n++; n');assert.equal(a.get(0),5000);
 a.expression=new PZ.expression('let n=0; for(let i=0;i<5000;i++)n++; n');assert.equal(a.get(0),7);assert.match(a.expression.error,/budget exceeded/);
});
test('dependency classification follows syntax and invalidates when method availability changes',{skip:!fs.existsSync(core)},()=>{
 const {PZ,engine}=host();assert.equal(engine.requiresSource('var n=3; linear(n,0,1,10,20)'),false);assert.equal(engine.requiresSource('const n=3; linear(n,0,1,10,20)'),true);assert.equal(engine.requiresSource('return 3'),true);assert.equal(engine.requiresSource('throw "error"'),true);assert.equal(engine.requiresSource('/x/d'),true);
 assert.equal(engine.requiresSource('wiggle(1,2)'),true);PZ.expression.methods.wiggle=()=>1;assert.equal(engine.requiresSource('wiggle(1,2)'),false);
});

test('only assigned properties intercept reads through clear and history replay',{skip:!fs.existsSync(core)},()=>{
 const {PZ,a,b,owner,engine}=host();
 const native=a.get;assert.equal(Object.hasOwn(a,'get'),false);
 const shared=new PZ.expression('value + thisObject.property("B").value');
 a.expression=shared;assert.notEqual(a.get,native);assert.equal(a.get(0),18);
 a.expression=null;assert.equal(a.get,native);assert.equal(Object.hasOwn(a,'get'),false);
 // Native undo and redo assign the same observable slot.
 a.expression=shared;assert.equal(a.get(0),18);a.expression=null;assert.equal(a.get(0),7);
 a.load({expression:'value + 3',keyframes:[{frame:0,value:7}]});assert.equal(a.get(0),10);
 a.expression=null;
 const copy=new PZ.propertyList({c:{name:'C',dynamic:true,type:0,value:19}},owner);copy.load();
 const expression=new PZ.expression('value + 2');a.expression=expression;copy.c.expression=expression;
 assert.equal(a.get(0),9);assert.equal(copy.c.get(0),21);assert.equal(Object.hasOwn(b,'get'),false);
 engine.restore({forEachItemOfType(_type,visit){visit(a);visit(copy.c);}});
 assert.equal(a.get,native);assert.equal(Object.hasOwn(copy.c,'get'),false);
});
test('legacy compilation skips the world provider while modern handles still construct it',{skip:!fs.existsSync(core)},()=>{
 let calls=0;const {PZ,a}=host({world(){calls++;return {};}});
 for(const source of ['sin(frame)*20','random(frame)','linear(.5,0,1,10,20)','var helper=methods.random; helper(frame)']) {
  a.expression=new PZ.expression(source);a.get(12);
 }
 assert.equal(calls,0);a.expression=new PZ.expression('value + 1');assert.equal(a.get(0),8);assert.equal(calls,1);
});
test('non-expression observables keep the native update untouched',{skip:!fs.existsSync(core)},()=>{
  const {PZ,a,b,engine}=host();
  const nativeUpdate=PZ.observable.prototype.update;
  const seen=[];
  const plain=new PZ.observable();
  plain.watch(v=>seen.push(v));
  for(let i=0;i<1000;i++)plain.update(i);
  assert.deepEqual(seen,[...Array(1000).keys()]);
  // Nothing off the expression path is wrapped.
  assert.equal(plain.update,nativeUpdate);
  assert.equal(a.onAnimatedChanged.update,nativeUpdate);
  assert.equal(Object.hasOwn(a,'get'),false);
  assert.equal(Object.hasOwn(b,'get'),false);
  // Expression assignment still hooks after unrelated updates, and clearing restores both paths.
  a.expression=new PZ.expression('value + 1');
  assert.notEqual(a.get,Object.getPrototypeOf(a).get);
  assert.equal(a.get(0),8);
  for(let i=1000;i<1100;i++)plain.update(i);
  assert.equal(seen.length,1100);
  a.expression=null;
  assert.equal(a.get(0),7);
  assert.equal(Object.hasOwn(a,'get'),false);
  engine.restore({forEachItemOfType(_type,visit){visit(a);visit(b);}});
  assert.equal(a.onExpressionChanged.update,nativeUpdate);
});
