"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const { retainedFixture } = require("./asset-retention-fixture.js");

// A keyframed asset property and property operations reduced from CM3:
// get/set address the closest keyframe, frameOffset is the clip start, and
// startEdit keys an animated property at the edit frame.
function keyframedFixture() {
  const f = retainedFixture();
  class Keyframed extends f.Property {
    constructor(name, keyframes, clip) {
      super(name, null, 8, f.PZ.asset.type.IMAGE);
      this.keyframes = keyframes.map(([frame, value]) => ({ frame, value, tween: 0 }));
      this.animated = keyframes.length > 1;
      this.clip = clip;
      this.expression = null;
    }
    get frameOffset() { return this.clip.start; }
    closest(frame) {
      let best = 0;
      this.keyframes.forEach((kf, index) => { if (Math.abs(kf.frame - frame) < Math.abs(this.keyframes[best].frame - frame)) best = index; });
      return best;
    }
    get(frame) {
      if (frame === undefined) throw new Error("A keyframed property needs a frame.");
      let value = this.keyframes[0].value;
      for (const kf of this.keyframes) if (kf.frame <= frame) value = kf.value;
      return value;
    }
    set(value, frame) {
      if (frame === undefined) throw new Error("A keyframed property needs a frame.");
      this.keyframes[this.closest(frame)].value = value;
      this.onChanged.update();
    }
    hasKeyframe(frame) { return this.keyframes.some(kf => kf.frame === frame); }
  }
  f.PZ.ui.properties = class {
    constructor(editor) { this.editor = editor; }
    startEdit(property, frame) {
      if (!property.animated || property.hasKeyframe(frame)) return;
      this.createKeyframe({ property: property.getAddress(), data: { frame, value: property.get(frame), tween: 0 } });
    }
    createKeyframe({ property, data }) {
      const prop = this.editor.project.addressLookup(property);
      prop.keyframes.push(data); prop.keyframes.sort((a, b) => a.frame - b.frame);
      this.editor.history.pushCommand(() => this.deleteKeyframe({ property, frame: data.frame }));
    }
    deleteKeyframe({ property, frame }) {
      const prop = this.editor.project.addressLookup(property), kf = prop.keyframes.find(k => k.frame === frame);
      prop.keyframes.splice(prop.keyframes.indexOf(kf), 1);
      this.editor.history.pushCommand(() => this.createKeyframe({ property, data: kf }));
    }
    setValue({ property, value, frame, oldValue }) {
      const prop = this.editor.project.addressLookup(property);
      const old = oldValue === undefined ? prop.get(frame) : oldValue;
      if (value !== undefined) prop.set(value, frame);
      this.editor.history.pushCommand(() => this.setValue({ property, frame, value: old }));
    }
  };
  f.editor.playback = { currentFrame: 0 };
  const clip = f.child(f.project.sequence, new f.Clip("Clip"));
  clip.start = 30;
  return { ...f, Keyframed, clip };
}

const frames = property => property.keyframes.map(kf => [kf.frame, kf.value]);

test("dropping on an animated property keys it at the playhead in clip-local frames", async () => {
  const f = keyframedFixture();
  await f.add("logo.png", "image/png");
  await f.add("old.png", "image/png");
  const image = new f.Keyframed("Image", [[0, "old.png"], [60, null]], f.clip);
  f.properties(f.child(f.clip, new f.Obj("Layer")), { image });
  f.editor.playback.currentFrame = 50; // clip starts at 30: local frame 20
  const result = f.api.assign("logo.png", image.getAddress());
  assert.deepEqual({ ...result }, { ok: true, frame: 20 });
  assert.deepEqual(frames(image), [[0, "old.png"], [20, "logo.png"], [60, null]]);
  assert.equal(f.editor.history.undoStack.length, 1, "one undo step");
  f.editor.history.undo();
  assert.deepEqual(frames(image), [[0, "old.png"], [60, null]]);
  f.editor.history.redo();
  assert.deepEqual(frames(image), [[0, "old.png"], [20, "logo.png"], [60, null]]);
});

test("an existing keyframe at the playhead changes value without a new keyframe", async () => {
  const f = keyframedFixture();
  await f.add("logo.png", "image/png");
  const image = new f.Keyframed("Image", [[0, null], [20, null]], f.clip);
  f.properties(f.child(f.clip, new f.Obj("Layer")), { image });
  f.editor.playback.currentFrame = 50;
  assert.equal(f.api.assign("logo.png", image.getAddress()).ok, true);
  assert.deepEqual(frames(image), [[0, null], [20, "logo.png"]]);
  f.editor.history.undo();
  assert.deepEqual(frames(image), [[0, null], [20, null]]);
});

test("a non-animated keyframed property is set at the edit frame like the native panel", async () => {
  const f = keyframedFixture();
  await f.add("logo.png", "image/png");
  const image = new f.Keyframed("Image", [[0, null]], f.clip);
  f.properties(f.child(f.clip, new f.Obj("Layer")), { image });
  f.editor.playback.currentFrame = 75;
  assert.equal(f.api.assign("logo.png", image.getAddress()).ok, true);
  assert.deepEqual(frames(image), [[0, "logo.png"]]);
  f.editor.history.undo();
  assert.deepEqual(frames(image), [[0, null]]);
});

test("an explicit frame wins over the playhead", async () => {
  const f = keyframedFixture();
  await f.add("logo.png", "image/png");
  const image = new f.Keyframed("Image", [[0, null], [60, null]], f.clip);
  f.properties(f.child(f.clip, new f.Obj("Layer")), { image });
  f.editor.playback.currentFrame = 50;
  assert.equal(f.api.assign("logo.png", image.getAddress(), 45).frame, 45);
  assert.deepEqual(frames(image), [[0, null], [45, "logo.png"], [60, null]]);
});
