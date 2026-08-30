#!/usr/bin/env node

"use strict";

const fs = require("fs");
const path = require("path");
const { prepareRuntimeStage, projectRoot } = require("./runtime-resources");

async function main() {
  const outputRoot = path.join(projectRoot, "dist", "web");
  await fs.promises.rm(outputRoot, { force: true, recursive: true });
  const runtime = await prepareRuntimeStage({ destinationRoot: outputRoot });
  console.log(`[Zoidium] static deployment staged in ${runtime.root}`);
  console.log(`[Zoidium] staged ${runtime.resources.length} CM3 resources from the local cache.`);
}

main().catch((error) => {
  console.error(`[Zoidium] ${error.stack || error.message || error}`);
  process.exitCode = 1;
});
