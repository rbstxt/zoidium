"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { host } = require("./helpers/temporal-sampler-host.cjs");

const offset = offsetFrames => ({ update() {},
  _zoidiumTemporal: { getOperator: () => ({ kind: "time-offset", enabled: true, offsetFrames }) } });

// Main clip at 30 with comp offset 10. The video clip starts at 2 inside the
// comp, so comp time 10 + (frame - 30) maps to its local frame by subtracting 2.
function compHost(compEffects = [], innerEffects = [], adjustment = false) {
  const h = host(adjustment);
  const inner = new h.PZ.layer.scene();
  Object.setPrototypeOf(inner, h.PZ.layer.prototype);
  const innerClip = { start: 2, length: 100, object: inner, media: { url: "video" }, properties: { time: { get: f => f / 30 } } };
  inner.clip = innerClip;
  inner.effects = innerEffects;
  const comp = adjustment ? h.source : h.owner;
  Object.setPrototypeOf(comp, h.PZ.layer.composite.prototype);
  comp.offset = 10;
  comp.objects = [inner];
  comp.nestedTracks = () => [{ clips: [innerClip] }];
  comp.effects = adjustment ? [] : compEffects;
  const compClip = comp.clip;
  Object.assign(compClip, { start: 30, length: 60 });
  delete compClip.media;
  if (adjustment) h.owner.effects = compEffects;
  const origin = compClip.start + innerClip.start - comp.offset;
  const proxy = { start: 30, length: 60, origin, media: innerClip.media, object: inner, path: [compClip, innerClip],
    properties: { time: { get: f => innerClip.properties.time.get(f + 30 - origin) } },
    prepare: async function (frame) { this.prepared = frame - origin; } };
  const item = { start: 30, length: 60, clip: proxy, media: innerClip.media };
  h.sequence.videoTracks.forEach(track => { track.clips = [track.getCurrentClip()]; });
  h.sequence.videoSchedules = [Object.assign(new h.PZ.schedule(0), { items: [item], el: {} })];
  return { ...h, comp, compClip, inner, innerClip, proxy, item, origin };
}

test("nested video keeps its native clock without a time effect", () => {
  const h = compHost();
  const nested = h.state.mapScheduleClip(h.proxy, 40);
  assert.equal(nested.sourceFrame, 18);
  assert.equal(nested.localFrame, 18);
});

test("a comp clip's Time Offset moves the nested video source", () => {
  const h = compHost([offset(7)]);
  assert.equal(h.state.mapScheduleClip(h.proxy, 40).sourceFrame, 25);
});

test("the nested video's own Time Offset adds to its comp clip's", () => {
  const h = compHost([offset(7)], [offset(-3)]);
  assert.equal(h.state.mapScheduleClip(h.proxy, 40).sourceFrame, 22);
});

test("an adjustment Time Offset above the comp moves the nested video source", () => {
  const h = compHost([offset(7)], [], true);
  assert.equal(h.state.mapScheduleClip(h.proxy, 40).sourceFrame, 25);
});

test("the main schedule decodes the mapped time and prepares its nested clock", async () => {
  const h = compHost([offset(7)]);
  const schedule = h.sequence.videoSchedules[0];
  await schedule.prepare(40, { sequence: h.sequence });
  assert.equal(Math.round(h.decoded.at(-1) * 1e6) / 1e6, 25);
  assert.equal(h.proxy.prepared, 25);
});

test("a comp clip's sampler tap decodes the nested video at its own time", async () => {
  const h = compHost();
  h.comp.effects = [h.effect];
  h.effect.tryGetParentOfType = () => h.comp;
  h.effect._zoidiumFrameSampler.getRequest = () => ({ count: 1, offsetFrames: -3, startOpacity: 1, decay: 1 });
  await h.state.prepareFrameSamples(h.effect, 10, {});
  // Comp local 10 - 3, plus comp offset 10, minus the clip start 2.
  assert.equal(Math.round(h.decoded.at(-1) * 1e6) / 1e6, 15);
});

test("a sampler on the nested video decodes its tap in the clip's clock", async () => {
  const h = compHost();
  h.inner.effects = [h.effect];
  h.effect.tryGetParentOfType = () => h.inner;
  h.inner.toJSON = () => ({ type: 0, effects: [] });
  h.effect._zoidiumFrameSampler.getRequest = () => ({ count: 1, offsetFrames: -3, startOpacity: 1, decay: 1 });
  await h.state.prepareFrameSamples(h.effect, 18, {});
  assert.equal(Math.round(h.decoded.at(-1) * 1e6) / 1e6, 15);
});

test("a nested clip outside the mapped comp time is not selected", () => {
  const h = compHost([offset(-1000)]);
  // The comp clamps to its first frame: comp time 10, video local 8.
  assert.equal(h.state.mapScheduleClip(h.proxy, 40).sourceFrame, 8);
  h.innerClip.start = 50;
  assert.equal(h.state.mapScheduleClip(h.proxy, 40), null);
});

test("a comp clip that clamps at its out point holds the nested video's last frame", () => {
  const h = compHost([offset(1000)]);
  // Comp local 59 plus comp offset 10, minus the clip start 2.
  assert.equal(h.state.mapScheduleClip(h.proxy, 40).sourceFrame, 67);
});

test("playback pauses a nested video only while a time effect shifts it", () => {
  const shifted = compHost([offset(7)]);
  const schedule = shifted.sequence.videoSchedules[0];
  let paused = 0;
  Object.assign(schedule, { currentItem: shifted.item, el: { pause() { paused += 1; } }, playing: true });
  const playback = Object.assign(new shifted.PZ.ui.playback(), { _exactFrame: 40 });
  playback.updateSchedule(schedule, 1);
  assert.equal(paused, 1);
  assert.equal(schedule.playing, false);
  assert.equal(playback.nativeUpdates, undefined);

  const neutral = compHost();
  const plain = neutral.sequence.videoSchedules[0];
  Object.assign(plain, { currentItem: neutral.item, el: { pause() { throw new Error("must keep playing"); } } });
  const native = Object.assign(new neutral.PZ.ui.playback(), { _exactFrame: 40 });
  native.updateSchedule(plain, 1);
  assert.equal(native.nativeUpdates, 1);
});

test("the viewport prepares a shifted nested video and leaves a neutral one native", () => {
  const shifted = compHost([offset(7)]);
  delete shifted.effect._zoidiumFrameSampler;
  shifted.viewport.editor.playback.currentFrame = 40;
  const before = shifted.root.frames.length;
  shifted.viewport._render();
  assert.equal(shifted.root.frames.length, before, "the first draw waits for its decode");
  assert.equal(shifted.state.frameSamplerRuntimes.get(shifted.root).previewPending, true);

  const neutral = compHost();
  delete neutral.effect._zoidiumFrameSampler;
  neutral.viewport.editor.playback.currentFrame = 40;
  const start = neutral.root.frames.length;
  neutral.viewport._render();
  assert.equal(neutral.root.frames.length, start + 1);
});

test("a playback tick during a tap's decode cannot change the comp clips it captures", async () => {
  const h = compHost();
  h.comp.effects = [h.effect];
  h.effect.tryGetParentOfType = () => h.comp;
  h.effect._zoidiumFrameSampler.getRequest = () => ({ count: 1, offsetFrames: -3, startOpacity: 1, decay: 1 });
  h.comp.setCompTime = time => { h.comp.compTime = time; };
  const decode = h.PZ.schedule.prototype.decodeFrame;
  h.PZ.schedule.prototype.decodeFrame = async function (time) {
    h.comp.setCompTime(999);
    return decode.call(this, time);
  };
  const renderLayer = h.PZ.compositor.prototype.renderLayer, captured = [];
  h.PZ.compositor.prototype.renderLayer = function (layer) {
    if (layer === h.comp) captured.push(h.comp.compTime);
    return renderLayer.apply(this, arguments);
  };
  await h.state.prepareFrameSamples(h.effect, 10, {});
  assert.deepEqual(captured, [17], "comp local 7 plus comp offset 10");
});
