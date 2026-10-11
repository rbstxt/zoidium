"use strict";

// Atomic file writes for build outputs: write to a temporary sibling file and
// rename it over the destination, so a crash or power loss never leaves a
// half-written bundle, manifest, or registry behind. The temporary file lives
// in the same directory so the rename stays on one filesystem (atomic).

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

function temporarySibling(filePath) {
  return `${filePath}.tmp-${process.pid}-${Date.now()}-${crypto.randomBytes(6).toString("hex")}`;
}

function writeFileAtomic(filePath, content, options) {
  const resolved = path.resolve(filePath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  const temporary = temporarySibling(resolved);
  try {
    fs.writeFileSync(temporary, content, options);
    fs.renameSync(temporary, resolved);
  } finally {
    try {
      fs.rmSync(temporary, { force: true });
    } catch (_error) {
      // The rename already consumed the temporary file.
    }
  }
}

function writeFileIfChangedAtomic(filePath, content, options) {
  const resolved = path.resolve(filePath);
  let current = null;
  try {
    current = fs.readFileSync(resolved);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const next = typeof content === "string" ? Buffer.from(content, (options && options.encoding) || "utf8") : Buffer.from(content);
  if (current !== null && current.equals(next)) return false;
  writeFileAtomic(resolved, content, options);
  return true;
}

module.exports = { writeFileAtomic, writeFileIfChangedAtomic };
