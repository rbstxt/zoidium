"use strict";
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { compile, sandboxFunction } = require('../plugins/expressions-plus/compiler');
const { createCallGuard } = require('../plugins/expressions-plus/call-guard');
function evaluate(source, extra = {}, limit) {
  const result = compile(source, ['random', ...Object.keys(extra)]);
  const realm = vm.createContext({});
  const Factory = vm.runInContext('Function', realm);
  const math = vm.runInContext('Math', realm);
  const pure = vm.runInContext('({Array, Number, String, Boolean, parseInt, parseFloat, isFinite, isNaN, Math, JSON, undefined, NaN, Infinity})', realm);
  const guard = createCallGuard(limit);
  const helpers = { ...guard, pure, api: { value: 4 } };
  return Factory('frame', 'time', 'methods', 'properties', 'Math', '__z', result.code)(30, 1, {random:n=>{const v=Math.sin(n)*10000;return v-Math.floor(v);}, ...extra}, {}, math, helpers);
}
test('modern syntax, patterns, scope, functions, rest, spread and explicit return', () => {
  assert.equal(evaluate('const [a,...tail]=[2,3,4]; let {x=1}={}; const f=(v=2,...rest)=>v+rest.length; function g(n){return n*2;} `${g(a)}:${f(x,...tail)}`'), '4:3');
  assert.equal(evaluate('let a=0; for(const v of [1,2,3]) a+=v; while(a<8)a++; switch(a){case 8:a+=2;break;} return a'), 10);
  assert.equal(evaluate('const square=function(n){return n*n}; square(4)'), 16);
  assert.equal(evaluate('let a=1; {let a=9;} a'), 1);
  assert.equal(evaluate('const o={a:2}; const {a:b}=o; b'), 2);
  assert.equal(evaluate('let x; ({foo:x}={foo:6}); x'),6);
  assert.throws(()=>compile('({foo:missing}={foo:6})'),ReferenceError);
  assert.equal(evaluate('const a={x:1}; delete a?.x; a.x'),undefined);
  assert.equal(evaluate('delete null?.x'),true);
});
test('optional chains retain receiver, getter count and skipped argument evaluation', () => {
  assert.equal(evaluate('let n=0; null?.x.foo(n++); n'), 0);
  assert.equal(evaluate('const a={n:3,f(v){return v+2}}; a?.f?.(4)'), 6);
  assert.equal(evaluate('const a={}; a.f?.(sin.constructor("skipped"))'), undefined); // free names are checked even in skipped branches
});
test('unknown identifiers are static ReferenceErrors even in dead code', () => {
  for (const name of ['window','document','globalThis','self','top','parentWindow','parent','frames','Function','eval','Date','arguments','missing']) {
    assert.throws(()=>compile(`false && ${name}`), ReferenceError, name);
  }
  assert.throws(()=>compile('if(false){missing()}'), ReferenceError);
});
test('unsupported syntax and hidden compiler names are rejected', () => {
  for (const source of ['this','class A{}','import("x")','async ()=>1','function* f(){yield 1}','with({}){}','debugger','let __z=1']) assert.throws(()=>compile(source), source);
});
test('constructor member reads preserve native realm identity and the round-1 example', () => {
  assert.equal(evaluate('var key="con"+"structor"; [1,2,3][key] === [4][key] ? 23 : 0'), 23);
  assert.equal(evaluate('sin.constructor === [].constructor.constructor ? 9 : 0'), 9);
  assert.equal(evaluate('var p="__proto__"; [1][p] === [2][p]'), true);
});
test('calls, callbacks, aliases, bind, apply, new and tagged templates reject constructor/eval escapes', () => {
  const cases = [
    'sin.constructor("return 29")()',
    'var k="con"+"structor"; sin[k]("return 29")()',
    'var F=sin.constructor; F("return 29")()',
    'var F=sin.constructor; new F("return 29")',
    'sin.constructor.call(null,"return 29")()',
    'sin.constructor.apply(null,["return 29"])()',
    'sin.constructor.bind(null,"return 29")()',
    'sin.constructor.call.call(sin.constructor,null,"return 29")()',
    '["return 29"].map(sin.constructor)',
    '["return 29"].map(sin.constructor.call,sin.constructor)',
    '["return 29"].map(sin.constructor.bind(null))',
    'sin.constructor`return 29`',
    'sin.constructor?.("return 29")',
    'JSON.parse("\\\"return 29\\\"",sin.constructor)()',
    'foreign("return 29")',
    '["return 29"].reduce(foreign,0)',
    'ev("29")',
  ];
  const other = vm.createContext({});
  for (const ctor of ['Function','(async function(){}).constructor','(function*(){}).constructor','(async function*(){}).constructor']) {
    for (const source of cases) assert.throws(()=>evaluate(source,{foreign:vm.runInContext(ctor,other),ev:vm.runInContext('eval',other)}), /Expression cannot call Function constructors or eval/, source + ' / ' + ctor);
  }
});
test('promise callbacks, string protocol methods and created functions reject escapes', async () => {
  const S = '({}).constructor.getOwnPropertySymbols([].constructor.prototype)[0].constructor';
  for (const source of [
    `var S=${S}; "a".replace({[S.replace]: sin.constructor}, "return 29")`,
    `var S=${S}; "a".replaceAll({[S.replace]: sin.constructor.bind(null)}, "return 29")`,
    `var S=${S}; "return 29".match({[S.match]: sin.constructor})`,
    `var S=${S}; "return 29".search({[S.search]: sin.constructor})`,
    'made()',
    '[1].map(made)',
  ]) assert.throws(() => evaluate(source, { made: vm.runInContext('Function("return 29")', vm.createContext({})) }), /Expression cannot call Function constructors or eval/, source);
  await assert.rejects(Promise.resolve(evaluate('[].constructor.fromAsync([1]).then(() => "return 29").then(sin.constructor).then(f => f())')), /Expression cannot call Function constructors or eval/);
  await assert.rejects(Promise.resolve(evaluate('[].constructor.fromAsync(["return 29"], sin.constructor)')), /Expression cannot call Function constructors or eval/);
  assert.equal(evaluate('"a-b".replace(/-/, () => "+")'), 'a+b');
  assert.equal(evaluate('"a,b".split(",").length'), 2);
});
test('bounded loops and recursion fail deterministically', () => {
  assert.throws(()=>evaluate('let n=0; while(true)n++',{},1000),/budget exceeded/);
  assert.throws(()=>evaluate('function f(){return f()} f()'),/recursion budget exceeded/);
  assert.equal(evaluate('let n=0; for(let i=0;i<100;i++)n++; n',{},1000),100);
});
test('ordinary calls preserve identity reads, receiver and argument order', () => {
  assert.equal(evaluate('var f=sin.constructor; [f].indexOf(f)'),0);
  assert.equal(evaluate('[1,2,3].slice(1).join(",")'),'2,3');
  assert.equal(evaluate('var n=0; var a={get x(){n++;return sin}}; a.x(n++); n'),2);
});
test('sandbox Function is captured, iframe removed, then compilation starts', () => {
  const events=[];
  const realm=vm.createContext({});
  const F=vm.runInContext('Function',realm);
  const doc={body:{appendChild(){events.push('append');}},createElement(){return {setAttribute(k,v){events.push([k,v]);},contentWindow:{Function:(...args)=>{events.push('compile');return F(...args);}},remove(){events.push('remove');}};}};
  const fn=sandboxFunction(doc,'return 3');
  assert.equal(fn(),3);
  assert.equal(events.findIndex(v=>v==='remove')<events.findIndex(v=>v==='compile'),true);
  assert.deepEqual(events[0],['sandbox','allow-scripts allow-same-origin']);
});
module.exports={evaluate};
