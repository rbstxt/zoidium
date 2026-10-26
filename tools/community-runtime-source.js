"use strict";
const fs = require("node:fs");
const path = require("node:path");
const FILES = ["vendor/quickjs/quickjs.js", "community-safe-json.js", "community-package.js", "community-protocol.js", "community-interpreter.js", "community-worker.js"];
function runtimeSource() {
  return FILES.map(file => fs.readFileSync(path.join(__dirname, "../zoidium", file), "utf8")).join("\n;\n");
}
module.exports = { runtimeSource, FILES };
