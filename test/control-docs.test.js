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

test("Stretch docs state its dependency on Orient to motion", () => {
  assert.match(read("plugins/trapcode-suite/particular.js"), /float wBlend = orient \* wFade;[\s\S]{0,40}1\.0 \+ stretch \* min\(wSpd \* 0\.9, 3\.0\) \* wBlend/);
  for (const page of docs("trapcode-particular.md")) assert.match(row(page, "Stretch along motion"), /\*\*Orient to motion\*\*/);
});

test("Optical Flares docs state which textures use Falloff and Illumination", () => {
  const shader = read("plugins/optical-flares/optflares-shaders.js");
  const start = shader.indexOf("vec3 lensTexture(");
  const body = shader.slice(start, shader.indexOf("void main()", start));
  const modes = body.split("if (mode == ").slice(1);
  assert.deepEqual(modes.filter(mode => mode.includes("falloff")).map(mode => mode[0]), ["3"]);
  assert.equal(modes.find(mode => mode[0] === "6").includes("ill"), false);
  for (const page of docs("optical-flares.md")) assert.match(page, /\*\*Falloff\*\*[^\n]*\*\*Ring\*\*[^\n]*\*\*Illumination\*\*[^\n]*\*\*Orbs\*\*/);
});

test("Optical Flares docs state which element types use Animate", () => {
  const shader = read("plugins/optical-flares/optflares-shaders.js");
  const start = shader.indexOf('if (etype == 0)');
  const blocks = shader.slice(start, shader.indexOf('c *= (etype == 0)', start)).split("if (etype == ").slice(1);
  assert.deepEqual(blocks.filter(block => /\banimate\b/.test(block)).map(block => parseInt(block, 10)), [7, 9]);
  for (const page of docs("optical-flares.md")) assert.match(page, /\*\*Animate\*\*[^\n]*\*\*Sparkle\*\*[^\n]*\*\*Hoop\*\*/);
});
