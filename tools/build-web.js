#!/usr/bin/env node

"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { prepareRuntimeStage, projectRoot, replaceDirectoryAtomically } = require("./runtime-resources");

async function main() {
  const outputRoot = path.join(projectRoot, "dist", "web");
  // Stage into a temporary sibling directory first so the previous dist/web
  // keeps serving until the new stage is complete; then swap atomically. A
  // failed build leaves the previous deployment untouched.
  const stagingRoot = path.join(
    projectRoot,
    "dist",
    `.web-stage-${process.pid}-${Date.now()}-${crypto.randomBytes(6).toString("hex")}`
  );
  await fs.promises.mkdir(path.dirname(stagingRoot), { recursive: true });
  try {
    const runtime = await prepareRuntimeStage({ destinationRoot: stagingRoot });
    console.log(`[Zoidium] static deployment staged in ${stagingRoot}`);
    console.log(`[Zoidium] staged ${runtime.resources.length} CM3 resources from the local cache.`);
    await replaceDirectoryAtomically(stagingRoot, outputRoot);
    console.log(`[Zoidium] static deployment published to ${outputRoot}`);
  } finally {
    await fs.promises.rm(stagingRoot, { force: true, recursive: true }).catch(() => {});
  }
}

main().catch((error) => {
  console.error(`[Zoidium] ${error.stack || error.message || error}`);
  process.exitCode = 1;
});
