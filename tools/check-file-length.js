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
  "plugins/easing-plus/easing-plus.js",
  "plugins/geometry-plus/geometry-plus.js",
  "plugins/graph-plus/graph-plus.js",
  "plugins/layer-input/layer-input.js",
  "plugins/material-plus/graph-runtime.js",
  "plugins/material-plus/surface-runtime.js",
  "plugins/openzoid-legacy/effects/tracery.js",
  "plugins/openzoid-legacy/effects/vhs.js",
  "plugins/optical-flares/optflares-window.js",
  "plugins/optical-flares/optflares.js",
  "plugins/core/temporal-render.js",
  "plugins/plugin-manager.js",
  "plugins/precomp-plus/comps.js",
  "plugins/scene-plus/scene-plus.js",
  "plugins/text-plus/text-plus.js",
  "plugins/trapcode-suite/form.js",
  "plugins/trapcode-suite/particular.js",
  "plugins/trapcode-suite/plexus.js",
  "plugins/trapcode-suite/trapcode-common.js",
  "test/text-plus.test.js",
  "zoidium/debug-log.js",
  "zoidium/project-restore.js",
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
