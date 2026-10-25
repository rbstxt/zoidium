"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
const { host, core } = require("./expressions-plus-harness");
const api = require("../plugins/expressions-plus/api");
const enginePath = path.join(__dirname, "../plugins/expressions-plus/engine.js");
// Run the same guarded engine with the original full context for comparison.
const full = { exports: {} };
new Function("require", "module", fs.readFileSync(enginePath, "utf8"))(name => name === "./api.js"
  ? { ...api, createAPI(options) { return api.createAPI({ ...options, needs: undefined }); } }
  : require(path.resolve(path.dirname(enginePath), name)), full);
function wiggle(state) {
  new Function("PZ", fs.readFileSync(path.join(__dirname, "../plugins/trapcode-suite/trapcode-expressions.js"), "utf8"))(state.PZ);
  // The production engine captures these methods at activation. Update the
  // methods table for this test's already installed engine as well.
  Object.assign(state.PZ.expression.methods, state.PZ.trapcode.expressionMethods);
}
test("nested legacy reads, cycles, random and wiggle retain values and errors", { skip: !fs.existsSync(core) }, () => {
  const optimized = host(), original = host({ installEngine: full.exports.installEngine });
  wiggle(optimized); wiggle(original);
  const pairs = [
    ['thisObject.property("B").value + value', 'sin(frame)*20'],
    ['seedRandom(5,true); random() + thisObject.property("B").value + random()', 'random(frame)'],
    ['thisObject.property("B").value + value', 'wiggle(2,3)'],
    ['thisObject.property("B").value + value', 'var f=methods.wiggle; f(2,3)'],
    ['thisObject.property("B").value + 1', 'thisObject.property("A").value + 1'],
    ['thisObject.property("B").value + 1', 'sin.constructor("return 1")()'],
    ['thisObject.property("B").value + 1', 'var x=null; x.nope()'],
  ];
  for (const [a, b] of pairs) {
    for (const state of [optimized, original]) {
      state.a.expression = new state.PZ.expression(a); state.b.expression = new state.PZ.expression(b);
    }
    for (const frame of [0, 12.5, 90, 3, 12.5]) {
      const evaluate = state => ({ a: state.a.get(frame), b: state.b.get(frame),
        aError: state.engine.error(state.a), bError: state.engine.error(state.b) });
      assert.deepEqual(evaluate(optimized), evaluate(original), `${a}, ${b} at ${frame}`);
    }
  }
});
test("activation prepares existing expressions and native serialized copies", { skip: !fs.existsSync(core) }, () => {
  const state = host(); const { PZ, a, b, owner } = state;
  a.expression = new PZ.expression("value + 4");
  const saved = JSON.parse(JSON.stringify(a));
  const list = new PZ.propertyList({ copy: { name: "Copy", dynamic: true, type: 0, value: 0 } }, owner);
  list.load({ copy: saved });
  assert.equal(list.copy.get(0), 11); assert.notEqual(list.copy.expression, a.expression);
  list.copy.expression = null; assert.equal(Object.hasOwn(list.copy, "get"), false);
  a.expression = null;
  // An existing property can be prepared without changing its getter.
  state.engine.prepare(b); assert.equal(Object.hasOwn(b, "get"), false);
});
test("computed custom-property calls retain legacy helper receivers", { skip: !fs.existsSync(core) }, () => {
  const optimized = host(), original = host({ installEngine: full.exports.installEngine });
  for (const state of [optimized, original]) {
    wiggle(state);
    const { PZ, owner } = state, root = owner.parent;
    const project = new PZ.object(); project.children = [root]; root.parent = project;
    root.customProperties = new PZ.objectList(root, PZ.property.dynamic);
    root.children.push(root.customProperties);
    const helper = PZ.property.create({ custom: true, dynamic: true, type: 0, value: 0 });
    root.customProperties.push(helper); helper.load(); helper.properties.name.set("Fn");
    helper.expression = new PZ.expression("wiggle");
    state.a.expression = new PZ.expression('properties["Fn"](2,3)');
  }
  for (const frame of [0, 12.5, 90, 3, 12.5]) {
    assert.equal(optimized.a.get(frame), original.a.get(frame));
    assert.equal(optimized.engine.error(optimized.a), null);
  }
});
