#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const S = require("../zoidium/community-safe-json");
const P = require("../zoidium/community-package");
const I = require("../zoidium/community-interpreter");

function pack(sourceRoot, outputFolder, occupied = []) {
  const root = fs.realpathSync(sourceRoot);
  function read(relative) {
    S.path(relative);
    const target = fs.realpathSync(path.join(root, relative));
    if (!target.startsWith(root + path.sep)) throw new Error("Community source escapes source root");
    const stat = fs.statSync(target);
    if (!stat.isFile() || stat.size > P.LIMITS.packageBytes) throw new Error("Community source size limit exceeded");
    return new TextDecoder("utf-8", { fatal: true }).decode(fs.readFileSync(target));
  }
  const manifest = S.parse(read("manifest.json"));
  P.manifest(manifest, occupied);
  const assets = Object.create(null);
  let total = 0;
  for (const name of manifest.assets) {
    assets[name] = read(name); total += Buffer.byteLength(assets[name]);
    if (total > P.LIMITS.packageBytes) throw new Error("Community package size limit exceeded");
  }
  I.source(assets[manifest.entry]);
  const bundle = P.bundle({ schemaVersion: 1, manifest, assets }, occupied);
  const bytes = Buffer.from(JSON.stringify(bundle) + "\n");
  if (bytes.length > P.LIMITS.packageBytes) throw new Error("Community package size limit exceeded");
  // Output is separate from the checkout's shipped packages and registry.
  const destination = path.resolve(outputFolder);
  const project = path.resolve(__dirname, "..");
  if (destination === project || destination.startsWith(path.join(project, "plugins") + path.sep) || destination === path.join(project, "plugins")) {
    throw new Error("Community output must not target the shipped registry or plugins directory");
  }
  fs.mkdirSync(destination, { recursive: true });
  const output = path.join(destination, manifest.id + ".json");
  fs.writeFileSync(output, bytes, { flag: "wx" });
  return { output, bytes: bytes.length, hash: "sha256-" + createHash("sha256").update(bytes).digest("base64") };
}
function main(args) {
  if (args.length !== 2) throw new Error("Usage: node tools/pack-community-plugin.js <source-folder> <output-folder>");
  const registry = S.parse(fs.readFileSync(path.join(__dirname, "../plugins/registry.json"), "utf8"));
  const occupied = registry.plugins.map(p => p.id);
  console.log(JSON.stringify(pack(args[0], args[1], occupied)));
}
if (require.main === module) {
  try { main(process.argv.slice(2)); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { pack };
