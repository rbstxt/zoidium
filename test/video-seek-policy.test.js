"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { readTiming, target, ensure, isReady, canCapture } = require("../plugins/core/video-seek-policy");

function element(id, body) {
  assert.ok(body.length < 127);
  return [...Buffer.from(id, "hex"), 128 + body.length, ...body];
}
function uint(value) {
  const bytes = [];
  do { bytes.unshift(value % 256); value = Math.floor(value / 256); } while (value);
  return bytes;
}
function webm(period = 1 / 60, quantum = 0.001) {
  return new Uint8Array([
    ...element("1a45dfa3", element("4282", [...Buffer.from("webm")])),
    ...element("18538067", [
      ...element("1549a966", element("2ad7b1", uint(Math.round(quantum * 1e9)))),
      ...element("1654ae6b", element("ae", [
        ...element("83", [1]), ...element("23e383", uint(Math.floor(period * 1e9))),
      ])),
    ]),
  ]);
}
const index = (pts, time) => pts.findLastIndex(value => value <= time);

test("WebM source duration and timestamp quantum come from the video track", () => {
  const timing = readTiming(webm());
  assert.equal(timing.period, 1 / 60);
  assert.equal(timing.quantum, 0.001);
  assert.equal(readTiming(Buffer.from("....ftypisom")), null);
  for (let size = 0; size < 10; size++) assert.doesNotThrow(() => readTiming(webm().slice(0, size)));
});

test("rounded WebM PTS select all nominal frames, including reverse order", () => {
  for (const fps of [24, 30, 60, 120, 60000 / 1001]) {
    const timing = readTiming(webm(1 / fps));
    const pts = Array.from({ length: 600 }, (_, i) => Math.round(i / fps * 1000) / 1000);
    for (const i of Array.from({ length: 600 }, (_, i) => 599 - i)) {
      const requested = i / fps;
      const corrected = target(requested, 600 / fps, timing);
      assert.equal(index(pts, corrected), i, `source ${i} at ${fps} fps`);
      assert.ok(corrected - requested <= 0.000500000000001);
    }
  }
});

test("16, 32, 64 and 128 shutter samples preserve every fractional seek", () => {
  const { shutterTimes } = require("../plugins/native-fx/smart-motion-blur/math");
  let fractional = 0, corrected = 0;
  for (const fps of [24, 60, 120]) {
    const timing = readTiming(webm(1 / fps));
    for (const samples of [16, 32, 64, 128]) for (let output = 2; output < 12; output++) {
      for (const offset of shutterTimes(1, samples)) {
        const time = (output + offset) / fps;
        assert.equal(target(time, 10, timing), time);
        fractional++;
      }
      const time = output / fps;
      assert.ok(target(time, 10, timing) > time);
      corrected++;
      // A blanket 0.5 ms bias would incorrectly advance this sample.
      assert.equal(target(time - 0.0002, 10, timing), time - 0.0002);
    }
  }
  assert.equal(fractional, 7200);
  assert.equal(corrected, 120);
});

test("exact timebases keep their frame and fractional sample indices", () => {
  const fps = 60, pts = Array.from({ length: 600 }, (_, i) => i / fps);
  for (let i = 1; i < 599; i++) for (const fraction of [0, 1 / 32, 0.5, 31 / 32]) {
    const time = (i + fraction) / fps;
    assert.equal(target(time, 10, null), time, "MP4 has no WebM correction");
    assert.equal(index(pts, target(time, 10, null)), i);
    assert.equal(index(pts, target(time, 10, readTiming(webm()))), i);
  }
});

test("clamping and source-duration cap apply after correction", () => {
  const timing = readTiming(webm());
  for (const time of [-100, -1, 0]) assert.equal(target(time, 10, timing), 0);
  for (const time of [10, 100]) assert.equal(target(time, 10, timing), 10 - 1e-7);
  assert.equal(target(9.9999, 10, timing), 9.9999);
  const fast = readTiming(webm(1 / 1000));
  const bias = target(0.1, 10, fast) - 0.1;
  assert.ok(bias > 0 && bias < fast.period / 4);
});

function video(quantum = 0) {
  const element = new EventTarget();
  let time = 0;
  Object.assign(element, { duration: 10, readyState: 4, seeking: false, src: "fixture", paused: true, seeks: [],
    pause() { this.paused = true; } });
  Object.defineProperty(element, "currentTime", { configurable: true, get: () => time,
    set(value) { element.seeks.push(value); time = quantum ? Math.floor(value / quantum) * quantum : value; queueMicrotask(() => element.dispatchEvent(new Event("seeked"))); } });
  return element;
}

test("native setters and exact export preparation use one correction without double bias", async () => {
  const PZ = { schedule: class {}, export: class {} };
  const sandbox = { PZ, setTimeout, clearTimeout, AbortController };
  vm.createContext(sandbox);
  for (const name of ["video-seek-policy", "video-frame-export"]) {
    vm.runInContext(fs.readFileSync(`plugins/core/${name}.js`, "utf8"), sandbox);
  }
  const el = video(), media = { file: new Blob([webm()]) };
  const schedule = Object.assign(new PZ.schedule(), { el, currentItem: { media }, texture: {} });
  await sandbox.ZoidiumVideoSeekPolicy.ensure(el, media);
  const pts = Array.from({ length: 600 }, (_, i) => Math.round(i / 60 * 1000) / 1000);
  for (const frame of [106, 94, 0, 599, 123]) {
    const time = frame / 60;
    el.currentTime = time;
    const native = el.currentTime;
    await schedule.decodeFrame(time);
    assert.equal(el.currentTime, native);
    assert.equal(index(pts, el.currentTime), frame);
    assert.equal(schedule.__zoidiumVideoExportState.requestedTime, time);
  }
});

test("source replacement discards cached WebM timing", async () => {
  const el = video();
  await ensure(el, { file: new Blob([webm()]) });
  el.currentTime = 106 / 60;
  assert.ok(el.currentTime > 106 / 60);
  await ensure(el, { file: new Blob([Buffer.from("....ftypisom")]) });
  el.currentTime = 106 / 60;
  assert.equal(el.currentTime, 106 / 60);
});


test("sub-millisecond periods keep unbiased seeks", () => {
  for (const fps of [1001, 1500, 10000]) {
    const timing = readTiming(webm(1 / fps));
    assert.equal(target(timing.period * 10, 10, timing), timing.period * 10);
  }
});

test("an unoverridable media clock falls back to unbiased seeks", async () => {
  let time = 0;
  const prototype = { get currentTime() { return time; }, set currentTime(value) { time = value; } };
  const el = Object.preventExtensions(Object.assign(Object.create(prototype), { duration: 10 }));
  const media = { file: new Blob([webm()]) };
  await assert.doesNotReject(ensure(el, media));
  await assert.doesNotReject(ensure(el, media));
  el.currentTime = 106 / 60;
  assert.equal(el.currentTime, 106 / 60);
});


function pendingMedia() {
  let finish;
  const header = new Promise(resolve => { finish = resolve; });
  return { media: { file: { arrayBuffer() {}, slice() { return { arrayBuffer: () => header }; } } },
    finish() { finish(webm().buffer); } };
}

test("pending timing blocks capture and re-seeks a still-current unbiased boundary once", async () => {
  const el = video(), pending = pendingMedia(), request = 106 / 60;
  const resolving = ensure(el, pending.media);
  el.currentTime = request;
  assert.equal(el.currentTime, request);
  const sequence = { videoSchedules: [{ el, currentItem: { media: pending.media, start: 0, length: 600 } }] };
  assert.equal(canCapture(sequence, 106), false);
  pending.finish(); await resolving;
  assert.equal(el.currentTime, request + 0.0005);
  assert.equal(el.seeks.length, 2, "exactly one corrective seek");
  assert.equal(canCapture(sequence, 106), true);
  const corrected = el.currentTime;
  await ensure(el, pending.media);
  assert.equal(el.currentTime, corrected, "resolution cannot apply the correction twice");
  assert.equal(el.seeks.length, 2);
  el.seeking = true;
  assert.equal(canCapture(sequence, 106), false, "a corrective seek must finish before capture");
});

test("timing resolution corrects only the latest request and leaves fractional samples unchanged", async () => {
  const el = video(), pending = pendingMedia();
  const resolving = ensure(el, pending.media);
  el.currentTime = 106 / 60;
  el.currentTime = 0.125;
  pending.finish(); await resolving;
  assert.equal(el.currentTime, 0.125);
  assert.equal(isReady(el, pending.media), true);
});

test("timing resolution never rewinds a playing media clock", async () => {
  const el = video(), pending = pendingMedia();
  const resolving = ensure(el, pending.media);
  el.currentTime = 106 / 60; el.paused = false;
  pending.finish(); await resolving;
  assert.equal(el.currentTime, 106 / 60);
  el.paused = true;
  assert.equal(isReady(el, pending.media), false, "unadjusted data stays out of the cache");
  el.currentTime = 106 / 60;
  assert.equal(isReady(el, pending.media), true);
});


test("the native schedule's first unbiased seek retains its unrounded request for correction", async () => {
  const pending = pendingMedia(), el = video(1e-6), request = 106 / 60;
  const PZ = { schedule: class {
    static type = { VIDEO: 0 };
    update() { this.currentItem = { media: pending.media }; this.el.currentTime = request; }
  } };
  const sandbox = { PZ };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync("plugins/core/video-seek-policy.js", "utf8"), sandbox);
  const schedule = Object.assign(new PZ.schedule(), { type: 0, el });
  schedule.update();
  assert.equal(el.seeks.length, 1);
  assert.ok(el.currentTime < 1.767, "the initial unbiased seek presents the preceding frame");
  pending.finish(); await sandbox.ZoidiumVideoSeekPolicy.ensure(el, pending.media);
  assert.equal(el.seeks.length, 2);
  assert.equal(el.seeks[1], request + 0.0005, "correct the logical request, not its rounded clock value");
  assert.ok(el.currentTime >= 1.767);
});


test("a late timing result cannot correct a replacement media source", async () => {
  const el = video(), pending = pendingMedia();
  const old = ensure(el, pending.media);
  el.currentTime = 106 / 60;
  const next = { file: new Blob([Buffer.from("....ftypisom")]) };
  el.src = "replacement";
  await ensure(el, next);
  el.currentTime = 0.125;
  pending.finish(); await old;
  assert.equal(el.currentTime, 0.125);
  assert.equal(el.seeks.length, 2);
  assert.equal(isReady(el, pending.media), false);
  assert.equal(isReady(el, next), true);
});

function u16(value) {
  const out = Buffer.alloc(2);
  out.writeUInt16BE(value, 0);
  return out;
}
function u32(value) {
  const out = Buffer.alloc(4);
  out.writeUInt32BE(value >>> 0, 0);
  return out;
}
function u64(value) {
  const out = Buffer.alloc(8);
  out.writeBigUInt64BE(BigInt(value), 0);
  return out;
}
function mp4box(type, ...parts) {
  const body = Buffer.concat(parts.map(part => (Buffer.isBuffer(part) ? part : Buffer.from(part))));
  return Buffer.concat([Buffer.concat([u32(8 + body.length), Buffer.from(type, "ascii")]), body]);
}
function mdhd(timescale, version = 0) {
  const body = version === 0
    ? Buffer.concat([Buffer.alloc(4), u32(0), u32(0), u32(timescale), u32(timescale * 120), Buffer.from([85, 196, 0, 0])])
    : Buffer.concat([Buffer.from([1, 0, 0, 0]), Buffer.alloc(16), u32(timescale), Buffer.alloc(8), Buffer.from([85, 196, 0, 0])]);
  return mp4box("mdhd", body);
}
function hdlr(handler = "vide") {
  return mp4box("hdlr", Buffer.alloc(4), u32(0), Buffer.from(handler, "ascii"), Buffer.alloc(12), Buffer.from("VideoHandler", "ascii"));
}
function stts(entries) {
  return mp4box("stts", Buffer.alloc(4), u32(entries.length),
    ...entries.map(([count, delta]) => Buffer.concat([u32(count), u32(delta)])));
}
function elst(entries, version = 0) {
  const head = Buffer.concat([Buffer.from([version, 0, 0, 0]), u32(entries.length)]);
  const body = entries.map(([segment, mediaTime, rate = 1]) => (version === 0
    ? Buffer.concat([u32(segment), u32(mediaTime), u16(rate), u16(0)])
    : Buffer.concat([u64(segment), u64(mediaTime), u16(rate), u16(0)])));
  return mp4box("elst", head, ...body);
}
function videoTrak({ timescale = 90000, entries = [[300, 3000]], handler = "vide", edit = null, mdhdVersion = 0 } = {}) {
  const mdia = mp4box("mdia", mdhd(timescale, mdhdVersion), hdlr(handler), mp4box("minf", mp4box("stbl", stts(entries))));
  return mp4box("trak", ...(edit ? [mp4box("edts", edit)] : []), mdia);
}
function mp4File({ traks, moovFirst = true, mdatSize = 0, moovLarge = false } = {}) {
  const ftyp = mp4box("ftyp", Buffer.from("isom", "ascii"), u32(512), Buffer.from("isomiso2", "ascii"));
  let moov = mp4box("moov", ...traks);
  if (moovLarge) {
    const body = moov.subarray(8);
    moov = Buffer.concat([u32(1), Buffer.from("moov", "ascii"), u64(16 + body.length), body]);
  }
  const mdat = mp4box("mdat", Buffer.alloc(mdatSize));
  return Buffer.concat(moovFirst ? [ftyp, moov, mdat] : [ftyp, mdat, moov]);
}

test("MP4 timing comes from the first video track at any moov position", () => {
  for (const moovFirst of [true, false]) {
    const timing = readTiming(mp4File({ traks: [videoTrak({ timescale: 12288, entries: [[48, 512]] })], moovFirst }));
    assert.equal(timing.quantum, 1 / 12288);
    assert.equal(timing.period, 1 / 24);
  }
  const large = readTiming(mp4File({ traks: [videoTrak({ timescale: 12288, entries: [[48, 512]] })], moovLarge: true }));
  assert.equal(large.period, 1 / 24);
  assert.equal(large.quantum, 1 / 12288);
  const audioFirst = readTiming(mp4File({ traks: [
    videoTrak({ timescale: 48000, entries: [[96, 1024]], handler: "soun" }),
    videoTrak({ timescale: 90000, entries: [[300, 3000]] }),
  ] }));
  assert.equal(audioFirst.period, 1 / 30);
  assert.equal(audioFirst.quantum, 1 / 90000);
  const v1 = readTiming(mp4File({ traks: [videoTrak({ timescale: 90000, entries: [[300, 3000]], mdhdVersion: 1 })] }));
  assert.equal(v1.period, 1 / 30);
});

test("MP4 timing covers 23.976, 24, 25, 29.97, 30 and 60 fps timescales", () => {
  const cases = [
    [24000 / 1001, 24000, 1001],
    [24, 12288, 512],
    [24, 30000, 1250],
    [25, 90000, 3600],
    [25, 25000, 1000],
    [30000 / 1001, 30000, 1001],
    [30, 600, 20],
    [30, 90000, 3000],
    [60, 90000, 1500],
    [60, 15360, 256],
  ];
  for (const [rate, timescale, delta] of cases) {
    const timing = readTiming(mp4File({ traks: [videoTrak({ timescale, entries: [[240, delta]] })] }));
    assert.equal(timing.quantum, 1 / timescale, `${rate} fps quantum`);
    assert.ok(Math.abs(timing.period - 1 / rate) < 1e-12, `${rate} fps period`);
  }
});

test("MP4 variable rates and non-video tracks keep uncorrected seeks", () => {
  assert.equal(readTiming(mp4File({ traks: [videoTrak({ timescale: 90000, entries: [[100, 3000], [100, 3001]] })] })), null);
  assert.equal(readTiming(mp4File({ traks: [videoTrak({ timescale: 90000, entries: [[100, 0]] })] })), null);
  assert.equal(readTiming(mp4File({ traks: [videoTrak({ timescale: 0, entries: [[100, 3000]] })] })), null);
  assert.equal(readTiming(mp4File({ traks: [videoTrak({ timescale: 48000, entries: [[96, 1024]], handler: "soun" })] })), null);
  assert.equal(readTiming(mp4box("ftyp", Buffer.from("isom", "ascii"), u32(512))), null);
  assert.equal(readTiming(new Uint8Array(0)), null);
});

test("MP4 edit lists shift or preserve nominal boundaries", () => {
  const base = { timescale: 24000, entries: [[240, 1000]] };
  assert.equal(readTiming(mp4File({ traks: [videoTrak(base)] })).period, 1 / 24);
  assert.equal(readTiming(mp4File({ traks: [videoTrak({ ...base, edit: elst([]) })] })).period, 1 / 24);
  assert.equal(readTiming(mp4File({ traks: [videoTrak({ ...base, edit: elst([[24000, 0]]) })] })).period, 1 / 24);
  assert.equal(readTiming(mp4File({ traks: [videoTrak({ ...base, edit: elst([[12000, 0], [12000, 0]]) })] })).period, 1 / 24);
  assert.equal(readTiming(mp4File({ traks: [videoTrak({ ...base, edit: elst([[24000, 0]], 1) })] })).period, 1 / 24);
  assert.equal(readTiming(mp4File({ traks: [videoTrak({ ...base, edit: elst([[2000, 0xFFFFFFFF]]) })] })), null);
  assert.equal(readTiming(mp4File({ traks: [videoTrak({ ...base, edit: elst([[2000, 480]]) })] })), null);
  assert.equal(readTiming(mp4File({ traks: [videoTrak({ ...base, edit: elst([[24000, 0, 2]]) })] })), null);
  assert.equal(readTiming(mp4File({ traks: [videoTrak({ ...base, edit: elst([[24000, 480]], 1) })] })), null);
});

test("truncated MP4 input returns null without throwing", () => {
  const full = mp4File({ traks: [videoTrak({ timescale: 90000, entries: [[300, 3000]] })], moovFirst: false, mdatSize: 1024 });
  assert.ok(readTiming(full));
  for (let size = 0; size < 64; size++) assert.doesNotThrow(() => assert.equal(readTiming(full.slice(0, size)), null));
  for (const size of [full.length - 20, full.length - 8, full.length - 1]) {
    assert.equal(readTiming(full.slice(0, size)), null);
  }
});

test("MP4 boundary requests gain a sub-frame bias while fractional requests do not", () => {
  const timing = readTiming(mp4File({ traks: [videoTrak({ timescale: 24000, entries: [[240, 1000]] })] }));
  assert.equal(timing.period, 1 / 24);
  const bias = target(1, 10, timing) - 1;
  assert.ok(bias > 1e-6 && bias < 0.0005);
  const pts = Array.from({ length: 241 }, (_, i) => i / 24);
  for (const i of [1, 13, 106, 240]) {
    const corrected = target(i / 24, 30, timing);
    assert.ok(Math.abs(corrected - i / 24 - bias) < 1e-12);
    assert.equal(index(pts, corrected), i);
  }
  assert.equal(target(0, 10, timing), 0);
  assert.equal(target(106.5 / 24, 10, timing), 106.5 / 24);
  assert.equal(target(106 / 24 - 0.0002, 10, timing), 106 / 24 - 0.0002);
});

test("MP4 bias exceeds decoder precision for common timescales", () => {
  const cases = [
    [600, 0.0005],
    [12288, 0.0000406901],
    [15360, 0.00003255208],
    [24000, 0.00002083333],
    [30000, 0.00001666667],
    [90000, 0.000005555556],
  ];
  for (const [timescale, expected] of cases) {
    const timing = readTiming(mp4File({ traks: [videoTrak({ timescale, entries: [[240, timescale / 24]] })] }));
    const bias = target(1 / 24, 10, timing) - 1 / 24;
    assert.ok(Math.abs(bias - expected) < 1e-9, `timescale ${timescale}`);
    assert.ok(bias > 1e-6, `timescale ${timescale} stays above one microsecond`);
  }
});

test("timingFor finds a moov beyond the header window with small reads", async () => {
  const file = mp4File({ traks: [videoTrak({ timescale: 90000, entries: [[300, 3000]] })], moovFirst: false, mdatSize: 300 * 1024 });
  assert.ok(file.length > 256 * 1024);
  const blob = new Blob([file]);
  const reads = [];
  const tracked = { size: blob.size,
    arrayBuffer: () => blob.arrayBuffer(),
    slice: (start, end) => {
      reads.push([start, end]);
      const part = blob.slice(start, end);
      return { arrayBuffer: () => part.arrayBuffer() };
    } };
  const el = video(), media = { file: tracked };
  await ensure(el, media);
  const boundary = 106 / 30;
  el.currentTime = boundary;
  assert.ok(el.currentTime > boundary);
  const large = reads.filter(([start, end]) => end - start > 16);
  assert.equal(large.length, 2);
  assert.deepEqual(large[0], [0, 256 * 1024]);
  assert.ok(large[1][0] >= 256 * 1024);
  assert.ok(large[1][1] - large[1][0] <= 16 * 1024 * 1024);
  assert.ok(reads.length <= 8);
});
