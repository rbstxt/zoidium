"use strict";

// Coverage for the Trapcode Suite expression upgrade: the OpenZoid
// wiggle() family installs missing-only onto PZ.expression.methods, the
// evaluation context (frame/property/value) is published, property getters
// pass the property through, and everything restores on uninstall.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const projectRoot = path.resolve(__dirname, "..");

function loadCommon(PZ, THREE) {
  const source = fs.readFileSync(
    path.join(projectRoot, "plugins/trapcode-suite/trapcode-common.js"),
    "utf8"
  );
  new Function("PZ", "THREE", source)(PZ, THREE || {});
  return PZ.trapcode;
}

function stockRandom(e) {
  const t = 1e4 * Math.sin(e);
  return t - Math.floor(t);
}

function wiggleCtx(overrides = {}) {
  const T = loadCommon({}, {});
  return Object.assign(
    {
      random: stockRandom,
      currentFrame: 0,
      currentProperty: null,
      currentValue: 0,
    },
    T.expressionMethods,
    overrides
  );
}

function fakeProp(address, baseValue) {
  return {
    getAddress: () => address.split("."),
    getBaseValue: () => baseValue,
  };
}

test("expression methods table carries the OpenZoid additions", () => {
  const T = loadCommon({}, {});
  const table = T.expressionMethods;
  for (const key of [
    "valueAtTime", "property", "wiggle", "_wiggle", "_propertySeed",
    "_wiggleVector", "loopIn", "loopOut", "pingPong", "toFixed",
    "radiansToDegrees", "degreesToRadians", "easeIn", "easeOut", "easeInOut",
  ]) {
    assert.equal(typeof table[key], "function", key);
  }
});

test("wiggle is deterministic, animated, and seeded per property", () => {
  const T = loadCommon({}, {});
  const at = (frame, address, base) =>
    T.expressionMethods.wiggle.call(
      wiggleCtx({ currentFrame: frame, currentProperty: fakeProp(address, 0), currentValue: base }),
      2, 10
    );
  assert.equal(at(10, "a.b", 380), at(10, "a.b", 380), "deterministic");
  assert.notEqual(at(0, "a.b", 380), at(30, "a.b", 380), "animated across frames");
  assert.notEqual(at(10, "a.b", 380), at(10, "a.c", 380), "seeded per property");
  const v = at(10, "a.b", 380);
  assert.ok(Math.abs(v - 380) <= 10, "bounded by amplitude, got " + v);
  const vec = T.expressionMethods.wiggle.call(
    wiggleCtx({ currentFrame: 7, currentProperty: fakeProp("x", 0), currentValue: [5, 5] }),
    3, [4, 2]
  );
  assert.equal(vec.length, 2);
  assert.ok(Math.abs(vec[0] - 5) <= 4 && Math.abs(vec[1] - 5) <= 2);
});

test("companion methods behave", () => {
  const T = loadCommon(
    { tween: { easing: { Quadratic: { In: (e) => e * e, Out: (e) => e, InOut: (e) => e } } } },
    {}
  );
  const m = T.expressionMethods;
  assert.equal(m.loopIn(3), 3);
  assert.equal(m.loopOut(3), 3);
  assert.equal(m.pingPong(3), 3);
  assert.equal(m.toFixed(3.14159, 2), "3.14");
  assert.equal(m.radiansToDegrees(Math.PI), 180);
  assert.equal(m.degreesToRadians(180), Math.PI);
  assert.equal(m.easeIn(0.5), 0.25);
  assert.equal(m.property("x"), "x");
  assert.equal(m.valueAtTime(7, 3), 7);
  assert.equal(m._propertySeed(fakeProp("a.b", 0)), m._propertySeed(fakeProp("a.b", 0)));
  assert.notEqual(m._propertySeed(fakeProp("a.b", 0)), m._propertySeed(fakeProp("a.c", 0)));
});

function stubPZ() {
  const calls = { evaluate: [] };
  const methods = {
    add(a, b) { return a + b; },
  };
  const PZ = {
    clip: function () {},
    tween: { easing: { Quadratic: { In: (e) => e, Out: (e) => e, InOut: (e) => e } } },
    expression: {
      methods,
      prototype: {
        evaluate(e, t) {
          calls.evaluate.push([e, t]);
          return "stock";
        },
      },
    },
    property: { dynamic: {} },
  };
  PZ.property.dynamic.prototype = {
    get(e) { return "dyn:" + e; },
  };
  PZ.property.dynamic.group = {
    prototype: {
      get(e) { return "grp:" + e; },
    },
  };
  PZ.property.dynamic.keyframes = {
    prototype: {
      get(e) { return "kfs:" + e; },
    },
  };
  return { PZ, calls, methods };
}

test("install adds missing methods, context, and passthrough; uninstall restores", () => {
  const { PZ, calls, methods } = stubPZ();
  const T = loadCommon(PZ, {});
  const stockEvaluate = PZ.expression.prototype.evaluate;
  const stockGets = [
    PZ.property.dynamic.prototype.get,
    PZ.property.dynamic.group.prototype.get,
    PZ.property.dynamic.keyframes.prototype.get,
  ];
  T.installExpressionSupport(PZ);
  // Methods: adds wiggle family, keeps stock add().
  assert.equal(typeof methods.wiggle, "function");
  assert.equal(typeof methods._wiggle, "function");
  assert.equal(typeof methods.loopIn, "function");
  assert.equal(methods.add(1, 2), 3);
  assert.ok(PZ.expression.prototype.evaluate.__trapcodeSuite);
  assert.ok(PZ.property.dynamic.prototype.get.__trapcodeSuite);
  // Evaluate wrapper publishes context and uses the OpenZoid call shape.
  const seen = [];
  const fakeThis = {
    fn(...args) {
      seen.push(args);
      return "custom";
    },
    getCustomProperties() {
      return { c: 1 };
    },
  };
  const prop = fakeProp("p.q", 42);
  const parentObject = { parentObject: null, tryGetParentOfType: () => null };
  const out = PZ.expression.prototype.evaluate.call(fakeThis, 7, parentObject, prop);
  assert.equal(out, "custom");
  assert.equal(methods.currentFrame, 7);
  assert.equal(methods.currentProperty, prop);
  assert.equal(methods.currentValue, 42);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].length, 7);
  assert.equal(seen[0][5], prop);
  assert.equal(seen[0][6], 42);
  // Getter wrapper passes the property itself through.
  const holder = {
    expression: { evaluate(e, t, r) { calls.evaluate.push([e, t, r]); return "via-expr"; } },
    parentObject,
  };
  assert.equal(PZ.property.dynamic.prototype.get.call(holder, 3), "via-expr");
  assert.deepEqual(calls.evaluate[0], [3, parentObject, holder]);
  // Dead wrapper falls back to stock without the property.
  holder.expression = null;
  assert.equal(PZ.property.dynamic.prototype.get.call(holder, 4), "dyn:4");
  T.uninstallExpressionSupport(PZ);
  assert.equal(methods.wiggle, undefined);
  assert.equal(methods.loopIn, undefined);
  assert.equal(methods.add(1, 2), 3, "stock method survives");
  assert.equal(PZ.expression.prototype.evaluate, stockEvaluate);
  const restored = [
    PZ.property.dynamic.prototype.get,
    PZ.property.dynamic.group.prototype.get,
    PZ.property.dynamic.keyframes.prototype.get,
  ];
  assert.deepEqual(restored, stockGets);
});

test("install is loud without the runtime surface", () => {
  const T = loadCommon({}, {});
  assert.throws(() => T.installExpressionSupport({}), /PZ\.expression\.methods/);
  assert.throws(
    () => T.installExpressionSupport({ expression: { methods: {}, prototype: {} } }),
    /PZ\.expression\.prototype\.evaluate/
  );
  assert.throws(
    () =>
      T.installExpressionSupport({
        expression: { methods: {}, prototype: { evaluate() {} } },
        property: {},
      }),
    /dynamic property getters/
  );
  // Uninstall without install is a no-op.
  T.uninstallExpressionSupport({});
});

test("getBaseValue installs missing-only and interpolates", () => {
  const T = loadCommon({}, {});
  assert.equal(typeof T.getBaseValueImpls.dynamic, "function");
  assert.equal(typeof T.getBaseValueImpls.group, "function");
  assert.equal(typeof T.getBaseValueImpls.keyframes, "function");
  const { PZ } = stubPZ();
  T.installExpressionSupport(PZ);
  // Installed where missing.
  assert.equal(typeof PZ.property.dynamic.prototype.getBaseValue, "function");
  assert.equal(typeof PZ.property.dynamic.group.prototype.getBaseValue, "function");
  assert.equal(typeof PZ.property.dynamic.keyframes.prototype.getBaseValue, "function");
  // Dynamic base returns undefined; group fans out to children.
  assert.equal(PZ.property.dynamic.prototype.getBaseValue(5), undefined);
  const group = {
    objects: [{ getBaseValue: () => 2 }, { getBaseValue: () => 4 }],
    value: [0, 0],
  };
  assert.deepEqual(
    PZ.property.dynamic.group.prototype.getBaseValue.call(group, 5),
    [2, 4]
  );
  // Keyframes interpolate without touching expressions.
  const kf = {
    keyframes: [
      { frame: 0, value: 100, tween: 0 },
      { frame: 10, value: 200, tween: 0 },
    ],
    getClosestKeyframeIndex(e) {
      return e < 10 ? 0 : 1;
    },
  };
  const getBaseValue = PZ.property.dynamic.keyframes.prototype.getBaseValue;
  assert.equal(getBaseValue.call(kf, 0), 100);
  assert.equal(getBaseValue.call(kf, 10), 200);
  T.uninstallExpressionSupport(PZ);
  assert.equal(PZ.property.dynamic.prototype.getBaseValue, undefined);
  assert.equal(PZ.property.dynamic.group.prototype.getBaseValue, undefined);
  assert.equal(PZ.property.dynamic.keyframes.prototype.getBaseValue, undefined);
});

test("getBaseValue installs onto inheriting prototypes, not just the base", () => {
  const T = loadCommon({}, {});
  // Mirror the runtime chain: keyframes/group inherit dynamic.
  const dyn = {};
  const kfs = Object.create(dyn);
  const grp = Object.create(dyn);
  const PZ = {
    expression: { methods: {}, prototype: { evaluate() { return "stock"; } } },
    property: {
      dynamic: Object.assign(function () {}, {
        prototype: dyn,
      }),
    },
  };
  PZ.property.dynamic.group = { prototype: grp };
  PZ.property.dynamic.keyframes = { prototype: kfs };
  dyn.get = function () { return "dyn"; };
  grp.get = function () { return "grp"; };
  kfs.get = function () { return "kfs"; };
  T.installExpressionSupport(PZ);
  assert.equal(
    Object.prototype.hasOwnProperty.call(kfs, "getBaseValue"),
    true,
    "keyframes gets its own interpolating impl, not the inherited base stub"
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(grp, "getBaseValue"),
    true
  );
  T.uninstallExpressionSupport(PZ);
  assert.equal(Object.prototype.hasOwnProperty.call(kfs, "getBaseValue"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(grp, "getBaseValue"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(dyn, "getBaseValue"), false);
});
