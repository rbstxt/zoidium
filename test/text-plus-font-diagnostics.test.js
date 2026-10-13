"use strict";

require("./migrate-test-apis.js").ensureMainRealmApis();
const assert = require("node:assert/strict");
const test = require("node:test");
const diagnostics = require("../plugins/text-plus/text-plus-diagnostics.js");
const geometry = require("../plugins/text-plus/text-plus-geometry.js");
const { state } = require("../plugins/text-plus/text-plus-utils.js");

function text(wrapper = {}, value = "Hello") {
  return {
    properties: {
      name: { get: () => "Title" }, font: { get: () => "font-key" },
      text: { get: () => value },
    },
    font: wrapper, geometryNeedsUpdate: false, fontNeedsUpdate: false,
  };
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function warningsDuring(run) {
  const messages = [];
  const original = console.warn;
  console.warn = (message) => messages.push(message);
  diagnostics.resetTextFontDiagnostics();
  try { await run(messages); } finally { console.warn = original; }
}
const flush = () => new Promise((resolve) => setImmediate(resolve));

test("all font diagnostics identify the Text, font key, string length, and stage", () => {
  for (const stage of diagnostics.FONT_STAGES) {
    const message = diagnostics.formatTextFontMessage(stage, diagnostics.describeTextFont(text()));
    assert.match(message, /Text "Title", font "font-key"/);
    assert.match(message, /string length 5/);
    assert.match(message, /stage: /);
  }
});

test("pending normal loads stay silent, including after project assignment", async () => {
  await warningsDuring(async (messages) => {
    const pending = deferred();
    const target = text({ loading3d: pending.promise });
    const project = {};
    target.parentProject = project;
    const oldEditor = state.editor;
    state.editor = { project };
    try {
      diagnostics.observeFontRevision(target);
      diagnostics.watchFontLoad(target);
      diagnostics.reportUnavailableFont(target);
      await flush();
      assert.equal(messages.length, 0);
      target.font.font3d = { data: {} };
      pending.resolve();
      await flush();
      assert.equal(target.geometryNeedsUpdate, true);
      assert.equal(messages.length, 0);
    } finally { state.editor = oldEditor; }
  });
});

test("missing local bytes warn only after the project is assigned", async () => {
  await warningsDuring(async (messages) => {
    const oldPZ = state.PZ, oldEditor = state.editor;
    const project = {};
    const target = text({ asset: { source: 1, filename: "Missing.ttf" }, loading3d: deferred().promise });
    target.parentProject = project;
    state.PZ = { asset: { source: { FILE: 1 } } };
    state.editor = { project: null };
    try {
      diagnostics.reportUnavailableFont(target);
      assert.equal(messages.length, 0);
      state.editor.project = project;
      diagnostics.reportUnavailableFont(target);
      diagnostics.reportUnavailableFont(target);
      assert.equal(messages.length, 1);
      assert.match(messages[0], /Missing.ttf.*string length 5.*stage: font load/);
    } finally { state.PZ = oldPZ; state.editor = oldEditor; }
  });
});

test("each Text sharing a load promise rebuilds; replaced fonts and disposal ignore stale settlement", async () => {
  await warningsDuring(async (messages) => {
    const pending = deferred(), wrapper = { loading3d: pending.promise };
    const a = text(wrapper), b = text(wrapper), replaced = text(wrapper), disposed = text(wrapper);
    for (const target of [a, b, replaced]) diagnostics.watchFontLoad(target);
    replaced.font = {};
    wrapper.font3d = { data: {} };
    pending.resolve();
    await flush();
    assert.equal(a.geometryNeedsUpdate, true);
    assert.equal(b.geometryNeedsUpdate, true);
    assert.equal(replaced.geometryNeedsUpdate, false);
    const late = deferred();
    disposed.font = { loading3d: late.promise };
    diagnostics.watchFontLoad(disposed);
    diagnostics.resetTextFontDiagnostics();
    late.reject(new Error("disposed failure"));
    await flush();
    assert.equal(messages.length, 0);
  });
});

test("settled failures report load or parse stage without warning on blank strings", async () => {
  await warningsDuring(async (messages) => {
    const invalid = deferred(), missing = deferred(), blank = deferred();
    diagnostics.watchFontLoad(text({ loading3d: invalid.promise }));
    diagnostics.watchFontLoad(text({ loading3d: missing.promise }));
    diagnostics.watchFontLoad(text({ loading3d: blank.promise }, " "));
    invalid.resolve(); missing.reject(new Error("read failed")); blank.reject(new Error("read failed"));
    await flush();
    assert.equal(messages.length, 2);
    assert.match(messages[0], /stage: font parse/);
    assert.match(messages[1], /stage: font load.*read failed/);
  });
});

test("local-byte probe diagnoses swallowed native parse errors, reads each shared Blob once", async () => {
  await warningsDuring(async (messages) => {
    const previous = state.THREE;
    state.THREE = { TTFLoader: class { parse() { throw new Error("invalid TTF"); } } };
    let reads = 0;
    const file = { async arrayBuffer() { reads += 1; return new TextEncoder().encode("invalid").buffer; } };
    try {
      const wrapper = { asset: { file }, loading3d: deferred().promise };
      diagnostics.watchFontLoad(text(wrapper));
      diagnostics.watchFontLoad(text(wrapper));
      await flush();
      assert.equal(reads, 1);
      assert.equal(messages.length, 2);
      assert.ok(messages.every((message) => /stage: font parse/.test(message)));
    } finally { state.THREE = previous; }
  });
});

test("valid delayed local fonts do not warn and the probe never installs font data", async () => {
  await warningsDuring(async (messages) => {
    const previous = state.THREE;
    state.THREE = { TTFLoader: class { parse() { return { familyName: "Valid", glyphs: {} }; } } };
    const wrapper = { asset: { file: new Blob(["valid"]) }, loading3d: deferred().promise };
    try {
      diagnostics.watchFontLoad(text(wrapper));
      await flush();
      assert.equal(messages.length, 0);
      assert.equal(wrapper.font3d, undefined);
    } finally { state.THREE = previous; }
  });
});

test("late font data invalidates geometry even without a native load callback", () => {
  const target = text();
  diagnostics.observeFontRevision(target);
  target.font.font3d = { data: {} };
  diagnostics.observeFontRevision(target);
  assert.equal(target.geometryNeedsUpdate, true);
  target.geometryNeedsUpdate = false;
  diagnostics.observeFontRevision(target);
  assert.equal(target.geometryNeedsUpdate, false);
  target.font.font3d.data = {};
  diagnostics.observeFontRevision(target);
  assert.equal(target.geometryNeedsUpdate, true);
});

test("repeated empty rebuilds throttle until a successful character build", async () => {
  await warningsDuring(async (messages) => {
    const target = text({ font3d: { data: {} } });
    const empty = [{ unit: { character: "A" }, geometry: null }];
    geometry.reportCharacterBuildResult(target, empty);
    geometry.reportCharacterBuildResult(target, empty);
    assert.equal(messages.length, 1);
    assert.match(messages[0], /zero vertices.*stage: text vertices/);
    geometry.reportCharacterBuildResult(target, [{ unit: { character: "A" }, geometry: { vertices: [1] } }]);
    geometry.reportCharacterBuildResult(target, empty);
    assert.equal(messages.length, 2);
  });
});

test("vertex counting supports buffer and legacy geometry", () => {
  assert.equal(diagnostics.countGeometryVertices({ attributes: { position: { count: 0 } } }), 0);
  assert.equal(diagnostics.countGeometryVertices({ vertices: [1, 2] }), 2);
  assert.equal(diagnostics.countGeometryVertices(null), -1);
});

test("bundled diagnostics run in a browser realm without Node module globals", async () => {
  const vm = require("node:vm");
  const bundle = require("../plugins/text-plus/bundle.json");
  const source = bundle.assets.text["/plugins/text-plus/text-plus-diagnostics.js"];
  const messages = [];
  const realmState = { THREE: { TTFLoader: class { parse() { throw new Error("invalid font"); } } } };
  const sandbox = {
    module: { exports: {} }, TextDecoder,
    console: { warn: (message) => messages.push(message) },
    require(name) {
      if (name === "./text-plus-utils.js") return { state: realmState };
      if (name === "./text-plus-controls.js") return {
        propertyValue: (property, frame, fallback) => property?.get(frame) ?? fallback,
      };
      throw new Error("Unexpected bundled dependency: " + name);
    },
  };
  vm.runInNewContext(source, sandbox, { filename: "text-plus-diagnostics.js" });
  const api = sandbox.module.exports;
  const pending = deferred();
  const target = text({ asset: { file: new Blob(["invalid font bytes"]) }, loading3d: pending.promise });
  api.watchFontLoad(target);
  await flush();
  assert.equal(messages.length, 1);
  assert.match(messages[0], /Text "Title", font "font-key".*string length 5.*stage: font parse/);
  target.font.font3d = { data: {} };
  pending.resolve();
  await flush();
  assert.equal(target.geometryNeedsUpdate, true);
  assert.equal(messages.length, 1);
});
