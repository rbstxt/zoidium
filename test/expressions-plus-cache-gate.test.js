"use strict";
// Static preview-cache gate for Expressions+: expressions that may keep state
// between evaluations disable finished-frame caching for their project.
// Evaluation results are unchanged; only cache eligibility changes.
const test = require("node:test");
const assert = require("node:assert/strict");
const { compile, createSharedMutationCache } = require("../plugins/expressions-plus/compiler");
const { createPreviewCacheBlocker, previewCacheBlockReason } = require("../plugins/expressions-plus/expressions-plus");
const { revisionOf } = require("../plugins/core/output-frame-store");

// Representative host method names, as Object.keys(PZ.expression.methods)
// provides in the editor. Name resolution only needs their presence.
const METHODS = ["random", "linear", "ease", "easeIn", "easeOut", "clamp", "wiggle",
  "loopIn", "loopOut", "pingpong", "seedRandom", "lookAt", "degreesToRadians", "radiansToDegrees"];
const sharedMutation = source => compile(source, METHODS).needs.sharedMutation;

test("state-keeping counters and the alias case disable caching", () => {
  assert.equal(previewCacheBlockReason,
    "An expression may keep values between frames, so this project is not cached");
  for (const source of [
    "Math.counter=(Math.counter||0)+1; Math.counter",
    "Array.prototype.counter=(Array.prototype.counter||0)+1; Array.prototype.counter",
    "methods.counter=(methods.counter||0)+1; methods.counter",
    "let m = Math; m.c = 1",
  ]) assert.equal(sharedMutation(source), true, source);
});

test("ordinary expressions stay eligible", () => {
  for (const source of [
    // Wiggle recipe and seeded random from the expression docs.
    "wiggle(0.05, [20, 20, 0])",
    "seedRandom(17, true); random()",
    "seedRandom(15,true); value + random()",
    "random(frame)*10",
    // Loop counters and local helpers.
    "let n=0; for(let i=0;i<100;i++)n++; n",
    "var n=0; for(var i=0;i<5000;i++)n++; n",
    "const square=function(n){return n*n}; square(4)",
    "function g(n){return n*2;} g(3)",
    "const offsets = [1, 2, 3]; let total = 0; for (const offset of offsets) total += offset; value + total * sin(time)",
    "let a=0; for(const v of [1,2,3]) a+=v; while(a<8)a++; switch(a){case 8:a+=2;break;} return a",
    // Vector math and property navigation.
    "value + sin(time)",
    "[value[0] + thisObject.property(\"Scale\").value[0], 0, 0]",
    "thisObject.property(\"A\").value + 1",
    "thisComp.layer(\"Ball\").property(\"Position\").valueAtTime(time - thisComp.frameDuration)",
    "const pixel = layer(\"Scene\").object(\"Shape\").toScreen([0, 0, 0]); const size = thisComp.property(\"Resolution\").value; [pixel[0] - size[0] / 2, size[1] / 2 - pixel[1], 0]",
    // Local arrays built from literals and pushed to.
    "let a = [1]; a.push(2)",
    "let a; a = [1]; a.push(2)",
    "let s = [3,1]; s.sort(); s.join()",
    "const o = {}; o.x = 1",
    "const a={x:1}; delete a?.x; a.x",
    "delete null?.x",
    // Sequence Controls and loop helpers.
    "controls.Amount * 2",
    "control(\"Amount\")",
    "linear(.5,0,1,10,20)",
    "const t = time; linear(t, 0, 1, 10, 20)",
    "value + 1",
    "value",
    "frame*2",
    "sin(time)+3",
    "sin === cos ? 1 : 2",
  ]) assert.equal(sharedMutation(source), false, source);
});

test("prototype and constructor access disables caching", () => {
  for (const source of [
    "sin.constructor === [].constructor.constructor ? 9 : 0",
    "sin.constructor(\"return 29\")()",
    "sin[\"con\"+\"structor\"](\"return 29\")()",
    "var F=sin.constructor; F(\"return 29\")()",
    "[].constructor.fromAsync([\"return 29\"], sin.constructor)",
    "const a={}; a.f?.(sin.constructor(\"skipped\"))",
    "var f=sin.constructor; [f].indexOf(f)",
  ]) assert.equal(sharedMutation(source), true, source);
  // Computed reads through a dynamic key cannot be resolved statically, so a
  // plain read stays eligible; the write and call forms do not.
  assert.equal(sharedMutation("var key=\"con\"+\"structor\"; [1,2,3][key] === [4][key] ? 23 : 0"), false);
  assert.equal(sharedMutation("var p=\"__proto__\"; [1][p] === [2][p]"), false);
});

test("tainted locals and shared receivers disable caching", () => {
  for (const source of [
    "let a = {}; a = methods; a.x = 1",
    "let a; a.push(1)",
    "let a = [methods]; a[0].x = 1",
    "let a = [methods]; a.push(1)",
    "const o = {x: methods}; o.x.c = 1",
    "let o = {get x(){ return methods; }}; o.x.c = 1",
    "function f(n){ n.x = 1 } f({})",
    "for (const row of [[1],[2]]) row.push(3)",
    "methods.x.sort()",
    "Math.c++",
    "delete Math.c",
  ]) assert.equal(sharedMutation(source), true, source);
  for (const source of [
    "let b = [1]; let a = [b]; a[0].push(2)",
    "let a = [1]; a = [2]; a.push(3)",
    "let o = {get x(){ return 1; }}; o.x",
    "const o = {x: 1}; o.x = 2",
    "[1,2,3].sort()",
    "var n=0; var a={get x(){n++;return sin}}; a.x(n++); n",
    "\"a-b\".replace(/-/, () => \"+\")",
    "\"a,b\".split(\",\").length",
    "let m = methods; m.random(1)",
    "let n=0; null?.x.foo(n++); n",
    "let a=1; {let a=9;} a",
    "properties[\"Fn\"](2,3)",
  ]) assert.equal(sharedMutation(source), false, source);
});

test("eligibility results are cached per expression source text", () => {
  let compilations = 0, methodNames = ["wiggle"];
  const isSharedMutation = createSharedMutationCache(() => methodNames,
    (source, methods) => { compilations++; return compile(source, methods); });
  assert.equal(isSharedMutation("wiggle(1,2)"), false);
  assert.equal(isSharedMutation("wiggle(1,2)"), false);
  assert.equal(compilations, 1);
  assert.equal(isSharedMutation("Math.c = 1"), true);
  assert.equal(compilations, 2);
  // New host methods invalidate the cache because resolution may change.
  methodNames = ["wiggle", "helper"];
  assert.equal(isSharedMutation("wiggle(1,2)"), false);
  assert.equal(compilations, 3);
  // Sources that no longer compile fail closed.
  assert.equal(createSharedMutationCache(() => [], () => { throw new Error("bad source"); })("wiggle(1,2)"), true);
});

function dynamicType() {}
function projectWith(expressions) {
  const holders = expressions.map(source => ({ expression: source === null ? null : { source } }));
  return {
    forEachItemOfType(type, visit) { if (type === dynamicType) holders.forEach(visit); },
    sequence: { videoTracks: [], properties: { resolution: [1920, 1080], rate: 30 } },
    assets: { list: {} },
    media: [],
  };
}
function viewportFor(project) {
  return { editor: { project }, compositor: {},
    renderer: { context: { drawingBufferWidth: 960, drawingBufferHeight: 540 },
      shadowMap: { enabled: true, type: 1 } } };
}
const PLUGINS = [{ id: "native-fx", version: "10", enabled: true, phase: "enabled" }];
const id = value => value;

test("the store hook rejects projects with flagged expressions", () => {
  const isSharedMutation = source => compile(source, METHODS).needs.sharedMutation;
  const blocker = createPreviewCacheBlocker({ dynamicType, isSharedMutation });
  const previous = global.PZ;
  global.PZ = { zoidium: { previewCacheBlockers: [blocker] } };
  try {
    let reason = null;
    const clean = revisionOf(viewportFor(projectWith(["wiggle(1,2)", "value + 1", null])), PLUGINS, id, 0, null,
      value => { reason = value; });
    assert.equal(typeof clean, "string", "clean projects still key");
    assert.equal(reason, null);
    reason = null;
    // An expression that never evaluated still blocks: the source compiles on demand.
    const blocked = revisionOf(viewportFor(projectWith(["value + 1", "Math.counter=(Math.counter||0)+1; Math.counter"])),
      PLUGINS, id, 0, null, value => { reason = value; });
    assert.equal(blocked, null);
    assert.equal(reason, "An expression may keep values between frames, so this project is not cached");
  } finally {
    if (previous === undefined) delete global.PZ;
    else global.PZ = previous;
  }
});

test("blocker errors and missing walks fail closed", () => {
  const previous = global.PZ;
  global.PZ = { zoidium: { previewCacheBlockers: [() => { throw new Error("walk failed"); }] } };
  try {
    let reason = null;
    assert.equal(revisionOf(viewportFor(projectWith(["value + 1"])), PLUGINS, id, 0, null,
      value => { reason = value; }), null);
    assert.equal(reason, "Project state could not be validated");
  } finally {
    if (previous === undefined) delete global.PZ;
    else global.PZ = previous;
  }
  const blocker = createPreviewCacheBlocker({ dynamicType,
    isSharedMutation: () => { throw new Error("compile failed"); } });
  assert.equal(blocker({ forEachItemOfType(type, visit) { visit({ expression: { source: "value + 1" } }); } }),
    "An expression may keep values between frames, so this project is not cached");
  assert.equal(blocker(null), null);
  assert.equal(blocker({}), null);
});
