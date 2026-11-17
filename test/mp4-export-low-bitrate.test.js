"use strict";

// The MP4 target sees every byte the encoder writes, so the finished export
// can compare its average video rate with the rate the settings requested.
// Peak-constrained VBR treats that request as a mean target, and a driver may
// land far below it without reporting anything, so the result is logged once.

const assert = require("node:assert/strict");
const test = require("node:test");

const { createStorage } = require("../plugins/mp4-export/stream-target.js");

const UNDERTARGET =
  "[Zoidium] The encoder produced 800 kbps of the 8 Mbps requested for this MP4 " +
  "export. A slow speed preset or simple frames can stay below the target.";

function fakeBunny() {
  return {
    StreamTarget: class {
      constructor(stream) {
        this.stream = stream;
      }
    },
  };
}

function captureWarnings() {
  const warnings = [];
  const original = console.warn;
  console.warn = (...args) => {
    warnings.push(args.join(" "));
  };
  return {
    warnings,
    restore() {
      console.warn = original;
    },
  };
}

async function finishWith(bytes, options) {
  const scope = { navigator: {} };
  const storage = await createStorage(scope, fakeBunny(), Object.assign({ delays: [0] }, options));
  const writer = storage.target.stream.getWriter();
  await writer.write({ position: 0, data: new Uint8Array(bytes) });
  await writer.close();
  return storage.finish();
}

test("a finished export far below the requested bitrate is reported once", async () => {
  const { warnings, restore } = captureWarnings();
  let blob;
  try {
    blob = await finishWith(1000000, {
      videoBitrate: 8e6,
      duration: 10,
      hasAudio: false,
    });
  } finally {
    restore();
  }
  assert.equal(blob.size, 1000000);
  assert.deepEqual(warnings, [UNDERTARGET]);
});

test("an export near the requested bitrate stays quiet", async () => {
  const { warnings, restore } = captureWarnings();
  try {
    await finishWith(6000000, {
      videoBitrate: 8e6,
      duration: 10,
      hasAudio: false,
    });
  } finally {
    restore();
  }
  assert.deepEqual(warnings, []);
});

test("an export with an audio track is not measured from the muxed size", async () => {
  const { warnings, restore } = captureWarnings();
  try {
    await finishWith(1000, {
      videoBitrate: 8e6,
      duration: 10,
      hasAudio: true,
    });
  } finally {
    restore();
  }
  assert.deepEqual(warnings, [], "the video rate cannot be separated from audio");
});

test("an export without a target or duration has nothing to compare", async () => {
  const { warnings, restore } = captureWarnings();
  try {
    await finishWith(1000, {});
  } finally {
    restore();
  }
  assert.deepEqual(warnings, []);
});
