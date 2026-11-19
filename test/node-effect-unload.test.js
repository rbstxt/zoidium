"use strict";
const test = require("node:test");
const { checkPack } = require("./helpers/shader-pack-lifecycle.js");
test("Node Effect default preset releases host shader pass resources", async () => checkPack("node-effect"));
