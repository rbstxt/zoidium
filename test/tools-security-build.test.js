"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const runtime = require("../tools/runtime-resources");

test("atomic writes replace outputs without leaving temporary files", () => {
  const fs = require("node:fs");
  const os = require("node:os");
  const { writeFileAtomic, writeFileIfChangedAtomic } = require("../tools/atomic-write");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "zoidium-atomic-"));
  try {
    const target = path.join(root, "bundle.json");
    assert.equal(writeFileIfChangedAtomic(target, "v1"), true);
    assert.equal(writeFileIfChangedAtomic(target, "v1"), false);
    assert.equal(writeFileIfChangedAtomic(target, "v2"), true);
    assert.equal(fs.readFileSync(target, "utf8"), "v2");
    writeFileAtomic(target, Buffer.from("v3"));
    assert.equal(fs.readFileSync(target, "utf8"), "v3");
    assert.deepEqual(fs.readdirSync(root).filter((name) => name.includes(".tmp-")), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});


test("plugin bundle writes go through the atomic helper", () => {
  const fs = require("node:fs");
  const source = fs.readFileSync(path.join(__dirname, "..", "tools", "build-plugin-bundles.js"), "utf8");
  assert.ok(source.includes('require("./atomic-write")'));
  assert.ok(source.includes("writeFileIfChangedAtomic"));
  assert.ok(source.includes("writeFileAtomic(registryPath"));
});


test("deployment build stages to a temporary directory before swapping", () => {
  const fs = require("node:fs");
  const source = fs.readFileSync(path.join(__dirname, "..", "tools", "build-web.js"), "utf8");
  assert.ok(source.includes("replaceDirectoryAtomically"));
  assert.ok(!source.includes("rm(outputRoot"), "the previous dist/web must survive until the swap");
});


test("directory swaps fail closed and leave the previous output intact", async () => {
  const fs = require("node:fs");
  const os = require("node:os");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "zoidium-swap-"));
  try {
    const destination = path.join(root, "web");
    fs.mkdirSync(destination);
    fs.writeFileSync(path.join(destination, "index.html"), "previous");
    await assert.rejects(runtime.replaceDirectoryAtomically(path.join(root, "missing"), destination));
    assert.equal(fs.readFileSync(path.join(destination, "index.html"), "utf8"), "previous");
    const staged = path.join(root, "staged");
    fs.mkdirSync(staged);
    fs.writeFileSync(path.join(staged, "index.html"), "next");
    await runtime.replaceDirectoryAtomically(staged, destination);
    assert.equal(fs.readFileSync(path.join(destination, "index.html"), "utf8"), "next");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
