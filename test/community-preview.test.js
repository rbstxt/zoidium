"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { install } = require("../zoidium/community-preview");
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture() {
  let revision = 0, prepares = 0, nativePreparations = 0, draws = 0, resume;
  const permissions = [];
  const sequence = { videoTracks: [] }, project = { sequence }, layer = {};
  const effect = { parentProject: project, parentLayer: layer, _community: { receipt: null },
    async prepare(frame) {
      prepares++; await new Promise(resolve => { resume = resolve; });
      this._community.receipt = { authority: { frame, revision } };
    } };
  const clip = { start: 2.25, object: layer, prepare() { nativePreparations++; throw new Error("native preparation forbidden"); } };
  sequence.videoTracks.push({ getCurrentClip: () => clip });
  const viewport = { editor: { project, playback: { currentFrame: 10.5 } }, compositor: { _sequence: sequence },
    renderMode: false, __zoidiumPlayerPlusPaused: true, __zoidiumPlayerPlusRenderOnce: true,
    _render() {
      if (this.__zoidiumPlayerPlusPaused && !this.__zoidiumPlayerPlusRenderOnce) return;
      draws++; permissions.push(this.__zoidiumPlayerPlusRenderOnce); return 7;
    } };
  const stamp = (_effect, frame) => ({ frame, revision });
  const reports = [];
  const remove = install({ getEffects: () => [effect], stamp,
    sameStamp: (a, b) => a.frame === b.frame && a.revision === b.revision,
    viewport, PZ: {}, report: message => reports.push(message) });
  return { effect, viewport, remove, reports, permissions, project,
    advanceRevision: () => { revision++; }, resume: () => resume(),
    counts: () => ({ prepares, draws, nativePreparations }) };
}
test("Render once awaits an exact-frame guest receipt and retains its one draw permission", async () => {
  const h = fixture();
  h.viewport._render(); h.viewport.__zoidiumPlayerPlusRenderOnce = false;
  h.viewport._render();
  assert.deepEqual(h.counts(), { prepares: 1, draws: 0, nativePreparations: 0 });
  h.resume(); await tick();
  assert.deepEqual(h.effect._community.receipt.authority, { frame: 8.25, revision: 0 });
  assert.deepEqual(h.counts(), { prepares: 1, draws: 1, nativePreparations: 0 });
  assert.deepEqual(h.permissions, [true]); assert.equal(h.viewport.__zoidiumPlayerPlusRenderOnce, false);
  h.viewport.__zoidiumPlayerPlusRenderOnce = true;
  assert.equal(h.viewport._render(), 7);
  assert.equal(h.counts().prepares, 1); h.remove(); h.remove();
});
test("paused scheduled draws do not start any community or native preparation", () => {
  const h = fixture(); h.viewport.__zoidiumPlayerPlusRenderOnce = false;
  h.viewport._render(); assert.deepEqual(h.counts(), { prepares: 0, draws: 0, nativePreparations: 0 }); h.remove();
});
test("seek, project replacement, and cleanup cancel a pending preview draw", async () => {
  for (const change of [h => { h.viewport.editor.playback.currentFrame++; },
    h => { h.viewport.editor.project = {}; }, h => { h.remove(); }]) {
    const h = fixture(); h.viewport._render(); change(h); h.resume(); await tick();
    assert.equal(h.counts().draws, 0); assert.equal(h.counts().nativePreparations, 0); h.remove();
  }
});
test("a project revision change prepares again while a first-party frame forwards synchronously", async () => {
  const h = fixture(); h.viewport._render(); h.resume(); await tick(); h.advanceRevision();
  h.viewport._render(); assert.equal(h.counts().prepares, 2); h.resume(); await tick();
  assert.equal(h.counts().draws, 2); h.remove();
  let calls = 0;
  const viewport = { _render(value) { calls++; assert.equal(this, viewport); return value; } };
  const remove = install({ getEffects: () => [], stamp() { throw new Error("no community stamp expected"); },
    sameStamp: () => false, viewport, PZ: {} });
  assert.equal(viewport._render(19), 19); assert.equal(calls, 1); remove();
});
test("guest failures draw identity and repeated failures produce one named report", async () => {
  const h = fixture(); h.effect.prepare = async () => { throw new Error("guest stopped"); };
  h.viewport._render(); await tick(); h.viewport._render(); await tick();
  assert.equal(h.counts().draws, 2); assert.equal(h.reports.length, 1);
  assert.match(h.reports[0], /Community preview preparation failed: guest stopped/); h.remove();
});
