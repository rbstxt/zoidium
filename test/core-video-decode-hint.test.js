"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");

const source = fs.readFileSync(path.join(__dirname, "../plugins/core/video-decode-hint.js"), "utf8");

function loadModule() {
  const sandbox = { module: { exports: {} } };
  vm.runInNewContext(source, sandbox);
  return sandbox.module.exports;
}

function fixture(options = {}) {
  const api = loadModule();
  const notifications = [];
  const timers = new Map();
  let nextTimer = 1;
  const elements = [];
  const thumbnails = [];
  const document = {
    createElement(tag) {
      assert.equal(tag, "video");
      const element = {
        preload: "", src: "", currentTime: 0, duration: options.duration ?? 2,
        videoWidth: 0, videoHeight: 0, readyState: 0, error: null,
        onerror: null, onloadedmetadata: null, onloadeddata: null, onseeked: null,
        loadCalls: 0, removed: [],
        removeAttribute(name) { this.removed.push(name); },
        load() { this.loadCalls += 1; },
      };
      elements.push(element);
      return element;
    },
  };
  const installed = api.createLoadVideoWithDecodeHint({
    document,
    schedule(fn) { const id = nextTimer++; timers.set(id, fn); return id; },
    unschedule(id) { timers.delete(id); },
    generateThumbnail(element, width, height) {
      thumbnails.push({ element, width, height });
      return Promise.resolve(options.thumbnail ?? "thumbnail-bytes");
    },
    notify(detail) {
      if (options.notifyThrows) throw new Error("notification renderer");
      notifications.push(detail);
    },
    probeTimeoutMs: options.probeTimeoutMs ?? 15000,
  });
  const asset = (overrides = {}) => Object.assign({
    key: "asset-key", filename: "shockwave.mov",
    file: { type: "video/quicktime" }, url: "blob:video", length: Infinity,
  }, overrides);
  const fireTimer = () => { for (const fn of Array.from(timers.values())) fn(); };
  return { api, installed, notifications, timers, elements, thumbnails, asset, fireTimer };
}

const EXPECTED_MESSAGE = "This browser cannot decode \"shockwave.mov\"" +
  " (for example ProRes or HEVC .mov). Convert it to WebM (VP9, keeps transparency)" +
  " or MP4 (H.264) and import it again.";

test("decode error warns once with the file name and suggestion, settling empty", async () => {
  const f = fixture();
  const pending = f.installed.loadVideoWithDecodeHint(f.asset());
  f.elements[0].error = { code: 4 };
  f.elements[0].onerror();
  assert.equal(await pending, undefined);
  assert.equal(f.notifications.length, 1);
  assert.equal(f.notifications[0].title, "Video cannot be decoded");
  assert.equal(f.notifications[0].message, EXPECTED_MESSAGE);
  assert.equal(f.timers.size, 0);
});

test("error followed by the timeout still notifies once", async () => {
  const f = fixture();
  const pending = f.installed.loadVideoWithDecodeHint(f.asset());
  f.elements[0].onerror();
  f.fireTimer();
  assert.equal(await pending, undefined);
  assert.equal(f.notifications.length, 1);
});

test("playable video loads with native clip fields and no warning", async () => {
  const f = fixture({ duration: 2 });
  const asset = f.asset({ filename: "clip.mov", key: "mov-key" });
  const pending = f.installed.loadVideoWithDecodeHint(asset);
  const video = f.elements[0];
  video.videoWidth = 320;
  video.videoHeight = 240;
  video.readyState = 1;
  video.onloadedmetadata();
  assert.equal(typeof video.onseeked, "function");
  assert.equal(video.currentTime, 0.2);
  assert.equal(video.onloadedmetadata, null);
  assert.equal(video.onloadeddata, null);
  video.onseeked();
  const clip = await pending;
  // The clip crosses the vm realm boundary, so compare its JSON projection.
  assert.deepEqual(JSON.parse(JSON.stringify(clip)), {
    type: 0, start: 0, length: 60, offset: 0,
    properties: { name: "clip.mov", media: "mov-key" },
    object: { type: 0, effects: [], properties: { resolution: [320, 240] } },
    thumbnail: "thumbnail-bytes",
  });
  assert.equal(asset.length, 2);
  assert.equal(f.thumbnails.length, 1);
  assert.equal(f.thumbnails[0].width, 248);
  assert.equal(f.thumbnails[0].height, 186);
  assert.equal(f.notifications.length, 0);
  assert.equal(f.timers.size, 0);
  assert.equal(video.onseeked, null);
});

test("audio file resolves empty through zero dimensions without warning", async () => {
  const f = fixture();
  const pending = f.installed.loadVideoWithDecodeHint(f.asset({
    filename: "track.mp3", file: { type: "audio/mpeg" },
  }));
  const video = f.elements[0];
  video.readyState = 1;
  video.onloadeddata();
  video.onseeked();
  assert.equal(await pending, undefined);
  assert.equal(f.notifications.length, 0);
});

test("stalled probe warns once after the bounded timeout and settles empty", async () => {
  const f = fixture({ probeTimeoutMs: 50 });
  const pending = f.installed.loadVideoWithDecodeHint(f.asset());
  assert.equal(f.notifications.length, 0);
  f.fireTimer();
  assert.equal(await pending, undefined);
  assert.equal(f.notifications.length, 1);
  assert.equal(f.notifications[0].message, EXPECTED_MESSAGE);
});

test("metadata before the timeout suppresses the warning and keeps loading", async () => {
  const f = fixture();
  const pending = f.installed.loadVideoWithDecodeHint(f.asset());
  const video = f.elements[0];
  video.readyState = 1;
  f.fireTimer();
  assert.equal(f.notifications.length, 0);
  let settled = false;
  pending.then(() => { settled = true; });
  await Promise.resolve();
  assert.equal(settled, false);
  video.videoWidth = 320;
  video.videoHeight = 240;
  video.onloadedmetadata();
  video.onseeked();
  const clip = await pending;
  assert.equal(clip.object.properties.resolution.join("x"), "320x240");
  assert.equal(f.notifications.length, 0);
});

test("missing file or url settles like the native gate without warning", () => {
  const f = fixture();
  assert.equal(f.installed.loadVideoWithDecodeHint(null), undefined);
  assert.equal(f.installed.loadVideoWithDecodeHint({}), undefined);
  assert.equal(f.installed.loadVideoWithDecodeHint({ file: { type: "video/mp4" } }), undefined);
  assert.equal(f.elements.length, 0);
  assert.equal(f.notifications.length, 0);
});

test("repeated imports of the same asset warn once; other assets warn again", async () => {
  const f = fixture();
  const first = f.installed.loadVideoWithDecodeHint(f.asset());
  f.elements[0].onerror();
  assert.equal(await first, undefined);
  const second = f.installed.loadVideoWithDecodeHint(f.asset());
  f.elements[1].onerror();
  assert.equal(await second, undefined);
  assert.equal(f.notifications.length, 1);
  const third = f.installed.loadVideoWithDecodeHint(f.asset({ key: "other-key", filename: "other.mov" }));
  f.elements[2].onerror();
  assert.equal(await third, undefined);
  assert.equal(f.notifications.length, 2);
  assert.match(f.notifications[1].message, /other\.mov/);
});

test("audio assets never warn, even on element error", async () => {
  const f = fixture();
  const pending = f.installed.loadVideoWithDecodeHint(f.asset({
    filename: "track.mp3", file: { type: "audio/mpeg" },
  }));
  f.elements[0].error = { code: 3 };
  f.elements[0].onerror();
  assert.equal(await pending, undefined);
  assert.equal(f.notifications.length, 0);
});

test("notification failure cannot block the import", async () => {
  const f = fixture({ notifyThrows: true });
  const pending = f.installed.loadVideoWithDecodeHint(f.asset());
  f.elements[0].onerror();
  assert.equal(await pending, undefined);
});

test("failed probe releases the element source", async () => {
  const f = fixture();
  const pending = f.installed.loadVideoWithDecodeHint(f.asset());
  f.elements[0].onerror();
  await pending;
  assert.deepEqual(f.elements[0].removed, ["src"]);
  assert.equal(f.elements[0].loadCalls, 1);
});

test("activate patches loadVideo and dispose restores it, keeping foreign patches", () => {
  const api = loadModule();
  const cleanups = [];
  const prototype = { loadVideo() { return "native"; }, generateThumbnail() { return "thumb"; } };
  const original = prototype.loadVideo;
  const host = {
    document: { createElement: () => { throw new Error("no probe in this test"); } },
    setTimeout: () => 0, clearTimeout: () => {},
    ZoidiumUI: { notify: () => {} },
  };
  api.activate({ PZ: { ui: { media: { prototype } } }, window: host, lifecycle: { onDispose(fn) { cleanups.push(fn); } } });
  assert.notEqual(prototype.loadVideo, original);
  function foreign() { return "foreign"; }
  prototype.loadVideo = foreign;
  cleanups.forEach((fn) => fn());
  // Foreign replacement wins because the module only restores its own patch.
  assert.equal(prototype.loadVideo, foreign);
});

test("activate restores the native loader on dispose", () => {
  const api = loadModule();
  const cleanups = [];
  const prototype = { loadVideo() { return "native"; }, generateThumbnail() { return "thumb"; } };
  const original = prototype.loadVideo;
  const host = {
    document: {}, setTimeout: () => 0, clearTimeout: () => {},
    ZoidiumUI: { notify: () => {} },
  };
  api.activate({ PZ: { ui: { media: { prototype } } }, window: host, lifecycle: { onDispose(fn) { cleanups.push(fn); } } });
  assert.notEqual(prototype.loadVideo, original);
  cleanups.forEach((fn) => fn());
  assert.equal(prototype.loadVideo, original);
});

test("activate without media prototype or document leaves everything alone", () => {
  const api = loadModule();
  let disposed = 0;
  const lifecycle = { onDispose() { disposed += 1; } };
  api.activate({ PZ: {}, window: {}, lifecycle });
  api.activate({ PZ: { ui: {} }, window: { document: {} }, lifecycle });
  assert.equal(disposed, 0);
});
