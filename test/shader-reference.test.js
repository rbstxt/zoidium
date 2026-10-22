"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs");
const reference = require("../plugins/shader-plus/reference.js");
const { KINDS } = require("../plugins/shader-plus/kinds.js");
const libraries = { ...require("../plugins/shader-plus/glsl-library.js").helpers, ...require("../plugins/expressions-plus/glsl-library.js") };
test("reference contains exactly every implemented include and helper overload", () => {
  assert.deepEqual(reference.entries.filter(e => e.category === "include").map(e => e.name).sort(), Object.keys(libraries).map(n => "zoidium/" + n).sort());
  const actual = [];
  for (const [name, source] of Object.entries(libraries)) for (const m of source.matchAll(/\b(float|vec[234])\s+(z\w+)\s*\(([^)]*)\)\s*\{/g)) actual.push("zoidium/" + name + ":" + m[1] + " " + m[2] + "(" + m[3] + ");");
  assert.deepEqual(reference.entries.filter(e => e.category === "helper").map(e => e.include + ":" + e.signature).sort(), actual.sort());
  assert.equal(new Set(reference.entries.map(e => e.id)).size, reference.entries.length);
  for (const e of reference.entries) for (const key of ["id", "signature", "description", "example"]) assert.ok(e[key], e.id + " " + key);
});
test("reference covers all kinds, native storage and actual runtime auxiliary bindings", () => {
  const entries = reference.entries.filter(e => e.category === "kind");
  assert.deepEqual(entries.map(e => e.kind).sort(), Object.keys(KINDS).sort());
  for (const e of entries) { const d = KINDS[e.kind].create(); assert.equal(e.storageType, d.type); assert.equal(e.dynamic, !!d.dynamic); assert.equal(e.description, KINDS[e.kind].desc); }
  const runtime = fs.readFileSync(require.resolve("../plugins/shader-plus/runtime.js"), "utf8");
  const aliases = { f: "float", v2: "vec2", i: "int" };
  const actual = [...runtime.matchAll(/uniforms\[name\s*\+\s*"(_\w+)"\]\s*=\s*\{\s*type:\s*"(\w+)"/g)].map(m => [m[1], aliases[m[2]]]).sort();
  const documented = entries.flatMap(e => e.auxiliary).filter(e => e.type !== "#define").map(e => [e.suffix, e.type]).sort();
  assert.deepEqual(documented, actual);
  const configure = runtime.slice(runtime.indexOf("function configure"), runtime.indexOf("function dispose("));
  for (const kind of ["gradient", "curve", "palette", "text"]) {
    const start = configure.indexOf('if (kind === "' + kind + '") {');
    const end = configure.indexOf('\n      if (kind ===', start + 1);
    const block = configure.slice(start, end < 0 ? undefined : end);
    const bound = [...block.matchAll(/uniforms\[name\s*\+\s*"(_\w+)"\]\s*=\s*\{\s*type:\s*"(\w+)"/g)].map(m => [m[1], aliases[m[2]]]).sort();
    assert.deepEqual(entries.find(e => e.kind === kind).auxiliary.map(a => [a.suffix, a.type]).sort(), bound, kind);
  }
  const constants = require("../plugins/shader-plus/kinds.js").constants("Name", ["Option 1", "Option 2"]);
  assert.deepEqual(constants, { Name_Option_1: 0, Name_Option_2: 1 });
});
test("reference runtime builtins are bound by Expressions+ and native CM3", () => {
  const source = fs.readFileSync(require.resolve("../plugins/expressions-plus/shaders.js"), "utf8");
  for (const e of reference.entries.filter(e => e.category === "builtin" && e.provider === "expressions-plus")) assert.ok(source.includes(e.name.replace("*", "")), e.name);
  const root = process.env.ZOIDIUM_RESOURCE_DIR;
  if (!root) return;
  const native = fs.readFileSync(require("node:path").join(root, "core-1.0.102.js"), "utf8");
  const shader = native.slice(native.indexOf("PZ.effect.shader=class"), native.indexOf("PZ.material=class"));
  const nativeType = { sampler2D: "t", vec2: "v2" };
  for (const e of reference.entries.filter(e => e.category === "builtin" && e.provider === "cm3")) {
    if (e.signature.startsWith("varying")) assert.ok(shader.includes(e.signature), e.name);
    else assert.match(shader, new RegExp(e.name + '=\\{type:"' + nativeType[e.type] + '"'), e.name);
  }
});
