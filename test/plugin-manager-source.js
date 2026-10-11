"use strict";
const fs = require("node:fs");
const path = require("node:path");
function managerSource() {
  return fs.readFileSync(path.join(__dirname, "../plugins/plugin-manager.js"), "utf8");
}
module.exports = { managerSource };
