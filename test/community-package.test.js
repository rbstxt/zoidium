"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { execFileSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const Ajv = require("ajv");
const S = require("../zoidium/community-safe-json");
const P = require("../zoidium/community-package");
const I = require("../zoidium/community-interpreter");
const { pack } = require("../tools/pack-community-plugin");
const example = () => JSON.parse(fs.readFileSync(path.join(__dirname, "../examples/community-filter/manifest.json"), "utf8"));
const digest = bytes => createHash("sha256").update(bytes).digest("hex");

test("community example matches schema and shared validator", () => {
  const validate = new Ajv({ strict: true, allErrors: true }).compile(require("../plugins/community-manifest.schema.json"));
  assert.equal(validate(example()), true, JSON.stringify(validate.errors));
  assert.equal(P.manifest(example()).profile, "isolated-effects");
});
for (const field of ["modules", "nativeEffects", "coreScripts", "objectTypes", "objectClasses", "materialTypes", "layers", "dependencies", "alwaysEnabled", "visibility", "permissions", "url", "legacyIds", "html", "css"]) {
  test("community rejects privileged field " + field, () => {
    const m = example(); m[field] = [];
    assert.throws(() => P.manifest(m), /unknown field/);
  });
}
for (const format of ["module", "commonjs", "native-fx", "esm", "https://example.invalid/source", "guest-script-v2"]) {
  test("community rejects source format " + format, () => { const m = example(); m.sourceFormat = format; assert.throws(() => P.manifest(m)); });
}
for (const raw of ['{"x":1,"x":2}', '{"x":1,"\\u0078":2}', '{"__proto__":{}}', '{"constructor":{}}', '{"prototype":{}}', '{"x":{"constructor":0}}', '1e999', '[1,]', '{"x":1}junk']) {
  test("community safe JSON rejects " + raw, () => assert.throws(() => S.parse(raw)));
}
test("community safe JSON rejects excessive depth and size", () => {
  assert.throws(() => S.parse("[".repeat(66) + "0" + "]".repeat(66)), /nesting/);
  assert.throws(() => S.parse('"1234"', 5), /size/);
  assert.throws(() => P.parse(new Uint8Array([0xff])), /encoded data|encoding/i);
});
for (const asset of ["../guest.js", "/guest.js", "./guest.js", "a/../guest.js", "a//b", "a\\b", "https://example.invalid/a", "data:text/plain,a", "a?b", "a#b", "a%2fb", "a/.", "a/..", "a\u0000b"]) {
  test("community rejects noncanonical asset " + JSON.stringify(asset), () => assert.throws(() => S.path(asset)));
}
test("community enforces identity ownership and collisions", () => {
  for (const id of ["core", "community-1234", "community-" + "F".repeat(32)]) {
    const m = example(); m.id = id; assert.throws(() => P.manifest(m));
  }
  const m = example();
  assert.throws(() => P.manifest(m, [m.id]), /collision/);
  assert.throws(() => P.manifest(m, [m.effects[0].id]), /collision/);
  m.effects[0].id = "community-" + "f".repeat(32) + "-fx-gain";
  assert.throws(() => P.manifest(m), /ownership/);
  const n = example(); n.effects.push(n.effects[0]); assert.throws(() => P.manifest(n), /collision/);
});
test("community rejects unsupported shader, UI and declaration values", () => {
  for (const mutate of [
    m => { m.effects[0].template = "arbitrary-glsl"; },
    m => { m.effects[0].shader = "shader.glsl"; },
    m => { m.effects[0].ui[0].children[0].url = "https://example.invalid"; },
    m => { m.effects[0].ui[0].children[0].property = "other"; },
    m => { m.effects[0].properties[0].default = NaN; },
    m => { m.effects[0].properties[0].default = 10; },
    m => { m.effects[0].actions = Array(65).fill("reset"); },
    m => { m.assets = Array.from({ length: 4097 }, (_, i) => "a" + i); },
  ]) { const m = example(); mutate(m); assert.throws(() => P.manifest(m)); }
});
test("standalone packer confines files, never executes scripts, and preserves registry", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "zoidium-community-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, "source"), output = path.join(root, "output");
  fs.cpSync(path.join(__dirname, "../examples/community-filter"), source, { recursive: true });
  const registry = path.join(__dirname, "../plugins/registry.json"), before = fs.readFileSync(registry);
  fs.writeFileSync(path.join(source, "package.json"), JSON.stringify({ scripts: { prepare: "exit 99", build: "exit 99" } }));
  const result = pack(source, output);
  assert.equal(P.parse(fs.readFileSync(result.output)).manifest.id, example().id);
  assert.equal(result.bytes, fs.statSync(result.output).size);
  assert.equal(result.hash, "sha256-" + createHash("sha256").update(fs.readFileSync(result.output)).digest("base64"));
  assert.deepEqual(before, fs.readFileSync(registry));
  assert.throws(() => pack(source, path.join(__dirname, "../plugins/forbidden")), /shipped/);
  assert.throws(() => pack(source, output), /EEXIST/);
  fs.unlinkSync(path.join(source, "guest.js"));
  fs.writeFileSync(path.join(root, "outside.js"), "function prepare(){return {}};");
  fs.symlinkSync(path.join(root, "outside.js"), path.join(source, "guest.js"));
  assert.throws(() => pack(source, path.join(root, "escape-output")), /escapes/);
  fs.unlinkSync(path.join(source, "guest.js"));
  fs.writeFileSync(path.join(source, "guest.js"), " ".repeat(P.LIMITS.packageBytes + 1));
  assert.throws(() => pack(source, path.join(root, "large-output")), /size/);
});
for (const source of ["import x from 'x'", "export function prepare(){}", "import('x')", "async function prepare(){}", "function* prepare(){}", "await 0"]) {
  test("guest source rejects modules and async syntax " + source, () => assert.throws(() => I.source(source)));
}
test("all shipped bundles retain their base bytes and pass deterministic rebuild", () => {
  const root = path.join(__dirname, "..");
  const files = execFileSync("git", ["ls-tree", "-r", "--name-only", "7e0c2b2", "plugins"], { cwd: root, encoding: "utf8" }).trim().split("\n").filter(f => f.endsWith("/bundle.json"));
  assert.ok(files.length > 0);
  for (const file of files) assert.equal(digest(fs.readFileSync(path.join(root, file))), digest(execFileSync("git", ["show", "7e0c2b2:" + file], { cwd: root, maxBuffer: 32 * 1024 * 1024 })), file);
  execFileSync(process.execPath, ["tools/build-plugin-bundles.js", "--check"], { cwd: root });
});
