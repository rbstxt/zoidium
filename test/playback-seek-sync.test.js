"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  PATCH_MARKER,
  STATE_KEY,
  install,
  markSchedulesForSeek,
} = require("../plugins/core/playback-seek-sync");

const FPS = 30;
const MEDIA_SECONDS = 10;
const CLIP_LENGTH = 300; // 10 s at 30 fps
const PADDING = 60; // PZ.schedule constructor: this.padding = 60

// ---------------------------------------------------------------------------
// Fixture of the two CM3 pieces this patch interacts with. Both mirror the
// minified bundles in the Git-ignored cache.
//
// PZ.schedule.prototype.update (core-1.0.102.js): the current item is only
// entered when `start - padding <= frame < start + length`, and the media
// element is only repositioned when that item actually changes.
// ---------------------------------------------------------------------------
class FakeSchedule {
  constructor(items, element) {
    this.el = element;
    this.type = 1; // PZ.schedule.type.AUDIO
    this.padding = PADDING;
    this.items = items;
    this.currentItem = null;
    this.index = 0;
    this.playing = false;
    this.lastFrame = 0;
  }

  update(frame) {
    const current = this.currentItem;
    if (!current || current.start + current.length <= frame || current.start - this.padding > frame) {
      let item = this.items[this.index];
      if (item.start + item.length <= frame) {
        for (let next = this.index + 1; next < this.items.length; next += 1) {
          if (frame < this.items[next].start - this.padding) break;
          this.index = next;
        }
      } else if (item.start > frame) {
        for (let previous = this.index - 1; previous >= 0; previous -= 1) {
          const candidate = this.items[previous];
          if (frame >= candidate.start + candidate.length) break;
          this.index = previous;
        }
      }
      item = this.items[this.index];
      if (item.start - this.padding <= frame && item.start + item.length > frame) {
        this.currentItem = item;
        if (this.el) {
          this.el.src = item.media.url;
          this.el.currentTime = item.clip.properties.time.get(0);
        }
      } else {
        this.currentItem = null;
      }
    }
  }
}

// PZ.ui.playback.prototype.currentFrame is an accessor that stores the exact
// frame and exposes the rounded one.
class FakePlayback {
  constructor(sequence) {
    this._sequence = sequence;
    this._exactFrame = 0;
    this._currentFrame = 0;
  }
}

Object.defineProperty(FakePlayback.prototype, "currentFrame", {
  configurable: true,
  get() {
    return this._currentFrame;
  },
  set(value) {
    this._exactFrame = value;
    this._currentFrame = Math.round(value);
  },
});

// Minimal HTMLMediaElement stand-in. Browsers clamp a seek to the media
// duration; nothing else here matters for the reposition.
class FakeElement {
  constructor(mediaSeconds) {
    this.src = null;
    this.muted = false;
    this.mediaSeconds = mediaSeconds;
    this._currentTime = 0;
    this.seeks = [];
  }

  get currentTime() {
    return this._currentTime;
  }

  set currentTime(value) {
    if (value !== this._currentTime) this.seeks.push(value);
    this._currentTime = value;
  }

  get seekWrites() {
    return this.seeks.length;
  }
}

function makeClip({ start = 0, length = CLIP_LENGTH, mediaSeconds = MEDIA_SECONDS } = {}) {
  const slope = mediaSeconds / length;
  return {
    id: `clip-${start}`,
    start,
    length,
    properties: {
      time: {
        animated: false,
        keyframes: [
          { frame: 0, value: 0 },
          { frame: length, value: length * slope },
        ],
        get(frame) {
          const clamped = Math.min(Math.max(frame, 0), length);
          return clamped * slope;
        },
      },
    },
  };
}

function makeItem(clip) {
  return { clip, start: clip.start, length: clip.length, media: { url: "blob:media" } };
}

function makeSequence(overrides = {}) {
  return Object.assign(
    {
      properties: { rate: { get: () => FPS } },
      audioSchedules: [],
      videoSchedules: [],
    },
    overrides
  );
}

function makePZ() {
  return {
    schedule: { prototype: FakeSchedule.prototype },
    ui: { playback: { prototype: FakePlayback.prototype } },
  };
}

function createSchedule(items, element) {
  const schedule = Object.create(FakeSchedule.prototype);
  schedule.el = element;
  schedule.type = 1;
  schedule.padding = PADDING;
  schedule.items = items;
  schedule.currentItem = null;
  schedule.index = 0;
  schedule.playing = false;
  schedule.lastFrame = 0;
  return schedule;
}

function currentTimeOf(clip, frame) {
  return clip.properties.time.get(frame - clip.start);
}

test("install patches playback and schedule prototypes once", () => {
  const PZ = makePZ();
  assert.equal(install(PZ), true);
  assert.equal(PZ.ui.playback.prototype[PATCH_MARKER], true);
  assert.equal(PZ.schedule.prototype[PATCH_MARKER], true);
  assert.equal(install(PZ), true, "a second install is a no-op");
});

test("install reports failure when CM3 is not ready", () => {
  assert.equal(install(null), false);
  assert.equal(install({}), false);
  assert.equal(install({ schedule: {} }), false);
});

test("a scrub inside a clip repositions the media element", () => {
  const PZ = makePZ();
  install(PZ);

  const clip = makeClip();
  const element = new FakeElement(MEDIA_SECONDS);
  const schedule = createSchedule([makeItem(clip)], element);
  const playback = new FakePlayback(makeSequence({ audioSchedules: [schedule] }));

  // The editor loads the element at the item head on the first update.
  schedule.update(0);
  assert.equal(element.currentTime, 0, "item head is loaded on first update");

  // User scrubs to frame 285 (t = 9.5 s). CM3's own schedule update must not
  // move the element: that is the bug this patch compensates for.
  playback.currentFrame = 285;
  schedule.update(285);
  assert.equal(schedule.currentItem.clip, clip, "the clip stays current");
  assert.equal(
    element.currentTime,
    currentTimeOf(clip, 285),
    "the element is repositioned to the scrubbed frame"
  );
  assert.equal(element.currentTime, 9.5);
});

test("a scrub to the first frame of a clip seeks to the item head", () => {
  const PZ = makePZ();
  install(PZ);

  const clip = makeClip({ start: 300 });
  const element = new FakeElement(MEDIA_SECONDS);
  const schedule = createSchedule([makeItem(clip)], element);
  const playback = new FakePlayback(makeSequence({ audioSchedules: [schedule] }));

  playback.currentFrame = 400;
  schedule.update(400);
  element.currentTime = 4; // stale position inside the item

  playback.currentFrame = 300;
  schedule.update(300);
  assert.equal(element.currentTime, 0, "frame 300 maps to media time 0");
});

test("a scrub into the padding window waits for the item to start", () => {
  const PZ = makePZ();
  install(PZ);

  const clip = makeClip({ start: 300 });
  const element = new FakeElement(MEDIA_SECONDS);
  const schedule = createSchedule([makeItem(clip)], element);
  const playback = new FakePlayback(makeSequence({ audioSchedules: [schedule] }));

  // The editor starts at frame 0, outside the clip. No element is active yet.
  schedule.update(0);
  assert.equal(schedule.currentItem, null, "frame 0 is before the item and its padding");

  // Frame 250 is inside the 60-frame padding window (item starts at 300), so the
  // clip is preloaded at its head rather than at the scrubbed position.
  playback.currentFrame = 250;
  schedule.update(250);
  assert.equal(schedule.currentItem.clip, clip, "padding preloads the item");
  assert.equal(element.currentTime, 0, "the element stays parked at the item head");
  assert.equal(schedule[STATE_KEY].pendingSeek, true, "the seek stays pending");

  // Playback reaches the item: the pending seek is applied to the item head.
  playback.currentFrame = 305;
  schedule.update(305);
  assert.equal(element.currentTime, currentTimeOf(clip, 305));
  assert.equal(schedule[STATE_KEY].pendingSeek, false, "the pending seek is consumed");
});

test("normal playback never writes a redundant seek", () => {
  const PZ = makePZ();
  install(PZ);

  const clip = makeClip();
  const element = new FakeElement(MEDIA_SECONDS);
  const schedule = createSchedule([makeItem(clip)], element);
  const playback = new FakePlayback(makeSequence({ audioSchedules: [schedule] }));

  // The playback clock advances per animation frame while the element advances
  // in real time. The element is always within half a frame of where it belongs,
  // so the patch must never move it: the loop assigns the expected position and
  // any write by the patch would survive the next assignment check.
  schedule.update(0);
  schedule[STATE_KEY].lastFrame = 0;
  element.currentTime = 0;
  let movedByPatch = 0;

  for (let tick = 1; tick <= 60; tick += 1) {
    // PZ.ui.playback.update clocks from el.currentTime, so the element leads.
    const exact = tick * 0.5; // 30 fps clock sampled on a 60 Hz animation frame
    const expected = exact / FPS;
    element.currentTime = expected;
    schedule.update(Math.round(exact));
    playback.currentFrame = exact;
    if (element.currentTime !== expected) movedByPatch += 1;
  }

  assert.equal(movedByPatch, 0, "no seek was written while the element kept up");
  assert.equal(element.currentTime, 1, "the element kept its own position");
  assert.ok(
    Math.abs(element.currentTime - 30 / FPS) < 1e-9,
    "the element is still aligned with the final playhead frame"
  );
});

test("a stuttered element is snapped by the next scrub", () => {
  const PZ = makePZ();
  install(PZ);

  const clip = makeClip();
  const element = new FakeElement(MEDIA_SECONDS);
  const schedule = createSchedule([makeItem(clip)], element);
  const playback = new FakePlayback(makeSequence({ audioSchedules: [schedule] }));

  schedule.update(0);
  playback.currentFrame = 60;
  schedule.update(60);
  assert.equal(element.currentTime, 2);

  element.currentTime = 1; // the element fell a second behind
  playback.currentFrame = 150;
  schedule.update(150);
  assert.equal(element.currentTime, 5);
});

test("a scrub outside every clip leaves the element untouched", () => {
  const PZ = makePZ();
  install(PZ);

  const clip = makeClip({ start: 300 });
  const element = new FakeElement(MEDIA_SECONDS);
  const schedule = createSchedule([makeItem(clip)], element);
  const playback = new FakePlayback(makeSequence({ audioSchedules: [schedule] }));

  playback.currentFrame = 1000;
  schedule.update(1000);
  assert.equal(schedule.currentItem, null, "no item covers frame 1000");
  assert.equal(element.currentTime, 0, "nothing to reposition");
});

test("seek detection only fires for jumps away from the engine position", () => {
  const schedule = createSchedule([], null);
  const playback = new FakePlayback(makeSequence({ audioSchedules: [schedule] }));

  // The playback clock advances fractionally; those writes are not seeks.
  schedule[STATE_KEY] = { pendingSeek: false, lastFrame: 10, playback: null };
  markSchedulesForSeek(playback, 10.5);
  assert.equal(schedule[STATE_KEY].pendingSeek, false, "a fractional tick is not a seek");
  markSchedulesForSeek(playback, 11.5);
  assert.equal(schedule[STATE_KEY].pendingSeek, false, "a one-frame step is not a seek");

  // An editor jump lands on a whole frame, far from the engine position.
  markSchedulesForSeek(playback, 285);
  assert.equal(schedule[STATE_KEY].pendingSeek, true, "a scrub to frame 285 is a seek");
});

test("video schedules are repositioned as well", () => {
  const PZ = makePZ();
  install(PZ);

  const clip = makeClip({ start: 0, length: 150 });
  const element = new FakeElement(10);
  const schedule = createSchedule([makeItem(clip)], element);
  const playback = new FakePlayback(makeSequence({ videoSchedules: [schedule] }));

  schedule.update(0);
  playback.currentFrame = 120;
  schedule.update(120);
  assert.equal(element.currentTime, currentTimeOf(clip, 120));
});

test("the patch keeps the item offset consistent with the element", () => {
  const PZ = makePZ();
  install(PZ);

  const clip = makeClip();
  const element = new FakeElement(MEDIA_SECONDS);
  const item = makeItem(clip);
  const schedule = createSchedule([item], element);
  const playback = new FakePlayback(makeSequence({ audioSchedules: [schedule] }));

  schedule.update(0);
  playback.currentFrame = 285;
  schedule.update(285);

  // PZ.ui.playbackDebug.calculateDesync compares el.currentTime - offset/rate
  // against the playhead, so offset has to follow the reposition.
  assert.equal(item.offset, element.currentTime);
});
