#!/usr/bin/env node
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const esbuild = require("esbuild");
const root = path.resolve(__dirname, "..");
async function build() {
  const wasm = fs.readFileSync(require.resolve("@jitl/quickjs-wasmfile-release-sync/wasm"));
  const result = await esbuild.build({
    entryPoints: [path.join(__dirname, "community-interpreter-entry.mjs")], bundle: true,
    write: false, format: "iife", globalName: "ZoidiumQuickJS", platform: "browser", target: "es2022",
    minify: true, sourcemap: false, legalComments: "none",
    footer: { js: 'if(typeof module==="object"&&module.exports)module.exports=ZoidiumQuickJS;' },
    plugins: [{ name: "embedded-wasm", setup(build) {
      build.onResolve({ filter: /^community-wasm$/ }, () => ({ path: "wasm", namespace: "embedded" }));
      build.onLoad({ filter: /.*/, namespace: "embedded" }, () => ({ contents: JSON.stringify(wasm.toString("base64")), loader: "json" }));
    } }],
  });
  const bytes = result.outputFiles[0].contents;
  const hash = b => crypto.createHash("sha256").update(b).digest("hex");
  const destination = path.join(root, "zoidium/vendor/quickjs");
  fs.mkdirSync(destination, { recursive: true });
  const metadata = JSON.stringify({ version: "0.32.0", variant: "release-sync", wasmMemoryInitialBytes: 16 * 1024 * 1024, wasmMemoryMaximumBytes: 64 * 1024 * 1024, wasmBytes: wasm.length, wasmSha256: hash(wasm), bundleBytes: bytes.length, bundleSha256: hash(bytes) }, null, 2) + "\n";
  for (const [name, data] of [["quickjs.js", bytes], ["build.json", metadata]]) {
    const output = path.join(destination, name);
    if (process.argv.includes("--check")) {
      if (!fs.existsSync(output) || !Buffer.from(fs.readFileSync(output)).equals(Buffer.from(data))) throw new Error("Stale interpreter bundle: " + name);
    } else fs.writeFileSync(output, data);
  }
  console.log(metadata.trim());
}
build().catch(error => { console.error(error); process.exitCode = 1; });
