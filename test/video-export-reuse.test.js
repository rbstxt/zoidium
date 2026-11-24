"use strict";

// Verifies same-source-frame interval reuse on the <video> export path and the
// ZoidiumVideoStream.decodeExportFrame WebCodecs sequential export hook.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

function createHarness({ period = 1 / 30, duration = 5, initialTime = 0, videoStream } = {}) {
  const PZ = { schedule: class {}, export: class {} };
  const video = new EventTarget();
  let current = initialTime;
  Object.assign(video, {
    src: "clip-a.mp4",
    readyState: 4,
    duration,
    seeking: false,
    pause() {},
    seeks: [],
  });
  Object.defineProperty(video, "currentTime", {
    get: () => current,
    set(time) {
      video.seeks.push(time);
      current = time;
      queueMicrotask(() => video.dispatchEvent(new Event("seeked")));
    },
  });

  const policy = {
    async ensure() {},
    seekTime(_video, time) { return time; },
    frameInterval(el, time) {
      if (!period || !Number.isFinite(time) || time < 0) return null;
      const clamped = Number.isFinite(el.duration) && el.duration > 0
        ? Math.min(time, Math.max(0, el.duration - 1e-7)) : time;
      const index = Math.floor((clamped + 1e-9) / period);
      const start = index * period;
      const end = Math.min(start + period, el.duration);
      return { start, end };
    },
  };

  let textureUploads = 0;
  let needsUpdateValue = false;
  const texture = { image: video };
  Object.defineProperty(texture, "needsUpdate", {
    get: () => needsUpdateValue,
    set(value) {
      needsUpdateValue = value;
      if (value) textureUploads++;
    },
  });

  const sandbox = {
    PZ,
    setTimeout,
    clearTimeout,
    AbortController,
    ZoidiumVideoSeekPolicy: policy,
  };
  if (videoStream) sandbox.ZoidiumVideoStream = videoStream;
  sandbox.globalThis = sandbox;
  vm.runInNewContext(fs.readFileSync("plugins/core/video-frame-export.js", "utf8"), sandbox);
  PZ.videoFrameExportDiagnostics.enabled = true;

  const schedule = Object.assign(new PZ.schedule(), { el: video, texture });
  return {
    PZ,
    video,
    texture,
    schedule,
    sandbox,
    getTextureUploads: () => textureUploads,
    resetTextureUploads: () => { textureUploads = 0; },
  };
}

test("30 fps clip exported at 60 fps reuses decoded <video> frames within each interval without extra seeks or uploads", async () => {
  const { video, schedule, PZ, getTextureUploads } = createHarness({ period: 1 / 30, initialTime: 0 });
  // Output frames at 60 fps: 0/60, 1/60 (same), 2/60 (new), 3/60 (same), 4/60 (new), 5/60 (same)
  for (let i = 0; i < 6; i++) {
    await schedule.decodeFrame(i / 60);
  }
  // Frame 0 starts at video.currentTime = 0 (already decoded), frame 2 seeks to 2/60, frame 4 seeks to 4/60.
  assert.deepEqual(video.seeks, [2 / 60, 4 / 60]);
  assert.equal(getTextureUploads(), 3, "texture uploads once per source frame interval");
  const records = PZ.videoFrameExportDiagnostics.records;
  assert.deepEqual(Array.from(records, (r) => r.reused), [true, true, false, true, false, true]);
});

test("24 fps clip exported at 60 fps follows exact source intervals and re-seeks on sourceId change", async () => {
  const { video, schedule, getTextureUploads } = createHarness({ period: 1 / 24, initialTime: 1 });
  // Output frames 0..5 at 60 fps:
  // 0/60 (0.000) -> [0, 1/24) seek
  // 1/60 (0.0167) -> same interval
  // 2/60 (0.0333) -> same interval
  // 3/60 (0.0500) -> [1/24, 2/24) seek
  // 4/60 (0.0667) -> same interval
  // 5/60 (0.0833 = 2/24) -> [2/24, 3/24) seek
  for (let i = 0; i < 6; i++) {
    await schedule.decodeFrame(i / 60);
  }
  assert.deepEqual(video.seeks, [0, 3 / 60, 5 / 60]);
  assert.equal(getTextureUploads(), 3);

  // Changing sourceId clears the cached interval and forces a seek + upload even inside the old interval.
  video.src = "clip-b.mp4";
  await schedule.decodeFrame(5.5 / 60);
  assert.equal(video.seeks.length, 4);
  assert.equal(video.seeks[3], 5.5 / 60);
  assert.equal(getTextureUploads(), 4);
});

test("ZoidiumVideoStream.decodeExportFrame bypasses <video> seek when handled and falls back cleanly when unhandled", async () => {
  const wcCalls = [];
  const wcCanvas = { tag: "webcodecs-canvas" };
  let shouldHandle = true;
  const videoStream = {
    async decodeExportFrame(schedule, mediaTime, context) {
      wcCalls.push({ mediaTime, forceElementDecode: Boolean(context?.forceElementDecode) });
      if (!shouldHandle) return { handled: false };
      schedule.texture.image = wcCanvas;
      schedule.texture.needsUpdate = true;
      return {
        handled: true,
        pts: Math.floor(mediaTime * 30) / 30,
        end: (Math.floor(mediaTime * 30) + 1) / 30,
        reused: mediaTime > 0,
      };
    },
  };

  const { video, texture, schedule, PZ, getTextureUploads } = createHarness({
    period: 1 / 30,
    initialTime: 2,
    videoStream,
  });

  await schedule.decodeFrame(0);
  await schedule.decodeFrame(1 / 60);
  assert.equal(wcCalls.length, 2);
  assert.equal(video.seeks.length, 0, "WebCodecs handled frames must not seek <video>");
  assert.equal(texture.image, wcCanvas);
  assert.equal(schedule.__zoidiumVideoExportState.webcodecs, true);
  assert.equal(schedule.__zoidiumVideoExportState.frameStart, 0);
  assert.equal(schedule.__zoidiumVideoExportState.frameEnd, 1 / 30);
  assert.deepEqual(Array.from(PZ.videoFrameExportDiagnostics.records, (r) => r.reused), [false, true]);

  // Fallback when decodeExportFrame returns { handled: false }.
  shouldHandle = false;
  const uploadsBeforeFallback = getTextureUploads();
  await schedule.decodeFrame(1 / 30);
  assert.equal(wcCalls.length, 3);
  assert.equal(texture.image, video, "texture image restores to <video> on fallback");
  assert.deepEqual(video.seeks, [1 / 30], "fallback seeks <video> cleanly");
  assert.equal(schedule.__zoidiumVideoExportState.webcodecs, false);
  assert.equal(getTextureUploads(), uploadsBeforeFallback + 1);

  // forceElementDecode skips WebCodecs hook entirely.
  shouldHandle = true;
  await schedule.decodeFrame(2 / 30, { forceElementDecode: true });
  assert.equal(wcCalls.length, 3, "forceElementDecode does not call decodeExportFrame");
  assert.deepEqual(video.seeks, [1 / 30, 2 / 30]);
});
