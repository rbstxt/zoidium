"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { host } = require("./helpers/editor-identity-host.cjs");

const root = path.resolve(__dirname, "..");

// The key is the serialized project content, so every authored edit must change
// it. These cases use the staged CM3 model classes instead of stand-ins: a plain
// field such as a track's enabled flag, a keyframe list mutation or a property
// value is only visible if the real serializer sees it. The key itself is
// memoized per edit epoch, so a case that edits the model also fires the signal
// the editor would fire (input event or history operation).
function fixture() {
  const c = host(), { PZ } = c;
  const clock = { now: 100000 };
  c.performance = { now: () => clock.now };
  vm.runInContext(fs.readFileSync(path.join(root, "plugins/core/edit-signals.js"), "utf8"), c);
  vm.runInContext(fs.readFileSync(path.join(root, "plugins/core/temporal-math.js"), "utf8"), c);
  vm.runInContext(fs.readFileSync(path.join(root, "plugins/core/temporal-layers.js"), "utf8"), c);
  const signals = c.ZoidiumEditSignals;
  const project = new PZ.project();
  project.sequence.properties.load();
  const track = new PZ.track.video();
  project.sequence.videoTracks.push(track);
  const clip = new PZ.clip.video(6);
  clip.start = 0;
  clip.length = 100;
  track.clips.push(clip);
  const layer = clip.object;
  layer.properties.load();
  const effect = new PZ.effect();
  effect.type = "echo";
  layer.effects.push(effect);
  const compositor = { readBuffer: { width: 80, height: 40 } };
  const stage = { effect, trackIndex: 0, effectIndex: 0 };
  let serializations = 0;
  const sequenceToJSON = project.sequence.toJSON;
  project.sequence.toJSON = function (frame) {
    serializations += 1;
    return sequenceToJSON.apply(this, arguments);
  };
  const { frameSamplerInputKey, frameSamplerInputToken, frameSamplerInputIsCurrent } =
    c.__zoidiumTemporalParts.layers;
  return {
    c, PZ, project, track, clip, layer, effect, compositor, stage, clock, signals,
    get serializations() { return serializations; },
    signal() { signals.signal("test"); },
    key() { return frameSamplerInputKey(project.sequence, compositor, stage, null); },
    token() { return frameSamplerInputToken(project.sequence, compositor, stage, null, false); },
    current(token, revision) {
      return frameSamplerInputIsCurrent(revision, token, project.sequence, compositor, stage, null, false);
    },
    layerKey() {
      return frameSamplerInputKey(project.sequence, compositor,
        Object.assign({}, stage, { layer, clip }), null);
    },
  };
}

function changes(h, mutate) {
  const before = h.key();
  mutate(h);
  h.signal();
  const after = h.key();
  assert.notEqual(after, before);
  assert.equal(h.key(), after, "the new key is stable");
}

test("an unchanged project keeps one input key", () => {
  const h = fixture();
  const first = h.key();
  assert.equal(h.key(), first);
});

test("a track enabled toggle changes the input key", () => {
  const h = fixture();
  changes(h, x => { x.track.enabled = false; });
  changes(h, x => { x.track.enabled = true; });
});

test("clip timing changes change the input key", () => {
  const h = fixture();
  changes(h, x => { x.clip.start = 3; });
  changes(h, x => { x.clip.length = 90; });
});

test("a plain layer field changes the input key", () => {
  const h = fixture();
  changes(h, x => { x.layer.type = 3; });
});

test("a property set changes the input key", () => {
  const h = fixture();
  changes(h, x => { x.layer.properties.opacity.set(0.4); });
});

test("a vector property child changes the input key", () => {
  const h = fixture();
  changes(h, x => { x.layer.properties.position.x?.set?.(4) ?? x.layer.properties.position.set([4, 0]); });
});

test("a keyframe added through the property API changes the input key", () => {
  const h = fixture();
  changes(h, x => {
    x.layer.properties.opacity.addKeyframe(new h.PZ.keyframe(0.2, 10));
    assert.ok(x.layer.properties.opacity.hasKeyframe(10));
  });
});

test("a keyframe pushed directly into the list changes the input key", () => {
  const h = fixture();
  changes(h, x => { x.layer.properties.opacity.keyframes.push(new h.PZ.keyframe(0.3, 20)); });
});

test("a keyframe value edited in place changes the input key", () => {
  const h = fixture();
  changes(h, x => {
    const property = h.layer.properties.opacity;
    property.addKeyframe(new h.PZ.keyframe(0.2, 10));
    property.keyframes[property.keyframes.length - 1].value = 0.9;
  });
});

test("shifted and deleted keyframes change the input key", () => {
  const h = fixture();
  changes(h, x => {
    const property = x.layer.properties.opacity;
    property.addKeyframe(new h.PZ.keyframe(0.2, 10));
    property.shiftKeyframes(3);
  });
  changes(h, x => { x.layer.properties.opacity.deleteKeyframe(13); });
});

test("structural list edits change the input key", () => {
  const h = fixture();
  changes(h, x => {
    const extra = new h.PZ.effect();
    extra.type = "negative";
    x.layer.effects.push(extra);
  });
  changes(h, x => { x.layer.effects.splice(0, x.layer.effects.length); });
  changes(h, x => { x.project.sequence.videoTracks.push(new h.PZ.track.video()); });
});

test("the scoped key tracks an edit to its own layer", () => {
  const h = fixture();
  const before = h.layerKey();
  h.layer.properties.position.set([5, 6]);
  h.signal();
  assert.notEqual(h.layerKey(), before);
});

test("the memo reuses one serialization while the epoch is unchanged and quiet", () => {
  const h = fixture();
  h.clock.now += 5000;
  h.key();
  const serialized = h.serializations;
  h.key();
  h.key();
  assert.equal(h.serializations, serialized, "quiet reads never serialize again");
});

test("a signal makes every hot read serialize again", () => {
  const h = fixture();
  h.clock.now += 5000;
  h.key();
  h.signals.signal("history.pushCommand");
  const before = h.serializations;
  h.key();
  assert.equal(h.serializations, before + 1, "a hot read serializes");
  h.key();
  assert.equal(h.serializations, before + 2, "while edits are hot every read serializes");
  h.clock.now += 5000;
  const cool = h.serializations;
  h.key();
  h.key();
  assert.equal(h.serializations, cool + 1, "the memo reuses one serialization after the window");
});

test("a write with no signal keeps the cached key until touch() reports it", () => {
  const h = fixture();
  h.clock.now += 5000;
  const first = h.key();
  const serialized = h.serializations;
  h.layer.properties.opacity.set(0.42);
  assert.equal(h.key(), first, "no signal and no hot window: the memo keeps the cached key");
  assert.equal(h.serializations, serialized, "the quiet memo did not serialize again");
  h.signals.touch("programmatic-write");
  assert.notEqual(h.key(), first, "touch() reports a write made without an edit signal");
});

test("edits inside the hot window are seen without a second signal", () => {
  const h = fixture();
  h.clock.now += 5000;
  const first = h.key();
  h.signals.signal("pointerdown");
  h.layer.properties.opacity.set(0.25);
  assert.notEqual(h.key(), first, "the hot window recomputes for asynchronous follow-up writes");
});

test("the debug assert accepts a stable project", () => {
  const h = fixture();
  h.PZ.zoidium = Object.assign(h.PZ.zoidium || {}, { debugAssertTemporalKeyMemo: true });
  h.key();
  h.layer.properties.opacity.set(0.6);
  h.signal();
  h.key();
});

test("the debug assert reports a serializer that reads outside the project content", () => {
  const h = fixture();
  h.PZ.zoidium = Object.assign(h.PZ.zoidium || {}, { debugAssertTemporalKeyMemo: true });
  let reads = 0;
  const toJSON = h.project.sequence.toJSON;
  h.project.sequence.toJSON = function (frame) {
    const data = toJSON.apply(this, arguments);
    data.readCount = ++reads;
    return data;
  };
  assert.throws(() => h.key(), /not deterministic/);
  assert.equal(h.PZ.zoidium.debug.temporalKeyAssert.checks, 1);
  assert.equal(h.PZ.zoidium.debug.temporalKeyAssert.misses, 1);
});

test("the post-await check re-serializes when a resize lands during the await", () => {
  const h = fixture();
  h.clock.now += 5000;
  const revision = h.key();
  const token = h.token();
  const serialized = h.serializations;
  // A viewport resize updates the read buffer without an edit signal.
  h.compositor.readBuffer.width = 160;
  assert.equal(h.current(token, revision), false);
  assert.equal(h.serializations, serialized + 1, "the changed stamp forces a comparison");
});

test("the post-await check re-serializes for a follow-up write inside the hot window", () => {
  const h = fixture();
  h.clock.now += 5000;
  h.signal(); // the edit that started this tap preparation
  const revision = h.key();
  const token = h.token();
  const serialized = h.serializations;
  // Asynchronous follow-up work from the same edit, without a second signal.
  h.layer.properties.opacity.set(0.9);
  assert.equal(h.current(token, revision), false);
  assert.equal(h.serializations, serialized + 1);
});

test("the post-await check trusts an unchanged stamp and a moved epoch with unchanged content", () => {
  const h = fixture();
  h.clock.now += 5000;
  const revision = h.key();
  const token = h.token();
  const serialized = h.serializations;
  assert.equal(h.current(token, revision), true);
  assert.equal(h.serializations, serialized, "an unchanged stamp does not serialize");
  h.signals.signal("history.pushCommand");
  h.clock.now += 5000; // outside the hot window again; only the epoch moved
  assert.equal(h.current(token, revision), true, "unchanged content still matches");
  assert.equal(h.serializations > serialized, true, "a moved epoch compares values");
});
