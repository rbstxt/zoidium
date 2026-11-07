"use strict";

// These controls have limits that the reference pages must state. Each test
// pins the code that sets the limit together with the English and Japanese text.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const row = (page, label) => page.split("\n").find(line => line.startsWith("| **" + label + "**")) || "";
const docs = name => [read("site/src/content/docs/reference/" + name), read("site/src/content/docs/ja/reference/" + name)];

test("Aperture docs state where the Camera+ blur reaches its maximum", () => {
  assert.match(read("plugins/camera-plus/scene-dof.js"), /min\( aperture \* 0\.02 \* minSide, minSide \* 0\.05 \)/);
  for (const page of docs("camera-plus.md")) assert.match(row(page, "Aperture"), /2\.5/);
});
