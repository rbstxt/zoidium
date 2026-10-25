"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");
const test = require("node:test");
const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const beforeSource = read("test/fixtures/plugin-scanners-before.txt");
const afterSource = read("zoidium/plugin-manager-scanners.js");
const plain = value => JSON.parse(JSON.stringify(value));

function load(source, expressionAPI) {
  let visits = 0, maps = 0;
  class CountingMap extends WeakMap {
    constructor() { super(); maps++; }
    set(key, value) { visits++; return super.set(key, value); }
  }
  const sandbox = vm.createContext({ window: { ZoidiumExpressions: expressionAPI }, PZ: {}, WeakMap: CountingMap });
  vm.runInContext(read("zoidium/plugin-manager-state.js"), sandbox);
  vm.runInContext(source, sandbox);
  const manager = sandbox.window.ZoidiumPluginManagerInternals;
  return {
    manager,
    scan(data) { return plain(manager.projectPluginRequirements(data)); },
    counts() { return { visits, maps }; },
  };
}

function compare(data, expressionAPI) {
  const before = load(beforeSource, expressionAPI), after = load(afterSource, expressionAPI);
  const expected = before.scan(data);
  assert.deepEqual(after.scan(data), expected);
  return expected;
}

test("old and shared scanners agree on every existing dependency-test input", () => {
  let comparisons = 0;
  const filename = path.join(__dirname, "plugin-dependencies.test.js");
  const localRequire = createRequire(filename);
  const source = fs.readFileSync(filename, "utf8").replace(
    "return sandbox.__helpers;",
    `const original = sandbox.__helpers.projectPluginRequirements;
     sandbox.__helpers.projectPluginRequirements = data => {
       const actual = original(data);
       assert.equal(JSON.stringify(actual), JSON.stringify(compareInput(data)));
       return actual;
     };
     return sandbox.__helpers;`,
  );
  // Use the test file's exact constants, including its synthetic registry entries.
  const oldBody = beforeSource.slice(beforeSource.indexOf("  function normalizeProjectPlugins"),
    beforeSource.indexOf("  // Numeric-type placeholders:"));
  const compareInput = data => {
    comparisons++;
    const oldTest = fs.readFileSync(filename, "utf8");
    const setup = oldTest.slice(oldTest.indexOf("function loadDependencyHelpers()"), oldTest.indexOf("const helpers ="));
    const context = vm.createContext({ assert, vm, managerSource: oldBody +
      "\n  function installMissingFactoriesForRequirements(plugins) {}", data });
    vm.runInContext(setup + "\nresult = loadDependencyHelpers().projectPluginRequirements(data);", context);
    return plain(context.result);
  };
  vm.runInNewContext(source, {
    require(id) { return id === "node:test" ? (_name, fn) => fn() : localRequire(id); },
    __dirname, compareInput,
  }, { filename });
  assert.ok(comparisons >= 50, `compared ${comparisons} dependency inputs`);
});

test("old and shared scanners agree on all checked-in JSON fixtures", () => {
  const files = fs.readdirSync(path.join(__dirname, "fixtures")).filter(file => file.endsWith(".json"));
  assert.ok(files.length > 0);
  for (const file of files) compare(JSON.parse(read("test/fixtures/" + file)));
});

test("old and shared scanners agree on every legacy project migration fixture", () => {
  const filename = path.join(__dirname, "project-compatibility.test.js");
  const localRequire = createRequire(filename);
  const compatibility = localRequire("../zoidium/project-compatibility.js");
  let comparisons = 0;
  const wrapped = {
    ...compatibility,
    migrateProject(data) {
      compare(data);
      const migrated = compatibility.migrateProject(data);
      compare(migrated);
      comparisons++;
      return migrated;
    },
  };
  // Run the existing fixture builders in the host realm so native assertions
  // retain their normal prototype identities.
  const run = new Function("require", fs.readFileSync(filename, "utf8"));
  run(id => {
    if (id === "node:test") return (_name, fn) => fn();
    if (id === "../zoidium/project-compatibility.js") return wrapped;
    return localRequire(id);
  });
  assert.ok(comparisons >= 10, `compared ${comparisons} legacy migrations before and after migration`);
});

test("every detector preserves requirements and descriptor ordering", () => {
  const { manager } = load(afterSource);
  const nodes = [
    ...Array.from(manager.NATIVE_FX_EFFECTS.keys(), type => ({ type })),
    ...Array.from(manager.NATIVE_EFFECT_PLUGINS.keys(), type => ({ type })),
    ...Array.from(manager.PLUGIN_MATERIAL_TYPES.keys(), type => ({ type })),
    { type: "zoidium:example-tools/example-object" },
    { type: 3, objectType: 5 },
    { type: 1, properties: { text: "Text", font: "font-id", bevelSize: 0.1,
      spacing: { keyframes: [{ value: 3 }] }, bevelDetail: { value: 4 } } },
    { _zoidiumParticlesPlusSprite: "star" },
    { type: "timedisplacement", properties: { source: { keyframes: [{ value: "track:id:other" }] } } },
    { definition: { _zoidiumShaderLayerSource: true } },
    { comp: { id: "nested-composition" } },
    { type: 2, compId: "nested-composition" },
    { type: 1, properties: { zoidiumTrackTo: "target" } },
    { expression: { source: "value + 2" }, zoidiumControls: [] },
    { properties: { fragShader: "zTime + ctl_amount; // #include <zoidium/noise>" } },
    ...["gradient", "curve", "palette", "text"].map(kind => ({ zoidiumShader: { kind } })),
  ];
  const numeric = Array.from(manager.NUMERIC_OBJECT_TYPES.keys(), type => ({ type, properties: {} }));
  const layers = Array.from(manager.NUMERIC_LAYER_TYPES.keys(), type => ({ object: { type, effects: [] } }));
  const data = { plugins: [{ id: "example-tools", version: "1", objects: ["saved-object"] }], nodes,
    sequence: { videoTracks: [{ clips: layers }], objects: numeric },
    media: [{ baseType: "track", data: [{ clips: [{ object: { type: 4, effects: [], objects: numeric } }] }] }] };
  const found = compare(data);
  for (const id of ["native-fx", "layer-input", "material-plus", "example-tools", "trapcode-suite",
    "text-plus", "particles-plus", "precomp-plus", "constraints", "expressions-plus", "shader-plus",
    "effector-plus", "optical-flares", "camera-plus"]) assert.ok(found.some(item => item.id === id), id);
  for (const node of nodes) compare(node);
  compare(data, { requires: () => false });
  compare(data, { requires: () => true });
});

test("nested composition records, JSON strings, cycles and numeric aliases keep legacy rules", () => {
  const aliased = { type: 7, properties: {} };
  const layer = { type: 9, properties: {}, objects: [aliased] };
  const track = { clips: [{ object: layer }] };
  const data = { media: [{ baseType: "object3d", data: aliased },
    { baseType: "track", data: [track] },
    { data: JSON.stringify({ type: "zoidium:opaque/json-string" }) }],
    objects: [aliased], sequence: { audioTracks: [track], videoTracks: [track] },
    nested: { comp: { id: "one" }, media: [{ comp: { id: "two" } }] } };
  data.self = data;
  aliased.objects = [aliased, data];
  compare(data);
  compare({ sequence: data.sequence, objects: [aliased], media: data.media });
  // Legacy numeric traversal follows its fixed key order, not insertion order.
  compare({ media: [{ baseType: "object3d", data: aliased }], objects: [{ type: 10, properties: {} }] });
});

test("own keys, inherited keys and array properties retain detector-specific exclusions", () => {
  const inherited = Object.create({ ignored: { type: "echo" } });
  inherited.own = { type: "matcap" };
  Object.defineProperty(inherited, "hidden", { value: { type: "pbrplus" } });
  const array = [{ type: "echo" }];
  array.extra = { type: "matcap", zoidiumShader: { kind: "gradient" } };
  Object.defineProperty(array, "1", { value: { type: "pbrplus", zoidiumShader: { kind: "text" } }, enumerable: false });
  compare({ inherited, array, prototypeKeys: JSON.parse('{"__proto__":{"type":"echo"},"constructor":{"type":"pbrplus"}}') });
});

test("shared scanning tracks records once for ordinary serialized projects", () => {
  const scanner = load(afterSource);
  const before = scanner.counts();
  const data = { nodes: Array.from({ length: 1000 }, () => ({ properties: { value: [1, 2, 3] } })) };
  scanner.scan(data);
  const after = scanner.counts();
  assert.equal(after.maps - before.maps, 1);
  assert.equal(after.visits - before.visits, 3003, "3002 records plus the root numeric path bit");
});
