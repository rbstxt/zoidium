#!/usr/bin/env node

"use strict";

// Keeps every hand-written source file at or below MAX_LINES so files stay
// reviewable. Generated payloads (plugin bundles, the Afterzoid shader pack)
// are not source and are skipped.

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const MAX_LINES = 1000;
const projectRoot = path.resolve(__dirname, "..");
const SOURCE_PATTERN = /\.(?:c?js|mjs|css)$/;
const GENERATED = [/^plugins\/alipfx\//, /(^|\/)bundle\.json$/, /^node_modules\//, /^dist\//];

// Files that are still being split. Remove an entry in the same change that
// brings the file under the limit; the check fails on stale entries.
const PENDING_SPLIT = new Set([
  "zoidium/ui-kit.js",
  "zoidium/ui-node-editor.js",
]);

function sourceFiles() {
  const output = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], {
    cwd: projectRoot,
    encoding: "utf8",
  });
  return output.split("\n").filter((file) =>
    file && SOURCE_PATTERN.test(file) && !GENERATED.some((pattern) => pattern.test(file)) &&
    fs.existsSync(path.join(projectRoot, file)));
}

function lineCount(file) {
  const text = fs.readFileSync(path.join(projectRoot, file), "utf8");
  if (!text) return 0;
  return text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
}

const problems = [];
for (const file of sourceFiles()) {
  const lines = lineCount(file);
  if (lines > MAX_LINES && !PENDING_SPLIT.has(file)) {
    problems.push(`${file}: ${lines} lines (limit ${MAX_LINES}); split it into smaller files`);
  } else if (lines <= MAX_LINES && PENDING_SPLIT.has(file)) {
    problems.push(`${file}: ${lines} lines; remove it from PENDING_SPLIT in tools/check-file-length.js`);
  }
}
for (const file of PENDING_SPLIT) {
  if (!fs.existsSync(path.join(projectRoot, file))) {
    problems.push(`${file}: listed in PENDING_SPLIT but no longer exists; remove the entry`);
  }
}

if (problems.length) {
  for (const problem of problems) console.error(`[Zoidium] ${problem}`);
  process.exit(1);
}
console.log(`[Zoidium] all source files are within ${MAX_LINES} lines (${PENDING_SPLIT.size} pending split).`);
