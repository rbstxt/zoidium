#!/usr/bin/env node

"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const {
  ensureResourceCache,
  prepareRuntimeStage,
  projectRoot,
} = require("./runtime-resources");

const { buildDocs } = require("./build-docs");

function run(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: "inherit", shell: false });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) return resolve();
      reject(new Error(`${path.basename(command)} exited with ${signal || code}`));
    });
  });
}

async function main() {
  // A configured snapshot (release CI, where Panzoid's pages can sit behind a
  // browser check) is restored instead of fetching upstream; otherwise the
  // build always fetches a fresh CM3 graph.
  const snapshot = process.env.ZOIDIUM_CM3_SNAPSHOT;
  console.log(snapshot
    ? "[Zoidium] preparing the CM3 runtime from the configured snapshot before the Electron build..."
    : "[Zoidium] fetching the CM3 resource graph before the Electron build...");
  const cache = await ensureResourceCache({ force: !snapshot });
  const stageRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "zoidium-electron-build-"));

  try {
    const runtime = await prepareRuntimeStage({
      cacheRoot: cache.root,
      destinationRoot: stageRoot,
      includeDesktopFiles: true,
      offline: true,
    });
    await buildDocs(stageRoot);
    const packagePath = path.join(stageRoot, "package.json");
    const packageJson = JSON.parse(await fs.promises.readFile(packagePath, "utf8"));
    packageJson.main = "desktop/main.cjs";
    packageJson.build = {
      ...(packageJson.build || {}),
      directories: {
        ...(packageJson.build?.directories || {}),
        output: path.join(projectRoot, "dist"),
      },
    };
    await fs.promises.writeFile(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`, "utf8");

    const sourceNodeModules = path.join(projectRoot, "node_modules");
    const stagedNodeModules = path.join(stageRoot, "node_modules");
    if (!fs.existsSync(sourceNodeModules)) {
      throw new Error("node_modules is missing. Run pnpm install --frozen-lockfile first.");
    }
    await fs.promises.symlink(
      sourceNodeModules,
      stagedNodeModules,
      process.platform === "win32" ? "junction" : "dir"
    );

    const builderScript = require.resolve("electron-builder/cli.js");
    console.log(`[Zoidium] staged ${runtime.resources.length} CM3 resources.`);
    await run(
      process.execPath,
      [builderScript, "--projectDir", stageRoot, "--publish", "never"],
      projectRoot
    );
  } finally {
    await fs.promises.rm(stageRoot, { force: true, recursive: true });
  }
}

main().catch((error) => {
  console.error(`[Zoidium] Electron build failed: ${error.stack || error.message || error}`);
  process.exitCode = 1;
});
