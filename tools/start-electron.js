#!/usr/bin/env node

"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { prepareRuntimeStage, projectRoot } = require("./runtime-resources");

async function main() {
  const stageRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "zoidium-electron-dev-"));
  let child = null;
  let stopping = false;
  const signalHandlers = new Map();

  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    const handler = () => {
      if (stopping) return;
      stopping = true;
      if (child && child.exitCode == null) child.kill(signal);
    };
    signalHandlers.set(signal, handler);
    process.on(signal, handler);
  }

  try {
    const runtime = await prepareRuntimeStage({
      destinationRoot: stageRoot,
      includeDesktopFiles: true,
    });
    const sourceNodeModules = path.join(projectRoot, "node_modules");
    if (!fs.existsSync(sourceNodeModules)) {
      throw new Error("node_modules is missing. Run pnpm install --frozen-lockfile first.");
    }
    await fs.promises.symlink(
      sourceNodeModules,
      path.join(stageRoot, "node_modules"),
      process.platform === "win32" ? "junction" : "dir"
    );

    if (stopping) {
      process.exitCode = 1;
      return;
    }

    const electronScript = require.resolve("electron/cli.js");
    console.log(`[Zoidium] staged ${runtime.resources.length} CM3 resources for desktop development.`);
    child = spawn(process.execPath, [electronScript, stageRoot], {
      cwd: projectRoot,
      stdio: "inherit",
    });
    const exitCode = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code, signal) => resolve(code == null ? 1 : code || (signal ? 1 : 0)));
    });
    process.exitCode = exitCode;
  } finally {
    for (const [signal, handler] of signalHandlers) process.off(signal, handler);
    if (child && child.exitCode == null) child.kill();
    await fs.promises.rm(stageRoot, { force: true, recursive: true });
  }
}

main().catch((error) => {
  console.error(`[Zoidium] Electron development start failed: ${error.stack || error.message || error}`);
  process.exitCode = 1;
});
