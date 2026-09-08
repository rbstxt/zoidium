"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.join(__dirname, "..");

class Element {
  constructor(tagName) {
    this.tagName = tagName;
    this.children = [];
    this._style = {};
    Object.defineProperty(this, "style", {
      configurable: true,
      get: () => this._style,
      set: (value) => {
        if (typeof value === "string") this._style.cssText = value;
        else this._style = value;
      },
    });
    this.attributes = {};
    this.classList = {
      values: new Set(),
      add: (...values) => values.forEach((value) => this.classList.values.add(value)),
    };
  }

  get lastElementChild() {
    return this.children[this.children.length - 1] || null;
  }

  appendChild(child) {
    this.children.push(child);
    return child;
  }

  insertBefore(child, reference) {
    const index = this.children.indexOf(reference);
    this.children.splice(index < 0 ? this.children.length : index, 0, child);
    return child;
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }
}

function loadPatch() {
  const source = fs.readFileSync(
    path.join(root, "plugins", "core-patches", "audio-track-visibility.js"),
    "utf8",
  );
  const Tracks = function Tracks() {};
  const analyzeCalls = [];
  const state = { playback: null };
  const context = {
    document: { createElement: (tagName) => new Element(tagName) },
    PZ: {
      track: { audio: { prototype: { type: 1 } } },
      schedule: {
        analyzeSequence: (sequence) => {
          analyzeCalls.push(sequence);
          if (!state.playback) return;
          state.playback.currentFrame = 0;
          state.playback._exactFrame = 0;
          state.playback.speed = 0;
        },
        combineTracks: (tracks) => tracks.slice(),
      },
      ui: {
        generateIcon: (name) => {
          const icon = new Element("svg");
          icon.iconName = name;
          return icon;
        },
        timeline: { tracks: Tracks },
      },
    },
  };
  context.window = context;

  Tracks.prototype.createTrackLabel = function createTrackLabel() {
    const label = new Element("div");
    label.appendChild(new Element("span"));
    label.appendChild(new Element("button"));
    return label;
  };

  vm.runInNewContext(source, context);
  return { Tracks, PZ: context.PZ, analyzeCalls, state };
}

function createAudioSchedule(sequence, clip, mediaElement) {
  const schedule = {
    el: mediaElement,
    items: [{ start: 0, length: clip.length, clip }],
    currentItem: null,
    update(frame) {
      this.currentItem = frame >= 0 && frame < clip.length ? this.items[0] : null;
    },
  };
  sequence.audioSchedules = [schedule];
  return schedule;
}

test("audio track labels add an eye-like audio toggle", () => {
  const { Tracks, PZ, analyzeCalls, state } = loadPatch();
  const sequence = {};
  const tracks = new Tracks();
  const playback = { currentFrame: 42, _exactFrame: 42.25, speed: 1 };
  state.playback = playback;
  tracks.timeline = { editor: { playback }, sequence, scrollBar: { scrollLeft: 180 } };
  const audioTrack = { type: 1, clips: [] };
  const label = tracks.createTrackLabel(audioTrack, 1, 0);
  const button = label.children[1];
  const icon = button.children[0];

  assert.equal(label.children.length, 3);
  assert.equal(icon.iconName, "audio");
  assert.equal(button.title, "disable track");
  assert.equal(button.attributes["aria-label"], "disable track");
  assert.equal(icon.style.fill, "#ccc");

  button.onclick();

  assert.equal(audioTrack.enabled, false);
  assert.equal(button.title, "enable track");
  assert.equal(icon.iconName, "audio");
  assert.equal(icon.style.fill, "#8a2828");
  assert.equal(playback.currentFrame, 42.25);
  assert.equal(playback._exactFrame, 42.25);
  assert.equal(playback.speed, 1);
  assert.equal(tracks.timeline.scrollBar.scrollLeft, 180);
  assert.deepEqual(analyzeCalls, [sequence]);

  button.onclick();
  assert.equal(audioTrack.enabled, true);
  assert.equal(icon.style.fill, "#ccc");
  const combined = PZ.schedule.combineTracks([audioTrack]);
  assert.equal(combined.length, 1);
  assert.equal(combined[0], audioTrack);
});

test("reenabling audio restores the current clip position immediately", () => {
  const { Tracks, state } = loadPatch();
  const sequence = { audioSchedules: [] };
  const playback = {
    currentFrame: 120,
    _exactFrame: 120,
    speed: 0,
    frameRate: 60,
  };
  const clip = {
    length: 240,
    properties: { time: { get: (frame) => frame / 60 } },
  };
  const mediaElement = { currentTime: 0 };
  const tracks = new Tracks();
  state.playback = playback;
  tracks.timeline = { editor: { playback }, sequence };
  createAudioSchedule(sequence, clip, mediaElement);

  const audioTrack = { type: 1, clips: [clip] };
  const label = tracks.createTrackLabel(audioTrack, 1, 0);
  const button = label.children[1];
  button.onclick();

  assert.equal(audioTrack.enabled, false);
  button.onclick();

  assert.equal(audioTrack.enabled, true);
  assert.equal(mediaElement.currentTime, 2);
});

test("disabled audio tracks are omitted from generated audio schedules", () => {
  const { PZ } = loadPatch();
  const enabled = { type: 1, clips: [] };
  const disabled = { type: 1, enabled: false, clips: [] };
  const video = { type: 0, clips: [] };

  const combined = PZ.schedule.combineTracks([enabled, disabled, video]);
  assert.equal(combined.length, 2);
  assert.equal(combined[0], enabled);
  assert.equal(combined[1], video);
});
