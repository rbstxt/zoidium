"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const manifest = require("../examples/community-filter/manifest.json");
const type = manifest.effects[0].id;
function host({ enabled = true, community = true } = {}) {
  const stored = new Map(), calls = [], choices = [];
  const payload = { type, properties: { gain: 2 }, community: {
    packageId: manifest.id, packageHash: "retained-hash", schemaVersion: 42, dataSchema: "future" } };
  const data = { sequence: {}, media: community ? [{ closed: { effects: [payload] } }] : [] };
  class Compositor {
    renderEffects(effects) { for (const effect of effects) calls.push(effect.type); }
    renderSequence() { this.renderEffects(this.effects); }
    unload() { calls.push("unload compositor"); }
  }
  class Exporter {}
  const PZ = { schedule: class {}, export: Exporter, compositor: Compositor };
  const sandbox = { PZ, console, AbortController, setTimeout, clearTimeout,
    localStorage: { getItem: key => key === "zoidium.community-preview" ? enabled ? "1" : null : stored.get(key),
      setItem: (key, value) => stored.set(key, value) },
    ZoidiumUI: { confirm: async choice => { choices.push(choice); return true; } },
  };
  sandbox.window = sandbox; vm.createContext(sandbox);
  for (const file of ["plugins/core/video-frame-export.js", "zoidium/community-projects.js", "zoidium/community-export.js", "zoidium/community-effect-host.js"]) {
    vm.runInContext(fs.readFileSync(file, "utf8"), sandbox, { filename: file });
  }
  sandbox.ZoidiumCommunityExport.install(PZ);
  const project = { toJSON: () => data };
  const sequence = { parentProject: project, prepare: async (_frame, context) => {
    calls.push("prepare"); assert.equal(context.exportPolicy.communityBypass, community);
  } };
  function exporter() {
    const compositor = new Compositor(); compositor.effects = [{ type: "native-first" }, { type }, { type: "native-last" }];
    return Object.assign(new Exporter(), { sequence, compositor, framesRendered: 0, totalFrames: 3, frame: 0, frameAdvance: 1,
      params: { width: 1, height: 1 }, renderer: { context: { readPixels(_x, _y, _w, _h, _format, _kind, output) {
        calls.push("pixels"); output.fill(23);
      } }, dispose() { calls.push("dispose renderer"); } } });
  }
  return { sandbox, PZ, data, payload, project, exporter, stored, choices, calls,
    api: sandbox.ZoidiumCommunityExport,
    setEnabled: value => { enabled = value; } };
}
test("default refusal happens before preparation, composition, or pixel delivery for video and image", async () => {
  for (const method of ["renderVideoFrame", "getVideoFrame"]) {
    const h = host(), exp = h.exporter(), pixels = new Uint8Array(4).fill(77);
    await assert.rejects(exp[method](pixels), /Community effect export is unavailable/);
    assert.equal(exp.framesRendered, 0); assert.deepEqual([...pixels], [77, 77, 77, 77]);
    assert.deepEqual(h.calls, ["unload compositor", "dispose renderer"]);
  }
});
test("explicit fallback bypasses every community effect at every frame and preserves closed project records", async () => {
  const h = host(), before = JSON.stringify(h.project), exp = h.exporter();
  assert.equal(await h.api.requestFallback(h.project), true);
  for (let i = 0; i < 3; i++) assert.equal(await exp.renderVideoFrame(new Uint8Array(4)), 1);
  assert.equal(h.calls.filter(call => call === "pixels").length, 3);
  assert.equal(h.calls.filter(call => call === type).length, 0);
  assert.equal(h.calls.filter(call => call === "native-first").length, 3);
  assert.equal(h.calls.filter(call => call === "native-last").length, 3);
  assert.equal(JSON.stringify(h.project), before);
  assert.match(h.choices[0].message, /every community effect at every frame/);
  assert.equal(h.choices[0].cancelLabel, "Cancel");
  assert.deepEqual(JSON.parse(h.stored.get("zoidium.community-last-fallback-export")), {
    mode: "bypass-all-community", packages: [manifest.id] });
  await assert.rejects(h.exporter().getVideoFrame(new Uint8Array(4)), /Community effect export is unavailable/);
});
test("declining the explicit choice revokes a pending choice and never prepares a frame", async () => {
  const h = host(); assert.equal(await h.api.requestFallback(h.project), true);
  assert.equal(await h.api.requestFallback(h.project, { confirm: async () => false }), false);
  await assert.rejects(h.exporter().renderVideoFrame(new Uint8Array(4)), /Community effect export is unavailable/);
  assert.ok(!h.calls.includes("prepare"));
});
test("a stale confirmation cannot authorize changed project data", async () => {
  const h = host(); let finish;
  const choice = h.api.requestFallback(h.project, { confirm: () => new Promise(resolve => { finish = resolve; }) });
  h.payload.community.dataSchema = "changed"; finish(true);
  assert.equal(await choice, false);
  await assert.rejects(h.exporter().getVideoFrame(new Uint8Array(4)), /Community effect export is unavailable/);
});
for (const change of ["edit", "remove", "replace project", "disable preview"]) {
  test(`${change} during a fallback export refuses before delivering another frame`, async () => {
    const h = host(), exp = h.exporter(); await h.api.requestFallback(h.project);
    await exp.getVideoFrame(new Uint8Array(4));
    if (change === "edit") h.payload.properties.gain++;
    if (change === "remove") h.data.media = [];
    if (change === "replace project") exp.sequence = { ...exp.sequence, parentProject: { toJSON: () => h.data } };
    if (change === "disable preview") h.setEnabled(false);
    const pixels = new Uint8Array(4).fill(55);
    await assert.rejects(exp.getVideoFrame(pixels), /COMMUNITY_EXPORT_CHANGED|Community effect export is unavailable/);
    assert.equal(exp.framesRendered, 1); assert.deepEqual([...pixels], [55, 55, 55, 55]);
    assert.equal(h.calls.filter(call => call === "pixels").length, 1);
  });
}
test("nested temporal captures inherit bypass and never invoke community passes", async () => {
  const h = host(), exp = h.exporter(); await h.api.requestFallback(h.project);
  await exp.renderVideoFrame(new Uint8Array(4));
  const capture = new h.PZ.compositor(); h.PZ.zoidium = { temporal: { contexts: [{ exportPolicy: exp.exportPolicy }] } };
  const before = h.calls.length;
  capture.renderEffects([{ type }, { type: "native-prefix" }]);
  assert.deepEqual(h.calls.slice(before), ["native-prefix"]);
});
test("first-party project pixels and calls match with preview off and on", async () => {
  const results = [];
  for (const enabled of [false, true]) {
    const h = host({ enabled, community: false }), exp = h.exporter();
    exp.compositor.effects = [{ type: "native-first" }, { type: "native-last" }];
    const pixels = new Uint8Array(4); await exp.getVideoFrame(pixels);
    assert.equal(await h.api.requestFallback(h.project), false);
    results.push({ pixels: [...pixels], calls: h.calls, choices: h.choices });
  }
  assert.deepEqual(results[0], results[1]);
});
test("saved fallback history cannot authorize a fresh export or a new project", async () => {
  const h = host(); await h.api.requestFallback(h.project);
  const replacement = { toJSON: () => h.data }, exp = h.exporter(); exp.sequence.parentProject = replacement;
  await assert.rejects(exp.getVideoFrame(new Uint8Array(4)), /Community effect export is unavailable/);
  h.setEnabled(false); assert.equal(await h.api.requestFallback(h.project), false);
});
test("without the preview, an export scans a first-party project once instead of on every frame check", async () => {
  const h = host({ enabled: false, community: false }), exp = h.exporter();
  const toJSON = h.project.toJSON; let scans = 0;
  h.project.toJSON = () => { scans++; return toJSON(); };
  for (let i = 0; i < 3; i++) assert.equal(await exp.renderVideoFrame(new Uint8Array(4)), 1);
  assert.equal(h.calls.filter(call => call === "pixels").length, 3);
  assert.equal(scans, 1);
  // A project that still holds community records is refused with the preview off.
  const held = host({ enabled: false });
  await assert.rejects(held.exporter().renderVideoFrame(new Uint8Array(4)), /Community effect export is unavailable/);
});
