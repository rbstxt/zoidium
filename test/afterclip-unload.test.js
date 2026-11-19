"use strict";
const test = require("node:test");
const { checkPack } = require("./helpers/shader-pack-lifecycle.js");
test("AfterClip presets release host shader pass resources", async () => checkPack("afterclip"));
