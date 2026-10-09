"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(
  path.join(__dirname, "..", "plugins", "core", "particle-defaults.js"),
  "utf8"
);

class StubProperty {
  constructor(definition) {
    this.definition = definition;
  }
}

class StubGroup extends StubProperty {}
class StubKeyframes extends StubProperty {}

function createParticleClass() {
  function Particle(parentProject) {
    this.parentProject = parentProject;
    this.properties = {
      number: new StubProperty({ value: 0 }),
      rate: new StubProperty({ value: 0 }),
      lifetime: new StubProperty({ value: 0 }),
      pspread: new StubProperty({ value: [1, 1, 1] }),
      vspread: new StubProperty({ value: [0, 0, 0] }),
      color: new StubProperty({ value: [{ position: 0, color: "rgba(255,255,255,1.0)" }] }),
      size: new StubProperty({ value: [{ position: 0, color: "rgba(255,255,255,1.0)" }] }),
      texture: new StubProperty({ value: null, baseUrl: "/assets/textures/particles/" }),
      time: new StubKeyframes({ value: 0, animated: false }),
    };
  }
  Particle.prototype.presetTextures = ["artsy", "circle_soft", "dots"];
  Particle.prototype.load = function (data) {
    this.loadedWith = data;
    return data;
  };
  return Particle;
}

function runPatch(particleClass) {
  const presetRequests = [];
  const context = {
    console,
    JSON,
    Math,
    PZ: {
      object3d: { particles: particleClass },
      property: { dynamic: { group: StubGroup, keyframes: StubKeyframes } },
      asset: { type: { IMAGE: "image" } },
    },
  };
  context.window = context;
  context.__presetRequests = presetRequests;
  vm.runInNewContext(source, context, { filename: "particle-defaults.js" });
  return context;
}

test("a new Particles object gets visible deterministic emitter defaults", () => {
  const ParticleClass = createParticleClass();
  runPatch(ParticleClass);
  const originalRandom = Math.random;
  Math.random = () => {
    throw new Error("particle defaults must not use Math.random");
  };
  let particle;
  try {
    particle = new ParticleClass({
      assets: {
        createFromPreset(type, url) {
          this.created = [type, url];
          return url;
        },
      },
    });
    particle.load();
  } finally {
    Math.random = originalRandom;
  }

  const data = particle.loadedWith.properties;
  assert.equal(data.number, 400);
  assert.equal(data.rate, 200);
  assert.equal(data.lifetime, 3);
  assert.ok(data.rate > 0 && data.lifetime > 0, "zero rate or lifetime would emit nothing");
  assert.deepEqual(data.pspread, [20, 20, 20]);
  assert.deepEqual(data.vspread, [100, 100, 100]);
  assert.equal(data.texture, "/assets/textures/particles/circle_soft.png");
  assert.deepEqual(particle.parentProject.assets.created, [
    "image",
    "/assets/textures/particles/circle_soft.png",
  ]);
  assert.equal(data.time.expression, "time");
  assert.equal(data.time.animated, true);
});

test("a new Particles object without a parent project keeps the texture unset", () => {
  const ParticleClass = createParticleClass();
  runPatch(ParticleClass);
  const particle = new ParticleClass(null);
  particle.load();
  assert.equal(particle.loadedWith.properties.texture, null);
  assert.equal(particle.loadedWith.properties.number, 400);
});

test("saved particle data is passed through untouched", () => {
  const ParticleClass = createParticleClass();
  runPatch(ParticleClass);
  const particle = new ParticleClass({ assets: { createFromPreset() { throw new Error("unexpected"); } } });
  const saved = { properties: { number: { value: 12 }, rate: 7 } };
  particle.load(saved);
  assert.equal(particle.loadedWith, saved);
});
