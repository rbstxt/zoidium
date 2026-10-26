"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const P = require("../zoidium/community-package");
const V = require("../zoidium/community-protocol");
const I = require("../zoidium/community-interpreter");
const U = require("../zoidium/community-ui");
const H = require("../zoidium/community-effect-host");
const E = require("../zoidium/community-effects");
const { createStore, hashBytes } = require("../zoidium/community-plugin-store");
const manifest = require("../examples/community-filter/manifest.json");
const declaration = manifest.effects[0];
const source = fs.readFileSync(require.resolve("../examples/community-filter/guest.js"), "utf8");
const bytes = new TextEncoder().encode(JSON.stringify({ schemaVersion: 1, manifest, assets: { "guest.js": source } }));
const hash = "sha256-" + "A".repeat(43) + "=";
function observable() {
  const listeners = new Set();
  return { watch: fn => listeners.add(fn), unwatch: fn => listeners.delete(fn), update: () => { for (const fn of listeners) fn(); } };
}
function host() {
  const addresses = new Map();
  let nextAddress = 0, draws = 0;
  class Properties {
    constructor() { this.add("name", { value: "Effect" }); }
    add(key, definition) {
      const address = "p-" + (++nextAddress), changed = observable();
      const p = { definition, value: definition.value, onChanged: changed,
        get() { return this.value; }, set(value) { this.value = value; changed.update(); },
        getAddress: () => address };
      this[key] = p; addresses.set(address, p);
    }
    addAll(definitions) { for (const [key, def] of Object.entries(definitions)) this.add(key, def); }
  }
  class Exporter { renderVideoFrame() { draws++; return 1; } getVideoFrame() { draws++; return 1; } }
  class Effect { constructor() { this.properties = new Properties(); } }
  Effect.create = type => Object.assign(new Effect(), { type }); Effect.fnList = {};
  const entries = [];
  const PZ = { effect: Effect, export: Exporter, property: { type: { NUMBER: 0, TEXT: 7 } }, ui: {
    objectTypes: { get: () => entries }, properties: class {
      constructor(editor) { this.editor = editor; }
      setValue({ property, value, oldValue }) {
        const p = addresses.get(property), previous = oldValue ?? p.get();
        p.set(value); this.editor.history.operation.push({ p, previous, value });
      }
    },
  } };
  const project = { ui: { onChanged: observable() }, other: 0,
    sequence: { properties: { resolution: { get: () => [64, 64] }, rate: { get: () => 30 } } }, effects: [],
    toJSON() { return { other: this.other, effects: this.effects.map(effect => effect.toJSON()) }; } };
  const editor = { project, playback: { currentFrame: 0 }, history: {
    operation: null, past: [], future: [], startOperation() { this.operation = []; },
    finishOperation() { if (this.operation.length) this.past.push(this.operation); this.operation = null; project.ui.onChanged.update(); },
    discardOperation() { for (const c of this.operation.toReversed()) c.p.set(c.previous); this.operation = null; },
    undo() { const commands = this.past.pop(); for (const c of commands.toReversed()) c.p.set(c.previous); this.future.push(commands); project.ui.onChanged.update(); },
    redo() { const commands = this.future.pop(); for (const c of commands) c.p.set(c.value); this.past.push(commands); project.ui.onChanged.update(); },
  } };
  return { PZ, entries, project, editor, draws: () => draws };
}
function kit() {
  const controls = [], labels = [];
  function control(kind, config) {
    const c = { kind, config, value: config.value, disabled: false, element: {},
      set(value) { this.value = value; }, setDisabled(value) { this.disabled = value; } };
    controls.push(c); labels.push(config.label || config.title); return c;
  }
  const ui = { controls: {}, openWindow(config) { this.window = Object.assign({ close() {} }, config); return this.window; } };
  for (const kind of ["number", "checkbox", "color", "select", "button"]) ui.controls[kind] = config => control(kind, config);
  ui.controls.note = text => { labels.push(text); return { element: { textContent: text } }; };
  ui.controls.section = config => ({ element: {}, body: { appendChild() {} }, ...control("section", config) });
  return { ui, controls, labels };
}
let network = 0, preview = true;
const cleanupTasks = [];
const descriptors = new Map();
test.before(() => {
  for (const [key, value] of [["localStorage", { getItem: () => preview ? "1" : null }], ["fetch", () => { network++; throw new Error("network forbidden"); }],
    ["XMLHttpRequest", function () { network++; throw new Error("network forbidden"); }], ["WebSocket", function () { network++; throw new Error("network forbidden"); }]]) {
    descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
});
test.beforeEach(t => { preview = true; H.instances.clear(); t.after(() => { for (const cleanup of cleanupTasks.splice(0)) cleanup(); }); });
test.after(() => {
  for (const [key, prior] of descriptors) { if (prior) Object.defineProperty(globalThis, key, prior); else delete globalThis[key]; }
  assert.equal(network, 0, "all host UI, adapter, rejection, and history paths make zero network calls");
});
async function setup(options = {}) {
  const h = host(), k = kit(); globalThis.PZ = h.PZ;
  let enabled = true, quarantined = "", requests = 0, disposals = 0;
  const store = { view: () => ({ revision: 1, packages: [{ id: manifest.id, enabled, selected: hash, quarantine: quarantined }] }),
    beforeEvaluation: async () => ({ bytes, hash }), completeActivation: async () => {},
    authorized: async () => enabled && !quarantined && preview,
    quarantine: async (_id, reason) => { quarantined = reason; },
  };
  let gate = options.gate;
  const createRunner = async () => ({ binding: { packageId: manifest.id, packageHash: hash, runnerGeneration: 1 },
    dispose() { disposals++; },
    async request(message) {
      requests++; if (gate) await gate(message);
      const result = await I.evaluate(options.source || source, message.operation, message.payload.input);
      return { ...message, operation: message.operation === "uiEvent" ? "uiPatch" : "prepared", payload: result.value };
    },
  });
  let releases = 0;
  const controller = E.createController({ store, runtimeSource: "fixed trusted runtime", PZ: h.PZ, ui: k.ui, createRunner,
    makePass: (_template, gain) => { let closed = false; return { gain, release() { if (!closed) { closed = true; releases++; } } }; } });
  await controller.activate(manifest.id);
  const effect = h.PZ.effect.create(declaration.id);
  effect.parent = {}; effect.parentProject = h.project; effect.parentLayer = { properties: h.project.sequence.properties };
  const factory = await h.PZ.effect.fnList[declaration.id]; factory.call(effect); h.project.effects.push(effect);
  await effect.load();
  cleanupTasks.push(() => { controller.dispose(); effect.unload(); });
  return { ...h, ...k, store, controller, effect, requests: () => requests, disposals: () => disposals,
    releases: () => releases, disable: () => { enabled = false; }, gate: fn => { gate = fn; } };
}
test("declaration rejection precedes every host control and asset operation", () => {
  const hostile = [
    d => { d.url = "https://sink.invalid"; }, d => { d.css = "@import url(https://sink.invalid)"; },
    d => { d.html = "<img src=https://sink.invalid>"; }, d => { d.svg = "<svg><image href='https://sink.invalid'/></svg>"; },
    d => { d.font = "https://sink.invalid/font.woff2"; }, d => { d.template = "https://sink.invalid/shader"; },
    d => { d.shader = "void main(){}"; }, d => { d.ui[0].style = "background:url(https://sink.invalid)"; },
    d => { d.ui[0].children[0].property = "foreign"; }, d => { d.ui[0].children[0].url = "https://sink.invalid"; },
    d => { d.properties[0].default = "fetch('https://sink.invalid')"; }, d => { d.properties[0].expression = "fetch('https://sink.invalid')"; },
    d => { d.properties[0].type = "font"; }, d => { d.properties[0].type = "asset"; },
    d => { d.properties[0].min = NaN; }, d => { d.properties[0].options = [{ value: "remote", label: "Remote" }]; },
    d => { d.properties.push({ key: "mode", label: "Mode", type: "option", default: "remote", options: [{ value: "remote", label: "Remote", url: "https://sink.invalid" }] }); },
  ];
  for (const change of hostile) {
    const d = structuredClone(declaration); change(d);
    let builders = 0;
    assert.throws(() => U.mount({ declaration: d, ui: { get controls() { builders++; throw new Error("must validate first"); } } }));
    assert.equal(builders, 0); assert.equal(network, 0);
  }
});
test("hostile labels stay text in the actual ZoidiumUI control builders", () => {
  const seen = [];
  function element(tag) {
    return { tag, classList: { toggle() {} }, appendChild() {}, addEventListener() {}, setAttribute() {},
      set textContent(value) { seen.push(value); }, set innerHTML(_value) { throw new Error("markup is forbidden"); } };
  }
  const root = { document: { createElement: element } };
  vm.runInNewContext(fs.readFileSync(require.resolve("../zoidium/ui-kit-controls.js"), "utf8"), { window: root });
  const label = "<svg onload=fetch('https://sink.invalid')><image href='https://sink.invalid'></svg>";
  root.ZoidiumUIBuilder.controls.note(label); root.ZoidiumUIBuilder.controls.button({ title: label });
  root.ZoidiumUIBuilder.controls.section({ title: label });
  assert.equal(seen.filter(s => s === label).length, 3); assert.equal(network, 0);
});
test("options, colors, and booleans use bounded static properties", () => {
  const d = structuredClone(declaration);
  d.properties.push({ key: "mode", label: "Mode", type: "option", default: "local", options: [{ value: "local", label: "<img src=https://sink.invalid>" }] },
    { key: "tint", label: "Tint", type: "color", default: "#aabbcc" }, { key: "checked", label: "Checked", type: "boolean", default: true });
  const m = structuredClone(manifest); m.effects = [d]; P.manifest(m);
  const Ajv = require("ajv"), ajv = new Ajv({ strict: false });
  assert.ok(ajv.validate(require("../plugins/community-manifest.schema.json"), m), JSON.stringify(ajv.errors));
  const defs = U.definitions(d, { NUMBER: 0, TEXT: 7 });
  assert.ok(Object.values(defs).every(p => p.visible === false && !p.dynamic));
  for (const bad of [{ tint: "url(https://sink.invalid)" }, { mode: "foreign" }, { checked: "true" }, { gain: { expression: "fetch('https://sink.invalid')" } }]) {
    assert.throws(() => P.state(bad, d.properties)); assert.equal(network, 0);
  }
});
test("exact frame and project revision receipts never reuse previous-frame uniforms", async () => {
  const h = await setup(); const e = h.effect;
  e.properties[U.keyFor("gain")].set(1.5);
  await e.prepare(0.5); e.update(0.5); assert.equal(e.pass.gain(), 1.5);
  e.update(1.5); assert.equal(e.pass.gain(), 1);
  await e.prepare(1.5); e.update(1.5); assert.equal(e.pass.gain(), 1.5);
  h.project.other++; assert.equal(e.pass.gain(), 1);
  await e.prepare(1.5); e.update(1.5); assert.equal(e.pass.gain(), 1.5);
  h.project.ui.onChanged.update(); assert.equal(e.pass.gain(), 1);
  h.controller.dispose(); e.unload();
});
test("pending preparation cannot cross edits, undo/redo, reload, or project replacement", async () => {
  for (const mutate of [
    h => { h.project.other++; },
    h => { h.project.ui.onChanged.update(); h.project.ui.onChanged.update(); },
    h => { h.effect.parentProject = { ...h.project }; },
    h => h.effect.load(h.effect.toJSON()),
  ]) {
    const h = await setup(); let resume, started;
    const reached = new Promise(resolve => { started = resolve; });
    h.gate(() => new Promise(resolve => { resume = resolve; started(); }));
    const work = h.effect.prepare(2.25); await reached; await mutate(h); resume(); await work;
    assert.equal(h.effect._community.receipt, null);
    h.controller.dispose(); h.effect.unload();
  }
});
test("UI events commit only validated patches and use native undo and redo", async () => {
  const h = await setup(), e = h.effect;
  e._communityOpen(h.editor);
  const cleanup = h.ui.window.mount({ appendChild() {} });
  cleanupTasks.push(cleanup);
  const changed = new Promise(resolve => e.properties[U.keyFor("gain")].onChanged.watch(resolve));
  h.controls.find(c => c.kind === "number").config.onChange(1.7);
  await changed;
  assert.equal(U.read(e, declaration).gain, 1.7); assert.equal(h.editor.history.past.length, 1);
  h.editor.history.undo(); assert.equal(U.read(e, declaration).gain, 1);
  h.editor.history.redo(); assert.equal(U.read(e, declaration).gain, 1.7);
  const saved = H.clone(e.toJSON()); await e.load(saved); assert.deepEqual(H.clone(e.toJSON()), saved);
  cleanup(); cleanup(); h.controller.dispose(); e.unload();
});
test("closed setup windows discard delayed UI patches and action floods", async () => {
  const h = await setup(); let resume, calls = 0;
  const cleanup = U.mount({ body: { appendChild() {} }, effect: h.effect, declaration, editor: h.editor, ui: h.ui, valid: () => true,
    dispatch: () => { calls++; return new Promise(resolve => { resume = resolve; }); } });
  const action = h.controls.find(c => c.kind === "button");
  for (let i = 0; i < 200; i++) action.config.onClick();
  assert.equal(calls, 1); cleanup(); cleanup(); resume({ gain: 0 });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(U.read(h.effect, declaration).gain, 1); assert.equal(h.editor.history.past.length, 0);
  h.controller.dispose(); h.effect.unload();
});
test("unvalidated property patches never enter native history", async () => {
  const h = await setup();
  for (const values of [{ foreign: 1 }, { gain: { expression: "fetch('https://sink.invalid')" } }, { gain: 3 }]) {
    assert.throws(() => U.apply(h.effect, declaration, h.editor, values, () => true));
    assert.equal(h.editor.history.past.length, 0); assert.equal(network, 0);
  }
  h.controller.dispose(); h.effect.unload();
});
test("disabled sessions dispose once, render identity, and preserve effect data", async () => {
  const h = await setup(); const saved = H.clone(h.effect.toJSON());
  h.disable(); await h.controller.reconcile();
  assert.equal(h.effect.pass, null); assert.equal(h.entries.length, 0);
  assert.deepEqual(H.clone(h.effect.toJSON()), saved);
  h.effect.unload(); h.effect.unload(); h.controller.dispose(); h.controller.dispose();
  assert.equal(h.disposals(), 1); assert.equal(h.releases(), 1); assert.equal(H.instances.size, 0);
});
test("unknown schema, hash changes, and native expression records remain opaque", async () => {
  for (const change of [
    data => { data.community.dataSchema++; }, data => { data.community.packageHash = "sha256-" + "B".repeat(43) + "="; },
    data => { data.properties[U.keyFor("gain")] = { expression: "fetch('https://sink.invalid')", value: 1 }; },
    data => { data.properties.foreign = "https://sink.invalid"; }, data => { data.unknown = { html: "<img src=https://sink.invalid>" }; },
  ]) {
    const h = await setup(), record = H.clone(h.effect.toJSON()); change(record);
    await h.effect.load(record); assert.equal(h.effect.pass, null); assert.equal(JSON.stringify(h.effect.toJSON()), JSON.stringify(record));
    await h.effect.prepare(0); assert.equal(h.requests(), 0); assert.equal(network, 0);
    h.controller.dispose(); h.effect.unload();
  }
});
test("missing packages bypass native effect fetching and export is explicitly refused", async () => {
  const h = host(); globalThis.PZ = h.PZ; H.installGuards();
  const effect = h.PZ.effect.create(declaration.id), data = { type: declaration.id, properties: { unknown: { expression: "fetch('https://sink.invalid')" } } };
  (await h.PZ.effect.fnList[declaration.id]).call(effect); await effect.load(data);
  assert.equal(JSON.stringify(effect.toJSON()), JSON.stringify(data)); assert.equal(effect.pass, null);
  const exporter = new h.PZ.export(); exporter.sequence = { parentProject: { toJSON: () => ({ closed: [{ effects: [data] }] }) } };
  assert.throws(() => exporter.renderVideoFrame(), /Community effect export is unavailable/);
  assert.throws(() => exporter.getVideoFrame(), /Community effect export is unavailable/); assert.equal(h.draws(), 0);
  effect.unload(); effect.unload();
});
test("preview flag off preserves first-party calls and serialization", async () => {
  const h = await setup(); h.controller.dispose(); h.effect.unload(); preview = false;
  let creations = 0;
  const firstParty = h.PZ.effect.create("brightness"); firstParty.toJSON = () => ({ type: "brightness", properties: { amount: 0.75 } });
  h.PZ.effect.fnList.brightness = Promise.resolve(() => { creations++; });
  const firstPartyFactory = h.PZ.effect.fnList.brightness;
  H.installGuards(); H.installGuards();
  const before = H.clone(firstParty);
  const exporter = new h.PZ.export(); exporter.sequence = { effects: [firstParty] };
  assert.equal(exporter.renderVideoFrame(), 1); assert.equal(exporter.getVideoFrame(), 1);
  assert.deepEqual(H.clone(firstParty), before);
  assert.equal(h.PZ.effect.fnList.brightness, firstPartyFactory); assert.equal(creations, 0);
  assert.equal(await h.controller.activate(manifest.id), false);
});
test("r91 render state is restored after success and a throwing shader pass", () => {
  class Vec {
    fromArray(value) { this.value = [...value]; return this; }
    copy(value) { this.value = [...value.value]; return this; }
  }
  const initial = { viewport: [3, 5, 30, 40], scissor: [7, 9, 20, 10], enabled: true, target: { name: "outer" }, autoClear: false, color: "gray", alpha: 0.25 };
  for (const throws of [false, true]) {
    const state = { ...initial }, renderer = { autoClear: state.autoClear,
      getContext: () => ({ VIEWPORT: "viewport", SCISSOR_BOX: "scissor", SCISSOR_TEST: "enabled", getParameter: key => state[key], isEnabled: key => state[key] }),
      getRenderTarget: () => state.target, setRenderTarget: target => { state.target = target; },
      getCurrentViewport: () => new Vec().fromArray(state.viewport),
      getClearColor: () => ({ clone: () => state.color }), getClearAlpha: () => state.alpha,
      setClearColor: (color, alpha) => { state.color = color; state.alpha = alpha; },
      state: { viewport: vec => { state.viewport = vec.value; }, scissor: vec => { state.scissor = vec.value; }, setScissorTest: value => { state.enabled = value; } },
    };
    const draw = () => { Object.assign(state, { viewport: [0, 0, 64, 64], scissor: [0, 0, 1, 1], enabled: false, target: null, color: "red", alpha: 1 }); renderer.autoClear = true; if (throws) throw new Error("shader failed"); return 5; };
    if (throws) assert.throws(() => H.restoreRenderer(renderer, draw, { Vector4: Vec }), /shader failed/);
    else assert.equal(H.restoreRenderer(renderer, draw, { Vector4: Vec }), 5);
    assert.deepEqual(state, initial); assert.equal(renderer.autoClear, initial.autoClear);
  }
});
test("preview selection requires exact approval and interrupted activation quarantines", async () => {
  let state = null;
  const adapter = { load: async () => structuredClone(state), commit: async (revision, next) => {
    assert.equal(state?.revision || 0, revision); state = structuredClone(next);
  } };
  const store = createStore({ adapter }); await store.open();
  await store.importFile(new Blob([bytes]), store.view().revision);
  const exact = await hashBytes(bytes);
  await assert.rejects(store.beforeEvaluation(manifest.id, exact), /Approve/);
  await store.approve(manifest.id, exact, store.view().revision);
  await store.setEnabled(manifest.id, true, store.view().revision);
  await assert.rejects(store.beforeEvaluation(manifest.id, hash), /Approve/);
  const auth = await store.beforeEvaluation(manifest.id, exact); assert.deepEqual(auth.bytes, bytes);
  const reopened = createStore({ adapter }); await reopened.open();
  assert.match(reopened.view().packages[0].quarantine, /did not finish/);
  assert.equal(await reopened.authorized(manifest.id, exact), false);
});
