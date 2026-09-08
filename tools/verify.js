#!/usr/bin/env node

"use strict";

const path = require("path");
const { spawn } = require("child_process");

const projectRoot = path.resolve(__dirname, "..");
const checks = [
  ["plugin manifest schema", ["tools/validate-plugin-manifests.js"]],
  ["plugin bundle freshness", ["tools/build-plugin-bundles.js", "--check"]],
  ["JavaScript syntax", ["tools/check-syntax.js"]],
  ["tests", ["--test"]],
];

function run(label, args) {
  console.log(`\n[verify] ${label}`);
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: projectRoot,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${label} failed with ${signal || code}`));
    });
  });
}

async function main() {
  for (const [label, args] of checks) await run(label, args);
  console.log("\n[verify] all checks passed.");
}

main().catch((error) => {
  console.error(`[Zoidium] ${error.message}`);
  process.exitCode = 1;
});
