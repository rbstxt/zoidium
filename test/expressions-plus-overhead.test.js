"use strict";
// Differential old-vs-new engine test for the expressions evaluation-overhead
// work. The baseline is a frozen copy of the pre-optimization implementation
// (test/fixtures/expressions-overhead-baseline/); the shared compiler is the
// live one because it did not change. A corpus of legacy and extended
// expressions resembling the profiled project's shapes is evaluated on both
// engines. The frozen engine's invalid number results are normalized to the
// documented keyed fallback before comparing values and error fields.
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
const { host, nativeHost, core } = require("./expressions-plus-harness");
const oldEngine = require("./fixtures/expressions-overhead-baseline/engine.js");

const TRAPCODE = path.join(__dirname, "../plugins/trapcode-suite/trapcode-expressions.js");
function trapMethods() {
  const scratch = nativeHost();
  new Function("PZ", fs.readFileSync(TRAPCODE, "utf8"))(scratch.PZ);
  return scratch.PZ.trapcode.expressionMethods;
}
// The harness needs the staged CM3 core; without it every test here skips.
const WIGGLE_METHODS = fs.existsSync(core) ? trapMethods() : null;
function makeState(installEngine) {
  const state = installEngine ? host({ installEngine, wiggleMethods: WIGGLE_METHODS }) : host({ wiggleMethods: WIGGLE_METHODS });
  new Function("PZ", fs.readFileSync(TRAPCODE, "utf8"))(state.PZ);
  Object.assign(state.PZ.expression.methods, WIGGLE_METHODS);
  return state;
}

const LEGACY_SCALAR = [
  "properties[\"Amount\"]/100",
  "var a = properties[\"Amount\"]/100;\n(properties[\"Map Softness\"]/37.5)*a",
  "var a = 100 - properties[\"Amount\"];\nif (a <= 0) { a = 0; }\na",
  "time*.1",
  "var sum = 0;\nfor (var i = 0; i < 20; i++) sum += random(i);\nsum",
  "var sd = properties[\"seed\"];\nrandom(sd * 3213) * 2 - 1",
  "linear(properties[\"Amount\"], 0, 100, 10, 20)",
  "clamp(properties[\"Amount\"], 0, 100)",
  "var spd = properties[\"Speed\"]*3;\nshake(time, spd, 0, 1)",
  "var f = methods.random;\nf.call(null, frame)",
  "properties[\"Strength\"]/100",
  "1 + properties[\"Amount\"]/47.62",
  "var spd = properties[\"Speed\"];\nspd",
  "var key = \"con\" + \"structor\";\nsin[key] === cos[key] ? 1 : 2",
];
const LEGACY_VECTOR = [
  "var amtx = properties[\"Rotation\"][0];\nvar amty = properties[\"Rotation\"][1];\nvar amtz = properties[\"Rotation\"][2];\n\n[amtx,amty,amtz]",
  "[properties[\"Scale\"][0],properties[\"Scale\"][1],properties[\"Scale\"][2]]",
  "[properties[\"Position\"][0],properties[\"Position\"][1],properties[\"Position\"][2]]",
];
const LEGACY_ERROR = [
  "unknownFn(1)",
  "sin.constructor(\"return 29\")()",
  "properties[\"Missing\"]",
];
const EXTENDED_SCALAR = [
  "value + 1",
  "thisProperty.value + 1",
  "seedRandom(5, true);\nrandom() + random()",
  "seedRandom(2);\nrandom() * properties[\"Amount\"]",
  "const t = time;\nlinear(t, 0, 1, 10, 20)",
  "wiggle(1, 2)",
  "methods.wiggle(1, 2)",
  "throw \"bad expression\"",
  "var x = null;\nx.nope()",
  "let n = 0;\nfor (let i = 0; i < 5000; i++) n++;\nn",
  "Math.abs(thisProperty.velocity) < 1e9 ? 1 : 0",
];
const EXTENDED_VECTOR = [
  "const t = time * 3;\n[sin(t), cos(t), 0]",
  "const v = [1, -2, 3];\nclamp(v, 0, 2)",
  "var s = properties[\"strength\"];\n[s * 0.5, s * 0.5, s * 0.5]",
  "wiggle(1, [1, 2, 3])",
];
const CYCLE = ["thisObject.property(\"B\").value + 1", "thisObject.property(\"A\").value + 1"];

function buildWorld(state) {
  const { PZ, owner } = state, root = owner.parent;
  root.customProperties = new PZ.objectList(root, PZ.property.dynamic);
  root.children.push(root.customProperties);
  const addCustom = (name, def, keyframes) => {
    const p = PZ.property.create(def);
    root.customProperties.push(p); p.load(keyframes); p.properties.name.set(name);
  };
  addCustom("Amount", { custom: true, dynamic: true, type: 0, value: 10 }, { animated: true, keyframes: [{ frame: 0, value: 10, tween: 1 }, { frame: 300, value: 16, tween: 1 }] });
  addCustom("Map Softness", { custom: true, dynamic: true, type: 0, value: 12 });
  addCustom("Speed", { custom: true, dynamic: true, type: 0, value: 2 }, { animated: true, keyframes: [{ frame: 0, value: 2, tween: 1 }, { frame: 300, value: 3, tween: 1 }] });
  addCustom("seed", { custom: true, dynamic: true, type: 0, value: 7 });
  addCustom("Strength", { custom: true, dynamic: true, type: 0, value: 80 });
  addCustom("strength", { custom: true, dynamic: true, type: 0, value: 60 });
  addCustom("Rotation", { custom: true, group: true, dynamic: true, objects: [{ dynamic: true, name: "X", type: 0, value: 10 }, { dynamic: true, name: "Y", type: 0, value: 20 }, { dynamic: true, name: "Z", type: 0, value: 30 }], type: 2 });
  addCustom("Position", { custom: true, group: true, dynamic: true, objects: [{ dynamic: true, name: "X", type: 0, value: 100 }, { dynamic: true, name: "Y", type: 0, value: 200 }, { dynamic: true, name: "Z", type: 0, value: 50 }], type: 2 });
  addCustom("Scale", { custom: true, group: true, dynamic: true, objects: [{ dynamic: true, name: "X", type: 0, value: 1 }, { dynamic: true, name: "Y", type: 0, value: 2 }, { dynamic: true, name: "Z", type: 0, value: 1 }], type: 2 });
  const defs = {};
  const assign = (key, kind) => {
    defs[key] = kind === "vector"
      ? { name: key, dynamic: true, group: true, type: 2, objects: [{ dynamic: true, name: "X", type: 0, value: 5 }, { dynamic: true, name: "Y", type: 0, value: 5 }, { dynamic: true, name: "Z", type: 0, value: 5 }] }
      : { name: key, dynamic: true, type: 0, value: 5 };
  };
  [...LEGACY_SCALAR, ...LEGACY_ERROR, ...EXTENDED_SCALAR].forEach((_, i) => assign("s" + i, "scalar"));
  [...LEGACY_VECTOR, ...EXTENDED_VECTOR].forEach((_, i) => assign("v" + i, "vector"));
  const list = new PZ.propertyList(defs, owner);
  list.load(); owner.children.push(list);
  return list;
}

function freeze(value) {
  // Normalize into main-realm values (results come from two different VM
  // contexts, whose Array prototypes never compare equal).
  if (Array.isArray(value)) return Array.from(value, freeze);
  if (typeof value === "number" && Number.isNaN(value)) return "NaN";
  return value;
}

test("old and new engines agree on a legacy/extended corpus with errors and cycles", { skip: !fs.existsSync(core) }, () => {
  const previous = makeState(oldEngine.installEngine), current = makeState(undefined);
  for (const state of [previous, current]) {
    state.list = buildWorld(state);
    const sources = [...LEGACY_SCALAR, ...LEGACY_ERROR, ...EXTENDED_SCALAR];
    sources.forEach((source, i) => { state.list["s" + i].expression = new state.PZ.expression(source); });
    [...LEGACY_VECTOR, ...EXTENDED_VECTOR].forEach((source, i) => { state.list["v" + i].expression = new state.PZ.expression(source); });
    state.a.expression = new state.PZ.expression(CYCLE[0]);
    state.b.expression = new state.PZ.expression(CYCLE[1]);
  }
  const frames = [0, 12.5, 90, 3, 300];
  const scalarKeys = [...LEGACY_SCALAR, ...LEGACY_ERROR, ...EXTENDED_SCALAR].map((_, i) => "s" + i);
  const vectorKeys = [...LEGACY_VECTOR, ...EXTENDED_VECTOR].map((_, i) => "v" + i);
  let normalized = 0;
  const run = (state, normalizeInvalidNumbers = false) => {
    const out = [];
    for (const frame of frames) {
      for (const key of [...scalarKeys, ...vectorKeys]) {
        const prop = state.list[key];
        let value = prop.get(frame);
        const error = state.engine.error(prop);
        if (normalizeInvalidNumbers && prop.definition.type === state.PZ.property.type.NUMBER &&
            typeof value !== "function" && !Number.isFinite(Number(value)) &&
            (error === "Expression error: The result is not a finite number." ||
             error === "Expression error: random() needs a seed. Use random(frame), or call seedRandom(1) first.")) {
          value = state.engine.baseAt(prop, frame);
          normalized++;
        }
        out.push([key, frame, freeze(value), error, prop.expression.error]);
      }
      out.push(["a", frame, freeze(state.a.get(frame)), state.engine.error(state.a), state.a.expression.error]);
      out.push(["b", frame, freeze(state.b.get(frame)), state.engine.error(state.b), state.b.expression.error]);
    }
    // Base-value reads through the original getters stay identical too.
    for (const key of ["s0", "v0"]) out.push([key, "base", freeze(state.engine.baseAt(state.list[key], 30))]);
    return out;
  };
  const before = run(previous, true), after = run(current);
  assert.ok(normalized > 0, "corpus covers the keyed fallback");
  assert.equal(after.length, before.length);
  assert.ok(after.length > 150, "corpus covers hundreds of evaluations");
  for (let i = 0; i < before.length; i++) {
    assert.deepEqual(after[i], before[i], JSON.stringify(before[i].slice(0, 2)));
  }
  console.log("expressions differential: ", after.length, "comparisons, all identical");
});

test("a methods-table alias of wiggle still sees the base value", { skip: !fs.existsSync(core) }, () => {
  const read = installEngine => {
    const state = makeState(installEngine);
    state.PZ.expression.methods.wobble = state.PZ.expression.methods.wiggle;
    state.list = buildWorld(state);
    state.list.v0.expression = new state.PZ.expression("wobble(2, 30)");
    state.list.s0.expression = new state.PZ.expression("wobble(1, 4)");
    return [0, 7, 45.5, 120].flatMap(frame => [freeze(state.list.v0.get(frame)), freeze(state.list.s0.get(frame)),
      state.list.v0.expression.error, state.list.s0.expression.error]);
  };
  const before = read(oldEngine.installEngine), after = read(undefined);
  assert.deepEqual(after, before);
  assert.ok(before.some(value => Array.isArray(value) || Number.isFinite(value)), "the alias evaluates to values");
});
