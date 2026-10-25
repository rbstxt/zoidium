"use strict";

// Effects must resolve their GLSL through the bundle asset API only. A missing
// bundled shader throws a clear error; no effect falls back to the network.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const projectRoot = path.resolve(__dirname, "..");

const NATIVE_FX_EFFECTS = [
  { file: "timedisplacement.js", asset: "fx_timedisplacement.glsl" },
  { file: "ccwidetime.js", asset: "fx_ccwidetime.glsl" },
  { file: "timedifference.js", asset: "fx_timedifference.glsl" },
];

const LAYER_INPUT_EFFECTS = [
  { file: "layer-input-effect.js", asset: "layer-input.glsl", dir: "layer-input" },
  { file: "layer-input-displacement-effect.js", asset: "layer-input-displacement.glsl", dir: "layer-input" },
];

const PZ = {
  asset: { type: { IMAGE: 1 } },
  property: { type: { NUMBER: 0, OPTION: 10, LIST: 20, ASSET: 30, VECTOR2: 5, COLOR: 6, TEXT: 7 } },
  layerInput: {},
};

function loadNativeFxEffect(filename) {
  let definition = null;
  const apis = { defineFrameSampler(spec) { definition = spec; } };
  const source = fs.readFileSync(path.join(projectRoot, "plugins/native-fx/effects", filename), "utf8");
  const effect = {};
  new Function("PZ", "ZoidiumPluginApis", "THREE", source).call(effect, PZ, apis, {});
  return { definition, effect };
}

function loadLayerInputEffect(filename) {
  const source = fs.readFileSync(path.join(projectRoot, "plugins/layer-input", filename), "utf8");
  const effect = { properties: { addAll() {} } };
  new Function("PZ", "THREE", source).call(effect, PZ, {});
  return effect;
}

function assertDeclaresShader(pluginId, assetBasename) {
  const manifest = JSON.parse(fs.readFileSync(
    path.join(projectRoot, "plugins", pluginId, "manifest.json"),
    "utf8",
  ));
  const sources = (manifest.resources || []).filter((resource) => resource.type === "text").map((resource) => resource.source);
  assert.ok(
    sources.some((source) => String(source).split(/[?#]/, 1)[0].endsWith(`/${assetBasename}`)),
    `${pluginId} declares ${assetBasename} in its manifest resources`,
  );
}

function assertNoNetworkFetch(relativePath) {
  const source = fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
  assert.ok(
    !/(^|[^A-Za-z0-9_$])fetch\s*\(/.test(source),
    `${relativePath} makes no network fetch() calls`,
  );
}

for (const { file, asset } of NATIVE_FX_EFFECTS) {
  test(`${file} requires its bundled shader and names it when missing`, async () => {
    assertDeclaresShader("native-fx", asset);
    assertNoNetworkFetch(`plugins/native-fx/effects/${file}`);
    const { definition, effect } = loadNativeFxEffect(file);
    await assert.rejects(
      definition.lifecycle.load.call({ ...effect, _zoidiumGetAsset: undefined }, {}),
      new RegExp(`Missing bundled asset: ${asset.replace(".", "\\.")}`),
    );
    await assert.rejects(
      definition.lifecycle.load.call({ ...effect, _zoidiumGetAsset: () => undefined }, {}),
      new RegExp(`Missing bundled asset: ${asset.replace(".", "\\.")}`),
    );
  });
}

for (const { file, asset, dir } of LAYER_INPUT_EFFECTS) {
  test(`${file} requires its bundled shader and names it when missing`, async () => {
    assertDeclaresShader(dir, asset);
    assertNoNetworkFetch(`plugins/${dir}/${file}`);
    const effect = loadLayerInputEffect(file);
    await assert.rejects(
      effect.load.call({ _zoidiumGetAsset: undefined }, {}),
      new RegExp(`Missing bundled asset: ${asset.replace(".", "\\.")}`),
    );
    await assert.rejects(
      effect.load.call({ _zoidiumGetAsset: () => { throw new Error("not bundled"); } }, {}),
      new RegExp(`Missing bundled asset: ${asset.replace(".", "\\.")}`),
    );
  });
}
