"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
const { core, cache } = require("./expressions-plus-harness.js");
function host() {
  const vm = require("node:vm"), realm = vm.createContext({ PZ: {}, ISNODE: true, console, setTimeout, clearTimeout });
  for (const file of ["three.r91.min.js", "core-1.0.102.js"]) vm.runInContext(fs.readFileSync(path.join(cache, file), "utf8"), realm);
  return realm;
}
const { installRuntime } = require("../plugins/shader-plus/runtime.js");
const { forHost } = require("../plugins/core/shader-pipeline.js");
const { KINDS } = require("../plugins/shader-plus/kinds.js");
const root = path.join(__dirname, "..");
function effect(PZ, records, source) {
  const fx = Object.create(PZ.effect.shader.prototype);
  Object.defineProperty(fx, "parentLayer", { value: { properties: { resolution: { get: () => [320, 180] } } } });
  fx.customProperties = new PZ.objectList(fx, PZ.property);
  for (const record of records) { const p = PZ.property.create(record.type); fx.customProperties.push(p); p.load(record); }
  fx.properties = { enabled: { get: () => true }, fragShader: { get: () => source } };
  fx.textures = new Map();
  fx.pass = { uniforms: {}, material: { defines: {} }, enabled: true };
  fx.onShaderError = { update(message) { throw new Error(message); } };
  return fx;
}
function capture(fx, frame = 0) {
  fx.fragmentShaderNeedsUpdate = true; fx.update(frame);
  return JSON.parse(JSON.stringify({ uniforms: fx.pass.uniforms, defines: fx.pass.material.defines, fragment: fx.pass.material.fragmentShader }));
}
function install(PZ, THREE, options = {}) {
  const restore = [], pipeline = forHost(PZ, (h, k, make) => { const original = h[k]; restore.push(() => { h[k] = original; }); h[k] = make(original); });
  const runtime = installRuntime({ PZ, THREE, pipeline, onDispose: fn => restore.push(fn), doc: {}, curves: {}, editor: () => null, presetFont: () => null,
    patch(h, k, make) { const original = h[k]; restore.push(() => { h[k] = original; }); h[k] = make(original); }, ...options });
  const dispose = () => { runtime.disposeAll(); for (const fn of restore.reverse()) fn(); };
  dispose.runtime = runtime; return dispose;
}
test("number kinds preserve native fractional values, linear keys and expressions", { skip: !fs.existsSync(core) }, () => {
  const { PZ, THREE } = host();
  const record = (kind, value, animated = false) => ({ type: KINDS[kind].create(), properties: { name: "Value" }, animated,
    keyframes: animated ? [{ frame: 0, value: 0, tween: 1 }, { frame: 10, value: 1, tween: 1 }] : [{ frame: 0, value, tween: 1 }] });
  const source = "uniform float Value; void main(){gl_FragColor=vec4(Value,0.0,0.0,1.0);}";
  const cases = [["checkbox", .25, false, 0], ["dropdown", .75, false, 0], ["dropdown", 0, true, 7]];
  const effects = cases.map(([kind, value, animated]) => effect(PZ, [record(kind, value, animated)], source));
  const expression = effect(PZ, [record("checkbox", 0)], source);
  expression.customProperties[0].get = () => .375; effects.push(expression);
  const native = effects.map((fx, i) => capture(fx, cases[i]?.[3] || 0));
  const dispose = install(PZ, THREE);
  try { effects.forEach((fx, i) => assert.deepEqual(capture(fx, cases[i]?.[3] || 0), native[i])); } finally { dispose(); }
});
test("all 200 AlipFX effects retain byte-identical fragments, defines and uniforms", { skip: !fs.existsSync(core) }, () => {
  const { PZ, THREE } = host();
  const manifest = require("../plugins/alipfx/manifest.json"); assert.equal(manifest.effects.length, 200);
  const effects = manifest.effects.map(spec => {
    const preset = JSON.parse(fs.readFileSync(path.join(root, spec.preset.split("?")[0].replace(/^\.\//, "")), "utf8"));
    const source = fs.readFileSync(path.join(root, spec.shader.split("?")[0].replace(/^\.\//, "")), "utf8");
    return effect(PZ, preset.customProperties, source);
  });
  const native = effects.map(fx => capture(fx)); const dispose = install(PZ, THREE);
  try { effects.forEach((fx, i) => assert.deepEqual(capture(fx), native[i], manifest.effects[i].id)); } finally { dispose(); }
});
test("dropdown constants only bind tokens in include-expanded source", { skip: !fs.existsSync(core) }, () => {
  const { PZ, THREE } = host(); const dispose = install(PZ, THREE);
  const pipeline = forHost(PZ); const unregister = pipeline.registerIncludes({ mode: "float modeValue(){return float(Value_Option_2);}" });
  try {
    const record = { type: KINDS.dropdown.create(), properties: { name: "Value" }, keyframes: [{ frame: 0, value: .75, tween: 1 }] };
    const fx = effect(PZ, [record], "// Value_Option_1\n// #include <zoidium/mode>\nvoid main(){gl_FragColor=vec4(modeValue());}");
    assert.deepEqual(capture(fx).defines, { Value_Option_2: 1 });
  } finally { unregister(); dispose(); }
});
module.exports = { effect, capture, install };
test("vanilla CM3 binds texture JSON as a define without throwing during native setup", { skip: !fs.existsSync(core) }, () => {
  const { PZ } = host();
  for (const kind of ["gradient", "curve", "palette", "text"]) {
    const definition = KINDS[kind].create();
    const fx = effect(PZ, [{ type: definition, properties: { name: "Input" }, value: definition.value }], "uniform sampler2D Input; void main(){gl_FragColor=texture2D(Input,vec2(0.5));}");
    assert.doesNotThrow(() => fx.updateFragmentShader());
    assert.equal(typeof fx.pass.material.defines.Input, "string");
    assert.match(fx.pass.material.defines.Input, /^\{/);
  }
});
test("static dropdown zero serializes to a vanilla-loadable native OPTION", { skip: !fs.existsSync(core) }, () => {
  const { PZ, THREE } = host(); const dispose = install(PZ, THREE);
  let data;
  try { const p = PZ.property.create(KINDS.staticDropdown.create()); p.load(); data = JSON.parse(JSON.stringify(p)); assert.equal(data.value, "0"); }
  finally { dispose(); }
  const p = PZ.property.create(data.type); p.load(data); assert.equal(Number(p.get()), 0); assert.equal(p.definition.type, 6);
});
test("font preparation awaits rasterization, leaves the previous project untouched, and releases assets", { skip: !fs.existsSync(core) }, async () => {
  const { PZ, THREE } = host(); let resolveFont, references = 0, notifications = 0;
  const fontReady = new Promise(resolve => { resolveFont = resolve; });
  PZ.asset.font = class { getFont() { return fontReady; } };
  const project = { assets: { load() { references++; return { key: "font" }; }, unload() { references--; } } };
  const previous = { ui: { onChanged: { update() { throw Error("The previous project was dirtied"); } } } };
  const doc = { dispatchEvent() { notifications++; }, createElement() { return { getContext() { return { getImageData(x, y, w, h) { return { data: new Uint8Array(w * h * 4) }; } }; } }; } };
  const definition = KINDS.text.create("font"), fx = effect(PZ, [{ type: definition, properties: { name: "Title" }, value: definition.value }], "void main(){gl_FragColor=vec4(1.0);}");
  Object.defineProperty(fx, "parentProject", { value: project });
  const dispose = install(PZ, THREE, { doc, editor: () => ({ project: previous }), presetFont: () => "font" });
  try {
    let done = false; const preparing = fx.prepare().then(() => { done = true; }); await Promise.resolve();
    assert.equal(done, false); assert.equal(references, 1);
    resolveFont({ unitsPerEm: 1000, ascender: 800, descender: -200, stringToGlyphs: s => [...s].map(() => ({ advanceWidth: 600, getPath: () => ({ draw() {} }) })), getKerningValue: () => 0 });
    await preparing;
    const entry = dispose.runtime.entry(fx.customProperties[0]); assert.ok(entry.size.x > 1); assert.equal(notifications, 0);
    let disposed = false; entry.texture.addEventListener("dispose", () => { disposed = true; });
    dispose.runtime.disposeAll(); assert.equal(references, 0); assert.equal(disposed, true);
  } finally { dispose(); }
});
test("font failures reject export preparation instead of exporting an empty texture", { skip: !fs.existsSync(core) }, async () => {
  const { PZ, THREE } = host(); let message, references = 0;
  PZ.asset.font = class { getFont() { return Promise.reject(new Error("Invalid font data")); } };
  const project = { assets: { load() { references++; return {}; }, unload() { references--; } } };
  const definition = KINDS.text.create("font");
  const fx = effect(PZ, [{ type: definition, properties: { name: "Title" }, value: definition.value }], "void main(){gl_FragColor=vec4(1.0);}");
  Object.defineProperty(fx, "parentProject", { value: project });
  fx.onShaderError.update = text => { message = text; };
  const dispose = install(PZ, THREE);
  try {
    await assert.rejects(fx.prepare(), /Shader\+ text preparation failed: Invalid font data/);
    assert.equal(message, "Shader+: Invalid font data");
  } finally { dispose(); }
  assert.equal(references, 0);
});
