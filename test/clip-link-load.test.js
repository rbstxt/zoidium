"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { nativeHost, cache, core } = require("./expressions-plus-harness");
const source = fs.readFileSync(require.resolve("../plugins/core/object-history.js"), "utf8");
const copy = data => JSON.parse(JSON.stringify(data));
const video = [0, 1, 0, 0, 0], audio = [0, 2, 0, 0, 0], other = [0, 1, 1, 0, 0];

function fixture(patched = true) {
  const { PZ, context } = nativeHost();
  Object.assign(context, { Image: class {}, CSS: { supports: () => true },
    window: { PZ, addEventListener() {} }, navigator: {} });
  vm.runInContext(fs.readFileSync(path.join(cache, "ui-1.0.72.js"), "utf8"), context);
  PZ.schedule.analyzeSequence = () => {};
  class Clip extends PZ.clip {
    load(data) { this.start = data.start; this.length = data.length; this.link = data.link || null; }
    toJSON() { return { start: this.start, length: this.length, link: this.link, object: { type: 0 } }; }
  }
  PZ.clip.create = () => new Clip();
  const install = () => vm.runInContext(source, context);
  if (patched) install();
  const load = data => { const project = new PZ.project(); project.load(copy(data)); return project; };
  return { PZ, install, load };
}

function data(links) {
  const clip = () => ({ start: 0, length: 60, object: { type: 0 } });
  const project = { assets: {}, media: [], sequence: { properties: { resolution: [320, 180], rate: 30 }, length: 60,
    videoTracks: [{ type: 0, clips: [clip()] }, { type: 0, clips: [clip()] }],
    audioTracks: [{ type: 1, clips: [clip()] }], clipLinks: { seed: 17, links } } };
  for (const [key, link] of Object.entries(links)) for (const address of link.clips) {
    if (address.length !== 5) continue;
    const tracks = address[1] === 1 ? project.sequence.videoTracks : project.sequence.audioTracks;
    const target = tracks[address[2]]?.clips[address[4]];
    if (target) target.link = Number(key);
  }
  return project;
}

for (const bad of [[], [0], [0, 0], [0, 1, 9, 0, 0], [0, 1, 0], [0, 1, 0, 0, 8]]) {
  test(`loading drops a detached clip link at ${JSON.stringify(bad)}`, { skip: !fs.existsSync(core) }, () => {
    const { load } = fixture(), input = data({ 3: { clips: [bad, audio] } }), before = JSON.stringify(input);
    const project = load(input), clip = project.sequence.audioTracks[0].clips[0];
    assert.equal(clip.link, null);
    assert.deepEqual(copy(project.sequence.clipLinks), { seed: 17, links: {} });
    assert.equal(project.link, undefined, "the empty address cannot link the project itself");
    assert.equal(JSON.stringify(input), before, "load does not rewrite the input data");
  });
}

test("loading preserves valid members of a damaged group and leaves other valid links unchanged", { skip: !fs.existsSync(core) }, () => {
  const { load } = fixture();
  const input = data({ 3: { clips: [[], audio, video] }, 9: { clips: [other] } });
  const project = load(input), seq = project.sequence;
  assert.deepEqual(copy(seq.clipLinks), { seed: 17, links: { 3: { clips: [audio, video] } } });
  assert.equal(seq.audioTracks[0].clips[0].link, seq.videoTracks[0].clips[0].link);
  assert.equal(seq.videoTracks[1].clips[0].link, null);
  const reloaded = load(copy(project));
  assert.equal(JSON.stringify(reloaded), JSON.stringify(project));
});

test("valid project loads and serialization match the unpatched native loader exactly", { skip: !fs.existsSync(core) }, () => {
  const f = fixture(false), input = data({ 3: { clips: [audio, video, other] } });
  const before = JSON.stringify(input), expected = JSON.stringify(f.load(input));
  f.install();
  const project = f.load(input);
  assert.equal(JSON.stringify(project), expected);
  assert.equal(JSON.stringify(input), before);
  const original = project.sequence.clipLinks.constructor;
  assert.ok(project.sequence.clipLinks instanceof f.PZ.clipLinks);
  f.install();
  assert.equal(f.PZ.clipLinks.prototype.constructor, original);
  assert.equal(JSON.stringify(f.load(input)), expected);
});

test("load repair adds no history entries", { skip: !fs.existsSync(core) }, () => {
  const { PZ, load } = fixture();
  let calls = 0;
  PZ.ui.history.prototype.pushCommand = () => { calls++; throw Error("Load cannot record history"); };
  const project = load(data({ 3: { clips: [[], audio] } }));
  assert.equal(calls, 0);
  assert.equal(Object.keys(project.sequence.clipLinks.links).length, 0);
});
