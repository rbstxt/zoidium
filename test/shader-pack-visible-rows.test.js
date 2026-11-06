"use strict";

// A visible row in a shader-pack preset binds to the uniform with its name.
// A row with no uniform, or with a uniform the code never reads, does nothing.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file.split("?")[0]), "utf8");
const code = source => source.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
const SEPARATOR = /^[-= ]/;

for (const pack of ["ccfx", "afterclip"]) {
  test(pack + " effect rows all reach shader code", () => {
    const manifest = JSON.parse(read("plugins/" + pack + "/manifest.json"));
    const dead = [];
    for (const effect of manifest.effects) {
      const shader = code(read(effect.shader));
      for (const row of JSON.parse(read(effect.preset)).customProperties || []) {
        const name = row.properties?.name;
        if (!name || SEPARATOR.test(name)) continue;
        const word = name.replace(/\W/g, "\\$&");
        const uses = shader.match(new RegExp("(?<!\\w)" + word + "(?!\\w)", "g"))?.length || 0;
        const declared = new RegExp("uniform[^;]*(?<!\\w)" + word + "(?!\\w)").test(shader);
        if (!declared || uses < 2) dead.push(effect.id + ": " + name);
      }
    }
    assert.deepEqual(dead, []);
  });
}
