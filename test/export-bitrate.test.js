"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  BITRATE_SCALES,
  bitrateLabels,
  formatBitrate,
  installEncode,
  installOptionsPage,
  nativeVideoBitrate,
  normalizeBitrateScale,
} = require("../plugins/core/export-bitrate");
const {
  createIoSerializer,
  estimateVideoStorageBytes,
} = require("../plugins/core/io-serialization");

// Mirrors the part of CM3's encode that reads the quality profile: the
// profile lookup happens synchronously when encode is called.
function createAv() {
  const calls = [];
  const av = {
    profiles: [
      { bitrate: 1, crf: 12, speed: 8, abr: 1 },
      { bitrate: 1, crf: 4, speed: 0, abr: 1.5 },
    ],
    encode(_job, params) {
      let rate = (params.width / 640) * (params.height / 360);
      rate *= params.rate > 30 ? 1.5 : 1;
      rate *= 1e6;
      const profile = av.profiles[params.quality];
      calls.push({ videoBitrate: rate * profile.bitrate, profile });
      return Promise.resolve("blob");
    },
  };
  return { av, calls };
}

const params720 = (extra) =>
  Object.assign({ width: 1280, height: 720, rate: 30, quality: 1, length: 90 }, extra);

test("only the four offered multipliers are accepted", () => {
  assert.deepEqual(BITRATE_SCALES, [1, 2, 4, 8]);
  assert.equal(normalizeBitrateScale(4), 4);
  assert.equal(normalizeBitrateScale("8"), 8);
  for (const value of [undefined, null, 0, 3, -2, "x", 16]) {
    assert.equal(normalizeBitrateScale(value), 1);
  }
});

test("the multiplier scales the encoder target for that call only", () => {
  const { av, calls } = createAv();
  const PZ = { av };
  assert.equal(installEncode(PZ), true);
  av.encode({}, params720({ bitrateScale: 4 }));
  av.encode({}, params720());
  assert.equal(calls[0].videoBitrate, 16e6);
  assert.equal(calls[1].videoBitrate, 4e6);
  assert.equal(av.profiles[1].bitrate, 1);
});

test("1x passes the native profile object through unchanged", () => {
  const { av, calls } = createAv();
  const native = av.profiles[1];
  installEncode({ av });
  av.encode({}, params720({ bitrateScale: 1 }));
  assert.equal(calls[0].profile, native);
  assert.equal(calls[0].videoBitrate, 4e6);
});

test("the profile is restored when the native encode throws", () => {
  const { av } = createAv();
  const native = av.profiles[1];
  av.encode = () => {
    throw new Error("encoder failed");
  };
  installEncode({ av });
  assert.throws(() => av.encode({}, params720({ bitrateScale: 8 })), /encoder failed/);
  assert.equal(av.profiles[1], native);
});

test("installing twice wraps once", () => {
  const { av } = createAv();
  installEncode({ av });
  const first = av.encode;
  installEncode({ av });
  assert.equal(av.encode, first);
});

test("an already serialized encode is rebuilt around the scaled encode", async () => {
  const { av, calls } = createAv();
  const serializer = createIoSerializer({ ensureQuota: () => Promise.resolve() });
  // The serializer checks the Matroska magic of the encode result.
  const nativeEncode = av.encode;
  av.encode = function () {
    nativeEncode.apply(this, arguments);
    return Promise.resolve(new Blob([new Uint8Array([0x1a, 0x45, 0xdf, 0xa3])]));
  };
  av.encode = serializer.wrapEncode(av.encode, av.profiles);
  const PZ = { av, zoidiumIoSerialization: { _serializer: serializer } };
  assert.equal(installEncode(PZ), true);
  await av.encode({}, params720({ bitrateScale: 2 }));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].videoBitrate, 8e6);
  assert.equal(av.profiles[1].bitrate, 1);
});

test("the storage estimate follows the bitrate multiplier", () => {
  const profiles = createAv().av.profiles;
  const long = params720({ length: 30 * 600 });
  const base = estimateVideoStorageBytes(long, profiles);
  const scaled = estimateVideoStorageBytes(Object.assign({}, long, { bitrateScale: 4 }), profiles);
  assert.ok(scaled > base * 3, `4x estimate ${scaled} vs ${base}`);
  assert.equal(estimateVideoStorageBytes(Object.assign({}, long, { bitrateScale: 1 }), profiles), base);
});

const nativeProfiles = Array.from({ length: 5 }, () => ({ bitrate: 1 }));

test("the native target follows the CM3 device-render bitrate formula", () => {
  const target = (width, height, rate, quality = 2, profiles = nativeProfiles) =>
    nativeVideoBitrate({ width, height, rate, quality }, profiles);
  assert.equal(target(640, 360, 30), 1e6);
  assert.equal(target(1280, 720, 30), 4e6);
  assert.equal(target(1920, 1080, 30), 9e6);
  assert.equal(target(1920, 1080, 60), 13.5e6);
  assert.equal(target(3840, 2160, 30), 36e6);
  assert.equal(target(3840, 2160, 60), 54e6);
  // The quality profile's bitrate is part of the target, as in the native formula.
  const custom = nativeProfiles.map((profile, index) => Object.assign({}, profile, { bitrate: index + 1 }));
  assert.equal(target(1920, 1080, 30, 4, custom), 45e6);
  // Missing parameters fall back to the 640x360 at 30 fps native base.
  assert.equal(nativeVideoBitrate({}, nativeProfiles), 1e6);
});

test("the bitrate labels state the target each multiplier produces", () => {
  assert.deepEqual(
    bitrateLabels({ width: 1920, height: 1080, rate: 30, quality: 2 }, nativeProfiles),
    ["1x (default): 9 Mbps target", "2x: 18 Mbps target",
      "4x: 36 Mbps target", "8x: 72 Mbps target"],
  );
  assert.deepEqual(
    bitrateLabels({ width: 1920, height: 1080, rate: 60, quality: 2 }, nativeProfiles),
    ["1x (default): 13.5 Mbps target", "2x: 27 Mbps target",
      "4x: 54 Mbps target", "8x: 108 Mbps target"],
  );
  assert.equal(
    bitrateLabels({ width: 3840, height: 2160, rate: 60, quality: 2 }, nativeProfiles)[3],
    "8x: 432 Mbps target",
  );
  assert.equal(formatBitrate(443750), "443.8 kbps");
  assert.equal(formatBitrate(1e9), "1 Gbps");
  assert.equal(formatBitrate(0), "unknown");
});

function fakeDropdown(spec, owner) {
  const options = spec.items.split(";").map((text) => ({ text }));
  const select = {
    options,
    selectedIndex: 0,
    title: "",
    onchange() { spec.set.call(owner, select.selectedIndex); },
  };
  const row = {
    select,
    pz_update() { select.selectedIndex = spec.get.call(owner); },
    querySelector() { return select; },
  };
  row.pz_update();
  return row;
}

function fakeExportPage() {
  const listeners = [];
  return {
    children: [],
    appendChild(child) { this.children.push(child); return child; },
    addEventListener(type, listener) { if (type === "change") listeners.push(listener); },
    fireChange() { for (const listener of listeners) listener({ type: "change" }); },
    querySelectorAll() { return []; },
    parentElement: null,
  };
}

test("the Bitrate row shows the target and follows resolution and frame rate", () => {
  const page = fakeExportPage();
  function Device() {
    this.params = { width: 1920, height: 1080, rate: 30, quality: 2, format: "mkv_vp8_opus" };
  }
  Device.prototype.createOptionsPage = function createOptionsPage() {
    this.page = page;
    return page;
  };
  const PZ = {
    av: { profiles: nativeProfiles },
    ui: {
      controls: { legacy: { generateDropdown: fakeDropdown } },
      export: { device: Device },
    },
  };
  assert.equal(installOptionsPage(PZ), true);
  const device = new Device();
  assert.equal(device.createOptionsPage(), page);
  assert.equal(device.params.bitrateScale, 1);
  const row = page.children[0];
  const labels = () => row.select.options.map((option) => option.text);
  assert.deepEqual(labels(), [
    "1x (default): 9 Mbps target", "2x: 18 Mbps target",
    "4x: 36 Mbps target", "8x: 72 Mbps target",
  ]);
  assert.match(row.select.title, /Target video bitrate/);
  row.select.selectedIndex = 3;
  row.select.onchange();
  assert.equal(device.params.bitrateScale, 8);
  device.params.width = 3840;
  device.params.height = 2160;
  page.fireChange();
  assert.equal(labels()[0], "1x (default): 36 Mbps target");
  assert.equal(labels()[1], "2x: 72 Mbps target");
  device.params.rate = 60;
  page.fireChange();
  assert.equal(labels()[1], "2x: 108 Mbps target");
  assert.equal(row.select.selectedIndex, 3, "relabelling keeps the selection");
  assert.equal(device.params.bitrateScale, 8, "relabelling does not change the choice");
});
