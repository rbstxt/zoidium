"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { projectRoot } = require("./runtime-resources");

// Only the static output crosses the runtime staging boundary.
async function buildDocs(destinationRoot) {
  const siteRoot = path.join(projectRoot, "site");
  const cli = path.join(siteRoot, "node_modules", "astro", "bin", "astro.mjs");
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, "build"], { cwd: siteRoot, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code, signal) => code === 0 ? resolve() :
      reject(new Error(`Documentation build exited with ${signal || code}`)));
  });
  await fs.cp(path.join(siteRoot, "dist"), path.join(destinationRoot, "docs"), { recursive: true });
}

module.exports = { buildDocs };
