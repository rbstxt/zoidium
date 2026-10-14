"use strict";

// Algorithm adapted from EffectCraft (MIT OR Apache-2.0).
//
// Card Wipe: the layer flips away as a grid of cards rotating in place.
// The fragment shader inverse-maps each card (rotation + simple
// perspective), so completion 0% passes the layer through exactly and 100%
// shows only the card backs. Per-card randomness (axis/direction coins,
// timing jitter) is derived deterministically from (seed, card index) on
// the CPU and uploaded as a small float data texture; the shader itself
// needs no integer math. Only the uniforms, properties and per-frame
// updates below are unique to this effect; pass plumbing comes from
// ZoidiumPluginApis.defineFilter.

var cardWipeEffect = this;

var cardWipeMath = (function loadCardWipeMath() {
  var getAsset = cardWipeEffect && cardWipeEffect._zoidiumGetAsset;
  var apis = typeof ZoidiumPluginApis !== "undefined" ? ZoidiumPluginApis : null;
  var createRequire = apis && apis.modules && apis.modules.createRequire;
  if (typeof getAsset !== "function" || typeof createRequire !== "function") {
    throw new Error("Card Wipe needs its bundle math (this._zoidiumGetAsset and ZoidiumPluginApis.modules.createRequire).");
  }
  var loader = createRequire(getAsset, { root: "./plugins/native-fx/", scope: {} });
  return loader("./effects/fxtrans-math.js");
})();

var cardWipeRand = {
  texture: null,
  signature: "",
  size: 0,
};

function cardWipeNumber(value, fallback) {
  var number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function cardWipeGrid(value, fallback) {
  var grid = Math.round(cardWipeNumber(value, fallback));
  if (!Number.isFinite(grid)) grid = fallback;
  return Math.min(64, Math.max(1, grid));
}

function cardWipeRefreshTexture(effect, cols, rows, randomSeed) {
  var seed = cardWipeMath.foldSeed(randomSeed);
  var signature = cols + "x" + rows + ":" + (seed | 0);
  if (cardWipeRand.texture && cardWipeRand.signature === signature) return;
  var data = new Float32Array(cols * rows * 4);
  for (var j = 0; j < rows; j++) {
    for (var i = 0; i < cols; i++) {
      var cell = j * cols + i;
      var rnd = cardWipeMath.cardRandoms(cell, j, seed);
      var o = (j * cols + i) * 4;
      data[o] = rnd.axis;
      data[o + 1] = rnd.dir;
      data[o + 2] = rnd.jit;
      data[o + 3] = 1;
    }
  }
  var texture = null;
  try {
    texture = new THREE.DataTexture(data, cols, rows, THREE.RGBAFormat, THREE.FloatType);
  } catch (_error) {
    return;
  }
  if (cardWipeRand.texture) cardWipeRand.texture.dispose();
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  cardWipeRand.texture = texture;
  cardWipeRand.signature = signature;
  cardWipeRand.size = cols;
  if (effect && effect.pass && effect.pass.material && effect.pass.material.uniforms.tRand) {
    effect.pass.material.uniforms.tRand.value = texture;
  }
}

ZoidiumPluginApis.defineFilter.call(this, {
  displayName: "Card Wipe",
  fragShaderUrl: "/plugins/native-fx/shaders/fx_cardwipe.glsl",
  uniforms: {
    uvScale: { type: "v2", value: new THREE.Vector2(1, 1) },
    resolution: { type: "v2", value: new THREE.Vector2(1, 1) },
    tRand: { type: "t", value: null },
    rows: { type: "f", value: 8 },
    columns: { type: "f", value: 8 },
    cardScale: { type: "f", value: 1 },
    flipAxis: { type: "f", value: 0 },
    flipDirection: { type: "f", value: 0 },
    flipOrder: { type: "f", value: 0 },
    timingRandomness: { type: "f", value: 0 },
    completion: { type: "f", value: 0 },
    transitionWidth: { type: "f", value: 0.5 },
    backMode: { type: "f", value: 1 },
    backColor: { type: "v3", value: new THREE.Vector3(0, 0, 0) },
    cameraDist: { type: "f", value: 2 },
    lightIntensity: { type: "f", value: 1 },
    ambient: { type: "f", value: 0.25 },
  },
  properties: {
    enabled: {
      dynamic: true,
      name: "Enabled",
      type: PZ.property.type.OPTION,
      value: 1,
      items: "off;on",
    },
    completion: {
      dynamic: true,
      name: "Transition Completion",
      type: PZ.property.type.NUMBER,
      value: 0,
      max: 100,
      min: 0,
      step: 1,
      decimals: 0,
    },
    transitionWidth: {
      dynamic: true,
      name: "Transition Width",
      type: PZ.property.type.NUMBER,
      value: 50,
      max: 100,
      min: 1,
      step: 1,
      decimals: 0,
    },
    rows: {
      dynamic: true,
      name: "Rows",
      type: PZ.property.type.NUMBER,
      value: 8,
      max: 64,
      min: 1,
      step: 1,
      decimals: 0,
    },
    columns: {
      dynamic: true,
      name: "Columns",
      type: PZ.property.type.NUMBER,
      value: 8,
      max: 64,
      min: 1,
      step: 1,
      decimals: 0,
    },
    cardScale: {
      dynamic: true,
      name: "Card Scale",
      type: PZ.property.type.NUMBER,
      value: 1,
      max: 10,
      min: 0.01,
      step: 0.05,
      decimals: 2,
    },
    flipAxis: {
      dynamic: true,
      name: "Flip Axis",
      type: PZ.property.type.OPTION,
      value: 0,
      items: "X;Y;Random",
    },
    flipDirection: {
      dynamic: true,
      name: "Flip Direction",
      type: PZ.property.type.OPTION,
      value: 0,
      items: "Positive;Negative;Random",
    },
    flipOrder: {
      dynamic: true,
      name: "Flip Order",
      type: PZ.property.type.OPTION,
      value: 0,
      items: "Left to Right;Right to Left;Top to Bottom;Bottom to Top;Top Left to Bottom Right;Top Right to Bottom Left;Bottom Left to Top Right;Bottom Right to Top Left;Gradient",
    },
    timingRandomness: {
      dynamic: true,
      name: "Timing Randomness",
      type: PZ.property.type.NUMBER,
      value: 0,
      max: 1,
      min: 0,
      step: 0.01,
      decimals: 2,
    },
    randomSeed: {
      dynamic: true,
      name: "Random Seed",
      type: PZ.property.type.NUMBER,
      value: 1,
      max: 10000,
      min: 0,
      step: 1,
      decimals: 0,
    },
    backLayer: {
      dynamic: true,
      name: "Back Layer",
      type: PZ.property.type.OPTION,
      value: 1,
      items: "Color;Transparent",
    },
    backColor: {
      dynamic: true,
      name: "Back Color",
      type: PZ.property.type.COLOR,
      value: [0, 0, 0],
    },
    cameraDistance: {
      dynamic: true,
      name: "Camera Distance",
      type: PZ.property.type.NUMBER,
      value: 2,
      max: 20,
      min: 1,
      step: 0.1,
      decimals: 2,
    },
    lightIntensity: {
      dynamic: true,
      name: "Light Intensity",
      type: PZ.property.type.NUMBER,
      value: 1,
      max: 4,
      min: 0,
      step: 0.05,
      decimals: 2,
    },
    ambientLight: {
      dynamic: true,
      name: "Ambient Light",
      type: PZ.property.type.NUMBER,
      value: 0.25,
      max: 2,
      min: 0,
      step: 0.05,
      decimals: 2,
    },
  },
  onLoad(effect) {
    cardWipeRefreshTexture(effect, 8, 8, 1);
  },
  onUnload() {
    if (cardWipeRand.texture) cardWipeRand.texture.dispose();
    cardWipeRand.texture = null;
    cardWipeRand.signature = "";
  },
  update(frame) {
    if (!this.pass) return;
    this.pass.enabled = this.properties.enabled.get(frame) === 1;
    var uniforms = this.pass.uniforms;
    var rows = cardWipeGrid(this.properties.rows.get(frame), 8);
    var columns = cardWipeGrid(this.properties.columns.get(frame), 8);
    var seed = cardWipeNumber(this.properties.randomSeed.get(frame), 1);
    cardWipeRefreshTexture(this, columns, rows, seed);
    uniforms.rows.value = rows;
    uniforms.columns.value = columns;
    uniforms.cardScale.value = Math.max(0.01, cardWipeNumber(this.properties.cardScale.get(frame), 1));
    uniforms.flipAxis.value = cardWipeNumber(this.properties.flipAxis.get(frame), 0);
    uniforms.flipDirection.value = cardWipeNumber(this.properties.flipDirection.get(frame), 0);
    uniforms.flipOrder.value = cardWipeNumber(this.properties.flipOrder.get(frame), 0);
    var jitter = cardWipeNumber(this.properties.timingRandomness.get(frame), 0);
    uniforms.timingRandomness.value = Math.min(1, Math.max(0, jitter));
    var completion = cardWipeNumber(this.properties.completion.get(frame), 0);
    uniforms.completion.value = Math.min(1, Math.max(0, completion / 100));
    var width = cardWipeNumber(this.properties.transitionWidth.get(frame), 50);
    uniforms.transitionWidth.value = Math.min(1, Math.max(0.01, width / 100));
    uniforms.backMode.value = cardWipeNumber(this.properties.backLayer.get(frame), 1);
    var back = this.properties.backColor.get(frame);
    uniforms.backColor.value.set(cardWipeNumber(back[0], 0), cardWipeNumber(back[1], 0), cardWipeNumber(back[2], 0));
    uniforms.cameraDist.value = Math.max(1, cardWipeNumber(this.properties.cameraDistance.get(frame), 2));
    uniforms.lightIntensity.value = Math.max(0, cardWipeNumber(this.properties.lightIntensity.get(frame), 1));
    uniforms.ambient.value = Math.max(0, cardWipeNumber(this.properties.ambientLight.get(frame), 0.25));
  },
});
