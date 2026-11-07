"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { releaseLock } = require("../tools/browser-lock");

function lockOwnedBy(owner) {
  const lock = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "browser-lock-")), "lock");
  fs.mkdirSync(lock);
  fs.writeFileSync(path.join(lock, "owner"), owner);
  return lock;
}

test("releases a lock this process owns", () => {
  const lock = lockOwnedBy(process.pid + " test\n");
  assert.equal(releaseLock(lock), true);
  assert.equal(fs.existsSync(lock), false);
});

test("keeps a lock another process took", () => {
  const lock = lockOwnedBy((process.pid + 1) + " test\n");
  assert.equal(releaseLock(lock), false);
  assert.equal(fs.existsSync(lock), true);
});

test("does not match a pid that only shares a prefix", () => {
  const lock = lockOwnedBy(process.pid + "0 test\n");
  assert.equal(releaseLock(lock), false);
  assert.equal(fs.existsSync(lock), true);
});

test("ignores a lock that is already gone", () => {
  assert.equal(releaseLock(path.join(os.tmpdir(), "browser-lock-missing-" + process.pid)), false);
});
