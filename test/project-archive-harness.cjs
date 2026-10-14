"use strict";
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");

function installArchive(window, options = {}) {
  Object.assign(window, {
    crypto: webcrypto, CompressionStream, DecompressionStream,
    setTimeout: options.setTimeout || function (callback, ms) { const timer = setTimeout(callback, ms); if (ms === 60000) timer.unref(); return timer; }, clearTimeout,
  });
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../plugins/core/project-archive.js"), "utf8"), {
    window, ArrayBuffer, Blob, Uint8Array, TextEncoder, TextDecoder,
  });
  return window.PZ.zoidiumProjectArchive;
}
module.exports = { installArchive };
