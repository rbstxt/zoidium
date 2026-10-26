"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { host, deferred } = require("./helpers/editor-identity-host.cjs");

const root = path.resolve(__dirname, "..");
const files = [
  "native-fx/effects/echo.js",
  "native-fx/effects/ccwidetime.js",
  "native-fx/effects/timedifference.js",
  "native-fx/effects/timedisplacement.js",
  "native-fx/effects/smartmotionblur.js",
  "openzoid-legacy/effects/vhs.js",
  "openzoid-legacy/effects/echo-legacy.js",
  "openzoid-legacy/effects/datamosh.js",
];

async function fixture(file) {
  const c = host(), { PZ } = c;
  const project = new PZ.project();
  project.sequence.properties.load();
  const track = new PZ.track.video();
  project.sequence.videoTracks.push(track);
  const clip = new PZ.clip.video(4);
  clip.start = 0;
  clip.length = 100;
  track.clips.push(clip);
  const layer = clip.object, effect = new PZ.effect(), calls = [];
  effect.type = "probe";
  layer.effects.push(effect);
  effect._zoidiumGetAsset = (_kind, file) =>
    fs.readFileSync(path.join(root, file.replace(/^\.?\//, "")), "utf8");
  PZ.zoidium = { temporal: { async prepareFrameSamples(...args) { calls.push(args); } } };
  c.instance = effect;
  vm.runInContext("(function () {" + fs.readFileSync(path.join(root, "plugins", file), "utf8") +
    "\n}).call(instance)", c, { filename: file });
  // Keep native effect allocation and cleanup; substitute the vertex asset read.
  project.assets.createFromPreset = () => ({});
  project.assets.load = value => value;
  project.assets.unload = () => {};
  PZ.asset.shader = function (asset) {
    this.asset = asset;
    this.getShader = async () => "void main(){gl_Position=vec4(0.0);}";
  };
  layer.properties.load();
  await effect.load({});
  return { PZ, project, track, clip, layer, effect, calls };
}

for (const file of files) {
  test(file + " skips preparation after deletion during an earlier effect load", async () => {
    const f = await fixture(file), { effect, project, calls } = f;
    await effect.prepare(12);
    assert.equal(calls.length, 1);
    assert.equal(calls[0][2].sequence, project.sequence);
    const partial = { export: true };
    await effect.prepare(13, partial);
    assert.equal(calls[1][2].sequence, project.sequence);
    assert.equal(calls[1][2].export, true);
    assert.equal(partial.sequence, undefined);
    const explicit = { sequence: project.sequence, export: true };
    await effect.prepare(14, explicit);
    assert.equal(calls[2][2], explicit);

    const pending = deferred(), entered = deferred(), blocker = new f.PZ.effect();
    Object.defineProperty(blocker, "loading", { get() { entered.resolve(); return pending.promise; } });
    blocker.prepare = async () => {};
    f.layer.effects.unshift(blocker);
    const preparing = f.layer.prepare(12);
    await entered.promise;
    f.clip.unload();
    f.track.clips.splice(0, 1);
    assert.equal(f.clip.parent, null);
    pending.resolve();
    await preparing;
    await effect.prepare(12, explicit);
    assert.equal(calls.length, 3, "deleted effects do no temporal work, with or without context");
  });

  test(file + " skips unloaded and detached effects but preserves attached failures", async () => {
    const f = await fixture(file), { effect, project, calls, PZ } = f;
    const failure = new Error("Attached temporal preparation failed");
    PZ.zoidium.temporal.prepareFrameSamples = async () => { throw failure; };
    await assert.rejects(effect.prepare(12), error => error === failure);
    await assert.rejects(effect.prepare(12, { sequence: project.sequence }), error => error === failure);
    PZ.zoidium.temporal.prepareFrameSamples = async (...args) => calls.push(args);
    effect.unload();
    assert.equal(effect.parentProject, project, "unloaded effect still has native ancestry");
    await effect.prepare(12);
    await effect.prepare(12, { sequence: project.sequence });
    assert.equal(calls.length, 0);
    await effect.load({});
    await effect.prepare(12);
    assert.equal(calls.length, 1, "reload restores attached preparation");
    // Detachment alone must be sufficient, even without an unload call.
    f.layer.effects.splice(0, 1);
    assert.equal(effect.parent, null);
    await effect.prepare(12);
    await effect.prepare(12, { sequence: project.sequence });
    assert.equal(calls.length, 1);
  });
}
