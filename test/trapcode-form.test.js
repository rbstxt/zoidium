"use strict";

// Coverage for Form: the frame output does not depend on frame history, the
// base lattice rebuilds when its inputs change, the point cap holds, no
// Math.random reaches the render path, and asset-backed bases settle through
// prepare() before a frame is final.

const assert = require("node:assert/strict");
const test = require("node:test");
const { loadSuite } = require("./trapcode-env");

function makeForm() {
  const { PZ } = loadSuite(["trapcode-common.js", "form.js"]);
  const form = new PZ.object3d.form();
  form.load(null);
  return { PZ, form, instance: form.forms[0] };
}

function configure(instance) {
  instance.properties.disperse.disperse.set(20);
  instance.properties.disperse.twist.set(30);
  instance.properties.fractal.displace.set(40);
  instance.properties.fractal.randomSeed.set(3);
}

function positions(instance) {
  return Array.from(instance.points.geometry.attributes.position.array);
}

test("frame output does not depend on the frames rendered before it", () => {
  const direct = makeForm();
  configure(direct.instance);
  direct.instance.update(10);
  const expected = positions(direct.instance);

  const history = makeForm();
  configure(history.instance);
  for (const frame of [0, 5, 30, 2, 10]) history.instance.update(frame);
  assert.deepEqual(positions(history.instance), expected);
});

test("changing the base size rebuilds the lattice instead of reusing stale points", () => {
  const { instance } = makeForm();
  instance.update(0);
  let maxAbs = 0;
  for (const v of positions(instance)) maxAbs = Math.max(maxAbs, Math.abs(v));
  assert.ok(Math.abs(maxAbs - 250) < 1e-3, "default 500 size spans +/-250");

  instance.properties.base.baseFormSize.set([200, 200, 200]);
  instance.update(0);
  maxAbs = 0;
  for (const v of positions(instance)) maxAbs = Math.max(maxAbs, Math.abs(v));
  assert.ok(Math.abs(maxAbs - 100) < 1e-3, "rebuilt lattice spans +/-100, got " + maxAbs);
});

test("the particle grid is capped and reuses the geometry while the count holds", () => {
  const { instance } = makeForm();
  const base = instance.properties.base;
  base.particlesX.set(300);
  base.particlesY.set(300);
  base.particlesZ.set(300);
  const counts = instance.gridCounts();
  assert.ok(counts[0] * counts[1] * counts[2] <= 200000, "point cap");

  base.particlesX.set(70);
  base.particlesY.set(70);
  base.particlesZ.set(3);
  instance.update(0);
  const geometry = instance.points.geometry;
  instance.update(1);
  assert.equal(instance.points.geometry, geometry, "geometry kept between frames");
});

test("no Math.random reaches the render path", () => {
  const { instance } = makeForm();
  configure(instance);
  const original = Math.random;
  Math.random = function () {
    throw new Error("Math.random used in render");
  };
  try {
    instance.update(7);
    instance.update(8);
  } finally {
    Math.random = original;
  }
});

test("an asset-backed base settles through prepare() before the frame is final", async () => {
  const first = makeForm();
  first.instance.properties.base.baseFormType.set(6);
  first.instance.properties.base.modelAsset.set("sha-model-1");
  first.instance.update(0);
  await first.instance.prepare(0);
  const settled = positions(first.instance);

  const second = makeForm();
  second.instance.properties.base.baseFormType.set(6);
  second.instance.properties.base.modelAsset.set("sha-model-1");
  await second.instance.prepare(0);
  second.instance.update(0);
  assert.deepEqual(positions(second.instance), settled);
  for (const v of settled) assert.ok(Number.isFinite(v), "finite positions");
});

function sineBuffer(seconds = 4, rate = 48000) {
  const length = Math.round(rate * seconds);
  const channel = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    channel[i] = 0.5 * Math.sin((2 * Math.PI * 220 * i) / rate);
  }
  return { sampleRate: rate, length, numberOfChannels: 1, getChannelData: () => channel };
}

test("shading, string and audio groups exist with donor defaults and stay neutral", () => {
  const { instance } = makeForm();
  const shading = instance.properties.shading;
  assert.equal(shading.shading.get(0), 0);
  assert.equal(shading.nominalDistance.get(0), 250);
  assert.equal(shading.ambient.get(0), 20);
  assert.equal(shading.diffuse.get(0), 80);
  assert.equal(shading.specularAmount.get(0), 0);
  assert.equal(shading.specularSharpness.get(0), 100);
  assert.equal(shading.reflectionStrength.get(0), 100);
  assert.equal(shading.shadowlet.get(0), 0);
  const base = instance.properties.base;
  assert.equal(base.stringSize.get(0), 0);
  assert.equal(base.stringDensity.get(0), 15);
  assert.equal(base.stringSizeRandom.get(0), 0);
  assert.equal(base.stringPosition.get(0), 0);
  const audio = instance.properties.audio;
  assert.equal(audio.audioLayer.get(0), null);
  for (let i = 1; i <= 5; i++) assert.equal(audio["reactor" + i].get(0), 0);

  configure(instance);
  instance.update(10);
  const plain = positions(instance);

  // Shading on changes nothing: the point shader stays unlit, as in the donor.
  shading.shading.set(1);
  shading.lightFalloff.set(2);
  shading.nominalDistance.set(400);
  shading.ambient.set(60);
  shading.diffuse.set(40);
  shading.specularAmount.set(80);
  shading.shadowlet.set(1);
  instance.update(10);
  assert.deepEqual(positions(instance), plain);

  // An audio layer with every reactor off is neutral too.
  audio.audioLayer.set("clip.wav");
  instance.update(10);
  assert.deepEqual(positions(instance), plain);
  assert.equal(instance.audioLevel(10), 0);
});

test("donor-shaped JSON with shading, audio and string properties loads", () => {
  const { PZ } = loadSuite(["trapcode-common.js", "form.js"]);
  const form = new PZ.object3d.form();
  form.load({
    properties: {},
    forms: [{
      properties: {
        base: { stringEnabled: 1, stringSize: 2, stringDensity: 30, stringSizeRandom: 1, stringPosition: 5 },
        shading: { shading: 1, lightFalloff: 1, nominalDistance: 300, ambient: 30, diffuse: 90,
          specularAmount: 50, specularSharpness: 80, reflectionStrength: 60, shadowlet: 1 },
        audio: { audioLayer: "clip.wav", reactor1: 1, reactor2: 0, reactor3: 1, reactor4: 0, reactor5: 1 },
      },
    }],
  });
  const instance = form.forms[0];
  assert.equal(instance.properties.base.stringDensity.get(0), 30);
  assert.equal(instance.properties.shading.nominalDistance.get(0), 300);
  assert.equal(instance.properties.shading.shadowlet.get(0), 1);
  assert.equal(instance.properties.audio.audioLayer.get(0), "clip.wav");
  assert.equal(instance.properties.audio.reactor1.get(0), 1);
  assert.equal(instance.properties.audio.reactor5.get(0), 1);
  instance.update(0);
  assert.ok(Number.isFinite(positions(instance)[0]));
});

function setupAudioForm() {
  const made = makeForm();
  made.PZ.trapcode.audioAnalysis.register("clip.wav", sineBuffer());
  const audio = made.instance.properties.audio;
  audio.audioLayer.set("clip.wav");
  made.instance.properties.disperse.disperse.set(20);
  made.instance.properties.fractal.displace.set(40);
  return made;
}

test("audio reactors modulate the frame from offline analysis, never live", () => {
  const { PZ, instance } = setupAudioForm();
  assert.ok(PZ.trapcode.audioAnalysis.has("clip.wav"));
  assert.equal(instance.audioLevel(1), 0, "no reactor on, neutral");

  instance.properties.audio.reactor1.set(1);
  instance.properties.audio.reactor3.set(1);
  assert.ok(instance.audioLevel(1) > 0, "sine clip reads above silence, got " + instance.audioLevel(1));

  instance.update(1);
  const modulatedSize = instance.material.uniforms.size.value;
  const modulatedPos = positions(instance);
  instance.properties.audio.reactor1.set(0);
  instance.properties.audio.reactor3.set(0);
  instance.update(1);
  assert.ok(instance.material.uniforms.size.value < modulatedSize, "reactor 1 scales size");
  assert.notDeepEqual(positions(instance), modulatedPos, "reactor 3 scales disperse");

  // A live analyser would throw here; the offline path never touches CM playback.
  let reads = 0;
  globalThis.CM = { playback: { get audioDst() { reads++; throw new Error("live analyser read"); } } };
  try {
    instance.update(1);
  } finally {
    delete globalThis.CM;
  }
  assert.equal(reads, 0, "no analyser access");
});

test("audio reactors are deterministic under shuffled frame order", () => {
  const direct = setupAudioForm();
  const audio = direct.instance.properties.audio;
  audio.reactor1.set(1);
  audio.reactor2.set(1);
  audio.reactor3.set(1);
  audio.reactor4.set(1);
  audio.reactor5.set(1);
  direct.instance.update(1);
  const expectedPos = positions(direct.instance);
  const expectedSize = direct.instance.material.uniforms.size.value;
  const expectedOpacity = direct.instance.material.uniforms.opacity.value;

  const history = setupAudioForm();
  history.instance.properties.audio.reactor1.set(1);
  history.instance.properties.audio.reactor2.set(1);
  history.instance.properties.audio.reactor3.set(1);
  history.instance.properties.audio.reactor4.set(1);
  history.instance.properties.audio.reactor5.set(1);
  for (const frame of [0, 1, 0, 0, 1, 1, 0, 1]) history.instance.update(frame);
  assert.deepEqual(positions(history.instance), expectedPos);
  assert.equal(history.instance.material.uniforms.size.value, expectedSize);
  assert.equal(history.instance.material.uniforms.opacity.value, expectedOpacity);
});

function makeStringsForm() {
  const { instance } = makeForm();
  const base = instance.properties.base;
  base.particlesX.set(6);
  base.particlesY.set(6);
  base.particlesZ.set(2);
  base.stringEnabled.set(1);
  return instance;
}

function stringIndex(instance) {
  return Array.from(instance.strings.geometry.index || []);
}

function stringColors(instance) {
  return Array.from(instance.strings.geometry.attributes.color.array);
}

test("string defaults rebuild the same web under shuffled frame order", () => {
  const direct = makeStringsForm();
  direct.update(7);
  const expectedIndex = stringIndex(direct);
  const expectedColors = stringColors(direct);
  assert.ok(expectedIndex.length > 0, "default strings connect");

  const shuffled = makeStringsForm();
  for (const frame of [3, 9, 1, 7]) shuffled.update(frame);
  assert.deepEqual(stringIndex(shuffled), expectedIndex);
  assert.deepEqual(stringColors(shuffled), expectedColors);
});

test("string density scales the web, size random only recolors", () => {
  const instance = makeStringsForm();
  instance.update(0);
  const legacy = stringIndex(instance);
  const legacyColors = stringColors(instance);

  instance.properties.base.stringDensity.set(0);
  instance.update(0);
  assert.equal(stringIndex(instance).length, 0, "density 0 connects nothing");

  instance.properties.base.stringDensity.set(30);
  instance.update(0);
  assert.ok(stringIndex(instance).length >= legacy.length, "density 30 connects at least as much");

  instance.properties.base.stringDensity.set(15);
  instance.properties.base.stringPosition.set(4);
  instance.update(0);
  assert.notDeepEqual(stringIndex(instance), legacy, "position distribution rehashes the web");

  instance.properties.base.stringPosition.set(0);
  instance.properties.base.stringSizeRandom.set(5);
  instance.update(0);
  assert.deepEqual(stringIndex(instance), legacy, "size random keeps the topology");
  assert.notDeepEqual(stringColors(instance), legacyColors, "size random recolors the strings");
});

test("string size raises line opacity without touching the topology", () => {
  const instance = makeStringsForm();
  instance.properties.particle.opacity.set(50);
  instance.update(0);
  const legacy = stringIndex(instance);
  const baseOpacity = instance.stringMaterial.opacity;
  assert.ok(Math.abs(baseOpacity - 0.5) < 1e-9);
  instance.properties.base.stringSize.set(4);
  instance.update(0);
  assert.deepEqual(stringIndex(instance), legacy);
  assert.ok(instance.stringMaterial.opacity > baseOpacity, "size boosts string opacity");
});

test("form shading defaults to off and toggles the shader define", () => {
  const instance = makeStringsForm();
  instance.update(0);
  assert.ok(!instance.material.defines.USE_SHADING, "shading off leaves the legacy path");
  instance.properties.shading.shading.set(1);
  instance.update(0);
  assert.equal(instance.material.defines.USE_SHADING, 1);
  assert.ok(instance.material.uniforms.uShadeLightCount, "light uniforms are present");
  // Same frame renders identically after a reshuffle.
  const first = positions(instance);
  for (const frame of [5, 0, 3]) instance.update(frame);
  instance.update(0);
  assert.deepEqual(positions(instance), first);
});
