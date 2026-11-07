"use strict";

const fs = require("fs");
const path = require("path");

// Another process may have replaced the lock since this one took it, so remove
// it only while its owner file still names this process.
function releaseLock(lock, pid = process.pid) {
  let owner;
  try { owner = fs.readFileSync(path.join(lock, "owner"), "utf8"); }
  catch (error) { if (error.code === "ENOENT") return false; throw error; }
  if (!owner.startsWith(pid + " ")) return false;
  fs.rmSync(lock, { recursive: true });
  return true;
}

module.exports = { releaseLock };
