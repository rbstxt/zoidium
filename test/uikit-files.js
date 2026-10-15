"use strict";

// Ordered overlay script paths for the UI kit and the node editor, derived
// from zoidium/runtime-config.js postInitScripts so tests load every split
// part in the same order the browser uses. Tests that use this helper keep
// working while ui-kit.js and ui-node-editor.js are split into smaller files.

const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");

function postInitScripts() {
  const source = fs.readFileSync(path.join(projectRoot, "zoidium", "runtime-config.js"), "utf8");
  const match = source.match(/postInitScripts:\s*\[([\s\S]*?)\]/);
  if (!match) throw new Error("postInitScripts not found in zoidium/runtime-config.js");
  return Array.from(match[1].matchAll(/"(\.[^"]+)"/g)).map((found) => found[1].replace(/^\.\//, ""));
}

// ui-panels.js, every ui-node-editor part and every ui-kit part, in load order.
function kitScripts() {
  return postInitScripts().filter((name) => /^zoidium\/ui-(panels|kit|node-editor)/.test(name));
}

// Every ui-node-editor part, in load order (no ui-kit parts).
function nodeEditorScripts() {
  return postInitScripts().filter((name) => /^zoidium\/ui-node-editor/.test(name));
}

function readScript(relative) {
  return fs.readFileSync(path.join(projectRoot, relative), "utf8");
}

module.exports = { postInitScripts, kitScripts, nodeEditorScripts, readScript };
