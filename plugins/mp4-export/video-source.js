"use strict";

const { createConverter } = require("./yuv-convert.js");

// The canvas holds sRGB-encoded pixels, so the transfer stays sRGB (13) and
// only the levels and the matrix follow BT.709. Both the MP4 `colr` box and
// the SPS VUI must say exactly this, or players disagree about the range.
const LIMITED_BT709 = Object.freeze({
  primaries: "bt709",
  transfer: "iec61966-2-1",
  matrix: "bt709",
  fullRange: false,
});

function encoderConfig(bunny, options) {
  return {
    codec: "avc",
    fullCodecString: options.codec,
    quality: new bunny.Quality({ bitrate: options.bitrate }),
    latencyMode: "quality",
    keyFrameInterval: 2,
  };
}

function createCanvasSource(scope, bunny, options) {
  let canvas = options.canvas;
  let padding = null;
  if (canvas.width !== options.width || canvas.height !== options.height) {
    const padded = scope.document.createElement("canvas");
    padded.width = options.width;
    padded.height = options.height;
    padding = padded.getContext("2d");
    canvas = padded;
  }
  const source = new bunny.CanvasSource(canvas, encoderConfig(bunny, options));
  return {
    source,
    async add(timestamp, duration, frameCanvas) {
      if (padding) {
        padding.fillStyle = "black";
        padding.fillRect(0, 0, canvas.width, canvas.height);
        padding.drawImage(frameCanvas, 0, 0);
      }
      options.beforeSubmit();
      await source.add(timestamp, duration);
    },
    async flush() {},
    dispose() {},
  };
}

function createSampleSource(bunny, options, converter) {
  const config = encoderConfig(bunny, options);
  // mediabunny calls this just before it muxes the packet, so the decoder
  // config the muxer stores carries the rewritten avcC and colour space.
  config.onEncodedPacket = options.onEncodedPacket;
  const source = new bunny.VideoSampleSource(config);
  async function submitFrame(frame, timestamp, duration, checkBeforeSubmit) {
    const sample = new bunny.VideoSample(frame.data, {
      format: "I420",
      codedWidth: options.width,
      codedHeight: options.height,
      layout: frame.layout,
      timestamp,
      duration,
      colorSpace: { ...LIMITED_BT709 },
    });
    try {
      // VideoSampleSource.add does not close the sample, and the encoder has
      // copied the pixels once this resolves.
      if (checkBeforeSubmit) options.beforeSubmit();
      await source.add(sample);
    } finally {
      sample.close();
    }
  }
  if (converter.supportsPbo) {
    return {
      source,
      async add(timestamp, duration, frameCanvas) {
        options.beforeSubmit();
        converter.enqueue(frameCanvas, { timestamp, duration });
        if (converter.pendingCount > 1) {
          const frame = await converter.drainOne();
          if (frame) await submitFrame(frame, frame.meta.timestamp, frame.meta.duration, false);
        }
      },
      async flush() {
        while (converter.pendingCount > 0) {
          const frame = await converter.drainOne();
          if (frame) await submitFrame(frame, frame.meta.timestamp, frame.meta.duration, false);
        }
      },
      dispose() {
        converter.dispose();
      },
    };
  }
  return {
    source,
    async add(timestamp, duration, frameCanvas) {
      const frame = converter.convert(frameCanvas);
      await submitFrame(frame, timestamp, duration, true);
    },
    async flush() {},
    dispose() {
      converter.dispose();
    },
  };
}

// Builds the frame source for one export. The GPU converter writes limited
// range I420 itself; when WebGL2 or the converter is unavailable, the canvas
// source keeps the export working with whatever the browser encoder does.
function createVideoSource(scope, bunny, options) {
  let converter = null;
  let setupError = null;
  try {
    converter = createConverter(scope, options.width, options.height);
  } catch (error) {
    setupError = error;
  }
  if (converter && typeof bunny.VideoSampleSource !== "function") {
    converter.dispose();
    converter = null;
    setupError = new Error("The bundled MP4 writer has no VideoSampleSource.");
  }
  if (converter && typeof bunny.VideoSample !== "function") {
    converter.dispose();
    converter = null;
    setupError = new Error("The bundled MP4 writer has no VideoSample.");
  }
  if (converter) return createSampleSource(bunny, options, converter);
  // A headless test harness has no drawing surface at all; only report the
  // fallback where an export could actually have painted.
  if (typeof scope.document !== "undefined" || typeof scope.OffscreenCanvas === "function") {
    console.warn("[Zoidium] MP4 export cannot convert pixels on the GPU" +
      (setupError && setupError.message ? " (" + setupError.message + ")" : "") +
      "; the browser encoder range applies to this export.");
  }
  return createCanvasSource(scope, bunny, options);
}

module.exports = { LIMITED_BT709, createVideoSource };
