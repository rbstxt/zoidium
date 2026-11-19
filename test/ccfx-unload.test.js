"use strict";
const test = require("node:test");
const { checkPack } = require("./helpers/shader-pack-lifecycle.js");
test("CCFX presets release host shader pass resources", async () => checkPack("ccfx"));
