"use strict";
// Synthetic media only. Regenerate with: node tools/generate-export-color-fixture.js
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const width = 32, height = 24, rate = 4, count = 16;
const colors = [[224, 32, 32], [32, 224, 32], [32, 32, 224], [224, 224, 32]];
function pixel(frame, x, y) {
  return x >= frame && x < frame + 4 && y >= 8 && y < 12 ? [240, 240, 240] : colors[frame % colors.length];
}
function generate(destination = path.join(__dirname, "../test/fixtures/moving-colors.mp4")) {
  const bytes = Buffer.alloc(width * height * 3 * count);
  for (let f = 0; f < count; f++) for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    bytes.set(pixel(f, x, y), ((f * height + y) * width + x) * 3);
  }
  const result = spawnSync("ffmpeg", ["-v", "error", "-y", "-f", "rawvideo", "-pixel_format", "rgb24",
    "-video_size", `${width}x${height}`, "-framerate", String(rate), "-i", "pipe:0", "-an", "-c:v", "libx264",
    "-profile:v", "high", "-pix_fmt", "yuv420p", "-crf", "1", "-g", "1", "-threads", "1", "-movflags", "+faststart", destination], { input: bytes });
  if (result.status !== 0) throw new Error(result.stderr?.toString() || "ffmpeg failed");
}
if (require.main === module) generate();
module.exports = { width, height, rate, count, pixel, generate };
