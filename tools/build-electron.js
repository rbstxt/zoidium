#!/usr/bin/env node

"use strict";

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { prepareRuntimeStage, projectRoot } = require("./runtime-resources");

function run(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${path.basename(command)} exited with ${signal || code}`));
    });
  });
}

async function main() {
  const stageRoot = await fs.promises.mkdtemp(path.join(require("os").tmpdir(), "zoidium-build-"));
  try {
    const runtime = await prepareRuntimeStage({
      destinationRoot: stageRoot,
      includeElectronFiles: true,
    });
    const packagePath = path.join(stageRoot, "package.json");
    const packageJson = JSON.parse(await fs.promises.readFile(packagePath, "utf8"));
    packageJson.build = packageJson.build || {};
    packageJson.build.directories = {
      ...(packageJson.build.directories || {}),
      output: path.join(projectRoot, "dist"),
    };
    await fs.promises.writeFile(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`, "utf8");

    const nodeModules = path.join(stageRoot, "node_modules");
    const sourceNodeModules = path.join(projectRoot, "node_modules");
    if (fs.existsSync(sourceNodeModules)) {
      await fs.promises.symlink(sourceNodeModules, nodeModules, process.platform === "win32" ? "junction" : "dir");
    }

    console.log(`[Zoidium] Electron build staged ${runtime.resources.length} CM3 resources.`);
    await run(path.join(projectRoot, "node_modules", ".bin", "electron-builder"), [
      "--projectDir",
      stageRoot,
      "--publish",
      "never",
    ], projectRoot);
  } finally {
    await fs.promises.rm(stageRoot, { force: true, recursive: true });
  }
}

main().catch((error) => {
  console.error(`[Zoidium] ${error.stack || error.message || error}`);
  process.exitCode = 1;
});
