"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { readTiming, target } = require("../plugins/core/video-seek-policy");

// Box builders mirror test/video-seek-policy.test.js so both suites describe
// the same fixtures. Keep them in sync when the shared builders change.
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
// A table whose declared entry count exceeds the entries actually present.
function truncatedStts(entries, declared = entries.length + 1) {
  return mp4box("stts", Buffer.alloc(4), u32(declared),
    ...entries.map(([count, delta]) => Buffer.concat([u32(count), u32(delta)])));
}
function elst(entries, version = 0) {
  const head = Buffer.concat([Buffer.from([version, 0, 0, 0]), u32(entries.length)]);
  const body = entries.map(([segment, mediaTime, rate = 1]) => (version === 0
    ? Buffer.concat([u32(segment), u32(mediaTime), u16(rate), u16(0)])
    : Buffer.concat([u64(segment), u64(mediaTime), u16(rate), u16(0)])));
  return mp4box("elst", head, ...body);
}
function ctts(entries, version = 0) {
  const head = Buffer.concat([Buffer.from([version, 0, 0, 0]), u32(entries.length)]);
  const body = entries.map(([count, offset]) => Buffer.concat([u32(count), u32(offset)]));
  return mp4box("ctts", head, ...body);
}
function truncatedCtts(entries, declared = entries.length + 1) {
  const head = Buffer.concat([Buffer.from([0, 0, 0, 0]), u32(declared)]);
  const body = entries.map(([count, offset]) => Buffer.concat([u32(count), u32(offset)]));
  return mp4box("ctts", head, ...body);
}
function videoTrak({ timescale = 90000, entries = [[300, 3000]], handler = "vide", edit = null, mdhdVersion = 0, composition = null, sttsBox = null } = {}) {
  const table = sttsBox || stts(entries);
  const stbl = composition ? mp4box("stbl", table, composition) : mp4box("stbl", table);
  const mdia = mp4box("mdia", mdhd(timescale, mdhdVersion), hdlr(handler), mp4box("minf", stbl));
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

const SWEEP = [-1, 0, 0.001, 0.1, 0.5, 1, 1 + 1e-9, 2.5, 5, 9.9999, 10, 100];
function requestsFor(timing) {
  const requests = SWEEP.slice();
  if (timing && timing.period) {
    for (const n of [1, 2, 24, 106]) {
      const boundary = n * timing.period;
      for (const offset of [0, 1e-9, -1e-9]) requests.push(boundary + offset);
    }
  }
  return requests;
}

test("a multi-run stts without ctts exposes presentation times and corrects them", () => {
  const timescale = 15360;
  const timing = readTiming(mp4File({ traks: [videoTrak({ timescale, entries: [[30, 512], [24, 640]] })] }));
  assert.ok(timing, "a variable-rate track yields a table");
  assert.equal(timing.period, undefined, "a table has no nominal period");
  assert.equal(timing.quantum, 1 / timescale);
  assert.ok(timing.pts instanceof Float64Array);
  assert.equal(timing.pts.length, 54);
  assert.deepEqual([...timing.pts.slice(0, 3)], [0, 512 / timescale, 1024 / timescale]);
  assert.equal(timing.pts[29], 29 * 512 / timescale);
  assert.equal(timing.pts[30], 30 * 512 / timescale);
  assert.equal(timing.pts[53], (30 * 512 + 23 * 640) / timescale);
  const boundary = 30 * 512 / timescale;
  const bias = Math.min(0.0005, timing.quantum / 2, 640 / timescale * 0.249);
  assert.ok(bias > 2e-6);
  assert.ok(Math.abs(target(boundary, 10, timing) - boundary - bias) < 1e-15);
});

test("B-frame composition offsets that leave the grid are sorted into a table", () => {
  const timescale = 12288;
  const composition = ctts([[1, 1024], [1, 0], [1, 768], [1, 0]]);
  const timing = readTiming(mp4File({ traks: [videoTrak({ timescale, entries: [[4, 512]], composition })] }));
  assert.ok(timing && timing.pts, "offsets off the delta grid use the table");
  assert.deepEqual([...timing.pts], [512, 1024, 1536, 1792].map(value => value / timescale));
  const boundary = 1536 / timescale;
  assert.ok(target(boundary, 10, timing) > boundary, "a stored presentation time gains a bias");
  const between = 1280 / timescale;
  assert.equal(target(between, 10, timing), between, "an unstored time keeps its frame");
});

test("a non-zero edit list subtracts its media time from the table", () => {
  const timescale = 12288;
  const edit = elst([[2000, 256]]);
  const composition = ctts([[1, 512], [3, 0]]);
  const timing = readTiming(mp4File({ traks: [videoTrak({ timescale, entries: [[4, 512]], edit, composition })] }));
  assert.ok(timing && timing.pts);
  assert.deepEqual([...timing.pts], [256, 256, 768, 1280].map(value => value / timescale));
  const boundary = 768 / timescale;
  assert.ok(target(boundary, 10, timing) > boundary);
});

test("negative version 1 offsets sort below zero and stay correctable", () => {
  const timescale = 12288;
  const composition = ctts([[1, -256], [3, 0]], 1);
  const timing = readTiming(mp4File({ traks: [videoTrak({ timescale, entries: [[4, 512]], composition })] }));
  assert.ok(timing && timing.pts);
  assert.deepEqual([...timing.pts], [-256, 512, 1024, 1536].map(value => value / timescale));
  assert.equal(target(0, 10, timing), 0, "a zero request stays uncorrected");
  const boundary = 512 / timescale;
  assert.ok(target(boundary, 10, timing) > boundary);
});

test("only requests within half a timestamp tick of a presentation time are corrected", () => {
  const timescale = 15360;
  const timing = readTiming(mp4File({ traks: [videoTrak({ timescale, entries: [[2, 512], [2, 640]] })] }));
  const tentative = [0, 512 / timescale, 1024 / timescale, 1664 / timescale];
  assert.deepEqual([...timing.pts], tentative);
  const frame = tentative[2];
  const bias = Math.min(0.0005, timing.quantum / 2, 640 / timescale * 0.249);
  assert.ok(Math.abs(target(frame, 10, timing) - frame - bias) < 1e-15, "exactly on a frame");
  const half = frame - timing.quantum / 2;
  assert.ok(Math.abs(target(half, 10, timing) - frame - bias) < 1e-15, "half a tick before a frame snaps to it");
  const beyond = frame - timing.quantum * 0.51;
  assert.equal(target(beyond, 10, timing), beyond, "beyond half a tick keeps the request");
  const between = (tentative[1] + tentative[2]) / 2;
  assert.equal(target(between, 10, timing), between, "a time between frames keeps the request");
  const fractional = frame + 640 / timescale * 0.5;
  assert.equal(target(fractional, 10, timing), fractional, "a shutter sample inside a frame keeps the request");
});

test("the last presentation time uses the previous gap and duration clamps", () => {
  const timescale = 15360;
  const timing = readTiming(mp4File({ traks: [videoTrak({ timescale, entries: [[1, 1], [1, 1000]] })] }));
  assert.deepEqual([...timing.pts], [0, 1 / timescale]);
  const last = timing.pts[1];
  const bias = 0.249 / timescale;
  assert.ok(bias > 2e-6);
  assert.ok(Math.abs(target(last, 10, timing) - last - bias) < 1e-15, "the previous gap sets the last bias");
  assert.equal(target(0, 10, timing), 0);
  assert.equal(target(-1, 10, timing), 0);
  assert.equal(target(100, 10, timing), 10 - 1e-7);
  assert.equal(target(last, last, timing), last - 1e-7, "the duration clamp still wins");
});

test("more than 1,000,000 samples keep uncorrected seeks", () => {
  const capped = readTiming(mp4File({ traks: [videoTrak({ timescale: 90000, entries: [[600000, 3000], [600001, 3001]] })] }));
  assert.equal(capped, null);
  const accepted = readTiming(mp4File({ traks: [videoTrak({ timescale: 90000, entries: [[500000, 3000], [500000, 3001]] })] }));
  assert.ok(accepted && accepted.pts);
  assert.equal(accepted.pts.length, 1000000);
});

test("a ctts total that disagrees with stts keeps uncorrected seeks", () => {
  const base = { timescale: 90000, entries: [[2, 3000]] };
  assert.equal(readTiming(mp4File({ traks: [videoTrak({ ...base, composition: ctts([[1, 3000]]) })] })), null);
  assert.equal(readTiming(mp4File({ traks: [videoTrak({ ...base, composition: ctts([[3, 3000]]) })] })), null);
  assert.equal(readTiming(mp4File({ traks: [videoTrak({ ...base, composition: ctts([[2, 3000]], 2) })] })), null);
});

test("truncated stts and ctts payloads keep uncorrected seeks", () => {
  const truncatedTable = mp4File({ traks: [videoTrak({
    timescale: 90000, sttsBox: truncatedStts([[1, 3000], [1, 3001]]),
  })] });
  assert.equal(readTiming(truncatedTable), null);
  const truncatedOffsets = mp4File({ traks: [videoTrak({
    timescale: 90000, entries: [[2, 3000]], composition: truncatedCtts([[1, 3000], [1, 3001]]),
  })] });
  assert.equal(readTiming(truncatedOffsets), null);
  const valid = mp4File({ traks: [videoTrak({ timescale: 15360, entries: [[30, 512], [24, 640]] })] });
  for (let size = 0; size < valid.length; size += 7) {
    assert.doesNotThrow(() => {
      const timing = readTiming(valid.slice(0, size));
      assert.ok(timing === null || timing.pts.length === 54);
    });
  }
});

test("empty and multi-entry edit lists keep uncorrected seeks", () => {
  const base = { timescale: 24000, entries: [[240, 1000]] };
  assert.equal(readTiming(mp4File({ traks: [videoTrak({ ...base, edit: elst([[2000, 0xFFFFFFFF]]) })] })), null);
  assert.equal(readTiming(mp4File({ traks: [videoTrak({ ...base, edit: elst([[24000, 0xFFFFFFFF]]) })] })), null);
  assert.equal(readTiming(mp4File({ traks: [videoTrak({ ...base, edit: elst([[12000, 0], [12000, 1000]]) })] })), null);
  assert.equal(readTiming(mp4File({ traks: [videoTrak({ ...base, edit: elst([[24000, 1000, 2]]) })] })), null);
});

// Captured from the policy before the presentation-time table was added, so a
// regression in the constant-grid path shows up as a diff here.
const CFR_FIXTURES = {
  webm60: {
    timing: {"period":0.016666666666666666,"quantum":0.001},
    results: [0, 0, 0.001, 0.1005, 0.5005, 1.0005, 1.000000001, 2.5005, 5.0005, 9.9999, 9.9999999, 9.9999999, 0.017166666666666667, 0.017166667666666666, 0.017166665666666667, 0.03383333333333333, 0.03383333433333333, 0.033833332333333334, 0.4005, 0.40000000100000005, 0.399999999, 1.7671666666666666, 1.7666666676666667, 1.7666666656666665],
  },
  webm24: {
    timing: {"period":0.041666666666666664,"quantum":0.001},
    results: [0, 0, 0.001, 0.1, 0.5005, 1.0005, 1.000000001, 2.5005, 5.0005, 9.9999, 9.9999999, 9.9999999, 0.042166666666666665, 0.042166667666666664, 0.042166665666666665, 0.08383333333333333, 0.08383333433333333, 0.08383333233333333, 1.0005, 1.000000001, 1.000499999, 4.417166666666666, 4.416666667666666, 4.416666665666666],
  },
  mp4_12288_24: {
    timing: {"period":0.041666666666666664,"quantum":0.00008138020833333333,"phase":0},
    results: [0, 0, 0.001, 0.1, 0.5000406901041666, 1.0000406901041667, 1.000000001, 2.5000406901041665, 5.000040690104167, 9.9999, 9.9999999, 9.9999999, 0.04170735677083333, 0.04170735777083333, 0.04170735577083333, 0.0833740234375, 0.0833740244375, 0.0833740224375, 1.0000406901041667, 1.000000001, 1.0000406891041667, 4.416707356770833, 4.416666667666666, 4.416666665666666],
  },
  mp4_30000_2398: {
    timing: {"period":0.03336666666666667,"quantum":0.000033333333333333335,"phase":0},
    results: [0, 0, 0.001, 0.1, 0.5, 1, 1.000000001, 2.5, 5, 9.9999, 9.9999999, 9.9999999, 0.033383333333333334, 0.033383334333333334, 0.033383332333333335, 0.06675, 0.066750001, 0.066749999, 0.8008166666666667, 0.8008166676666667, 0.8008166656666668, 3.536883333333334, 3.536866667666667, 3.536866665666667],
  },
  mp4_90000_30_moovLast: {
    timing: {"period":0.03333333333333333,"quantum":0.000011111111111111112,"phase":0},
    results: [0, 0, 0.001, 0.10000555555555556, 0.5000055555555556, 1.0000055555555556, 1.000000001, 2.5000055555555556, 5.000005555555555, 9.9999, 9.9999999, 9.9999999, 0.03333888888888889, 0.03333888988888889, 0.03333888788888889, 0.06667222222222222, 0.06667222322222222, 0.06667222122222222, 0.8000055555555556, 0.8000055565555556, 0.8000055545555557, 3.533338888888889, 3.5333333343333333, 3.533333332333333],
  },
  mp4_600_30_large: {
    timing: {"period":0.03333333333333333,"quantum":0.0016666666666666668,"phase":0},
    results: [0, 0, 0.001, 0.1005, 0.5005, 1.0005, 1.000000001, 2.5005, 5.0005, 9.9999, 9.9999999, 9.9999999, 0.03383333333333333, 0.03383333433333333, 0.033833332333333334, 0.06716666666666667, 0.06716666766666667, 0.06716666566666667, 0.8005, 0.800500001, 0.800499999, 3.5338333333333334, 3.5333333343333333, 3.533333332333333],
  },
  mp4_edit_zero: {
    timing: {"period":0.041666666666666664,"quantum":0.000041666666666666665,"phase":0},
    results: [0, 0, 0.001, 0.1, 0.5000208333333334, 1.0000208333333334, 1.000000001, 2.500020833333333, 5.000020833333333, 9.9999, 9.9999999, 9.9999999, 0.041687499999999995, 0.041687500999999995, 0.041687498999999996, 0.08335416666666666, 0.08335416766666666, 0.08335416566666666, 1.0000208333333334, 1.000000001, 1.0000208323333333, 4.416687499999999, 4.416666667666666, 4.416666665666666],
  },
  mp4_edit_empty: {
    timing: {"period":0.041666666666666664,"quantum":0.000041666666666666665,"phase":0},
    results: [0, 0, 0.001, 0.1, 0.5000208333333334, 1.0000208333333334, 1.000000001, 2.500020833333333, 5.000020833333333, 9.9999, 9.9999999, 9.9999999, 0.041687499999999995, 0.041687500999999995, 0.041687498999999996, 0.08335416666666666, 0.08335416766666666, 0.08335416566666666, 1.0000208333333334, 1.000000001, 1.0000208323333333, 4.416687499999999, 4.416666667666666, 4.416666665666666],
  },
  mp4_edit_two_zero: {
    timing: {"period":0.041666666666666664,"quantum":0.000041666666666666665,"phase":0},
    results: [0, 0, 0.001, 0.1, 0.5000208333333334, 1.0000208333333334, 1.000000001, 2.500020833333333, 5.000020833333333, 9.9999, 9.9999999, 9.9999999, 0.041687499999999995, 0.041687500999999995, 0.041687498999999996, 0.08335416666666666, 0.08335416766666666, 0.08335416566666666, 1.0000208333333334, 1.000000001, 1.0000208323333333, 4.416687499999999, 4.416666667666666, 4.416666665666666],
  },
  mp4_bframe: {
    timing: {"period":0.041666666666666664,"quantum":0.00008138020833333333,"phase":0},
    results: [0, 0, 0.001, 0.1, 0.5000406901041666, 1.0000406901041667, 1.000000001, 2.5000406901041665, 5.000040690104167, 9.9999, 9.9999999, 9.9999999, 0.04170735677083333, 0.04170735777083333, 0.04170735577083333, 0.0833740234375, 0.0833740244375, 0.0833740224375, 1.0000406901041667, 1.000000001, 1.0000406891041667, 4.416707356770833, 4.416666667666666, 4.416666665666666],
  },
  mp4_bframe_reorder: {
    timing: {"period":0.041666666666666664,"quantum":0.00008138020833333333,"phase":0},
    results: [0, 0, 0.001, 0.1, 0.5000406901041666, 1.0000406901041667, 1.000000001, 2.5000406901041665, 5.000040690104167, 9.9999, 9.9999999, 9.9999999, 0.04170735677083333, 0.04170735777083333, 0.04170735577083333, 0.0833740234375, 0.0833740244375, 0.0833740224375, 1.0000406901041667, 1.000000001, 1.0000406891041667, 4.416707356770833, 4.416666667666666, 4.416666665666666],
  },
  mp4_negative_ctts: {
    timing: {"period":0.041666666666666664,"quantum":0.00008138020833333333,"phase":-0.041666666666666664},
    results: [0, 0, 0.001, 0.1, 0.5000406901041666, 1.0000406901041667, 1.000000001, 2.5000406901041665, 5.000040690104167, 9.9999, 9.9999999, 9.9999999, 0.04170735677083333, 0.04170735777083333, 0.04170735577083333, 0.0833740234375, 0.0833740244375, 0.0833740224375, 1.0000406901041667, 1.000000001, 1.0000406891041667, 4.416707356770833, 4.416666667666666, 4.416666665666666],
  },
  mp4_shifted_ctts: {
    timing: {"period":0.041666666666666664,"quantum":0.00008138020833333333,"phase":0.08333333333333333},
    results: [0, 0, 0.001, 0.1, 0.5000406901041666, 1.0000406901041667, 1.000000001, 2.5000406901041665, 5.000040690104167, 9.9999, 9.9999999, 9.9999999, 0.04170735677083333, 0.04170735777083333, 0.04170735577083333, 0.0833740234375, 0.0833740244375, 0.0833740224375, 1.0000406901041667, 1.000000001, 1.0000406891041667, 4.416707356770833, 4.416666667666666, 4.416666665666666],
  },
};
const CFR_BUILDERS = {
  webm60: () => webm(1 / 60, 0.001),
  webm24: () => webm(1 / 24, 0.001),
  mp4_12288_24: () => mp4File({ traks: [videoTrak({ timescale: 12288, entries: [[48, 512]] })] }),
  mp4_30000_2398: () => mp4File({ traks: [videoTrak({ timescale: 30000, entries: [[240, 1001]] })] }),
  mp4_90000_30_moovLast: () => mp4File({ traks: [videoTrak({ timescale: 90000, entries: [[300, 3000]] })], moovFirst: false, mdatSize: 1024 }),
  mp4_600_30_large: () => mp4File({ traks: [videoTrak({ timescale: 600, entries: [[240, 20]] })], moovLarge: true }),
  mp4_edit_zero: () => mp4File({ traks: [videoTrak({ timescale: 24000, entries: [[240, 1000]], edit: elst([[288000, 0]]) })] }),
  mp4_edit_empty: () => mp4File({ traks: [videoTrak({ timescale: 24000, entries: [[240, 1000]], edit: elst([]) })] }),
  mp4_edit_two_zero: () => mp4File({ traks: [videoTrak({ timescale: 24000, entries: [[240, 1000]], edit: elst([[12000, 0], [12000, 0]]) })] }),
  mp4_bframe: () => mp4File({ traks: [videoTrak({ timescale: 12288, entries: [[48, 512]], edit: elst([[2000, 1024]]), composition: ctts([[48, 1024]]) })] }),
  mp4_bframe_reorder: () => mp4File({ traks: [videoTrak({ timescale: 12288, entries: [[4, 512]], edit: elst([[2000, 1024]]), composition: ctts([[2, 1024], [2, 0]]) })] }),
  mp4_negative_ctts: () => mp4File({ traks: [videoTrak({ timescale: 12288, entries: [[4, 512]], edit: null, composition: ctts([[1, -512], [3, 0]], 1) })] }),
  mp4_shifted_ctts: () => mp4File({ traks: [videoTrak({ timescale: 12288, entries: [[48, 512]], edit: null, composition: ctts([[48, 1024]]) })] }),
};

test("every CFR and WebM fixture keeps its timing object and target results", () => {
  for (const [name, expected] of Object.entries(CFR_FIXTURES)) {
    const timing = readTiming(CFR_BUILDERS[name]());
    assert.deepEqual(timing, expected.timing, `${name} timing`);
    const results = requestsFor(timing).map(time => target(time, 10, timing));
    assert.deepEqual(results, expected.results, `${name} target results`);
  }
});

test("a 200,000-sample table parses in under 50 ms", t => {
  const count = 200000, timescale = 15360;
  const entries = Buffer.alloc(8 + count * 8);
  entries.writeUInt32BE(count, 4);
  for (let i = 0; i < count; i++) {
    entries.writeUInt32BE(1, 8 + i * 8);
    entries.writeUInt32BE(512 + (i % 2), 12 + i * 8);
  }
  const file = mp4File({ traks: [videoTrak({ timescale, sttsBox: mp4box("stts", entries) })] });
  // Other test files run in parallel, so report the fastest of three parses of
  // the same buffer and keep the threshold on the parse itself.
  const samples = [];
  let timing = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const started = process.hrtime.bigint();
    timing = readTiming(file);
    samples.push(Number(process.hrtime.bigint() - started) / 1e6);
  }
  const fastest = Math.min(...samples);
  t.diagnostic(`200,000-sample table parsed in ${fastest.toFixed(1)} ms (runs: ${samples.map(value => value.toFixed(1)).join(", ")} ms)`);
  assert.ok(timing && timing.pts, "the table is built");
  assert.equal(timing.pts.length, count);
  assert.ok(fastest < 50, `parsed in ${fastest.toFixed(1)} ms`);
});
