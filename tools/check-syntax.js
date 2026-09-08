#!/usr/bin/env node

"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const projectRoot = path.resolve(__dirname, "..");
const sourceRoots = [
  "main.js",
  "preload.js",
  "zoidium-welcome-tour.js",
  "tools",
  "zoidium",
  "plugins",
];

function collectJavaScriptFiles(relativePath) {
  const absolutePath = path.join(projectRoot, relativePath);
  if (!fs.existsSync(absolutePath)) return [];
  const stat = fs.statSync(absolutePath);
  if (stat.isFile()) return absolutePath.endsWith(".js") ? [absolutePath] : [];

  return fs
    .readdirSync(absolutePath, { withFileTypes: true })
    .flatMap((entry) => {
      const child = path.join(relativePath, entry.name);
      return entry.isDirectory() ? collectJavaScriptFiles(child) : child.endsWith(".js") ? [path.join(projectRoot, child)] : [];
    });
}

const files = [...new Set(sourceRoots.flatMap(collectJavaScriptFiles))].sort();
for (const filePath of files) {
  const result = spawnSync(process.execPath, ["--check", filePath], {
    cwd: projectRoot,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

console.log(`[Zoidium] checked JavaScript syntax in ${files.length} files.`);
