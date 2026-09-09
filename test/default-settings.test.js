"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.join(__dirname, "..");

function readPatch(name) {
  return fs.readFileSync(
    path.join(root, "plugins", "core", name),
    "utf8",
  );
}

test("new projects use a 60 FPS default", () => {
  function Editor() {}
  Editor.prototype.new = function () {
    this.createdRate = this.defaultProject.sequence.properties.rate;
  };

  const context = {
    PZ: {
      ui: { editor: Editor },
      sequence: { propertyDefinitions: { rate: { value: 30 } } },
    },
    CM: { defaultProject: { sequence: { properties: { rate: 30 } } } },
  };
  context.window = context;
  vm.runInNewContext(readPatch("default-project-settings.js"), context);

  const editor = new Editor();
  editor.defaultProject = { sequence: { properties: { rate: 30 } } };
  editor.new();

  assert.equal(editor.createdRate, 60);
  assert.equal(context.CM.defaultProject.sequence.properties.rate, 60);
  assert.equal(context.PZ.sequence.propertyDefinitions.rate.value, 60);
});

test("new particles use reset defaults and only the time expression", () => {
  class Property {}
  class DynamicGroup extends Property {}
  class DynamicKeyframes extends Property {}

  function Particle() {
    this.properties = {
      color: { definition: { value: [{ position: 0, color: "white" }] } },
      position: new DynamicGroup(),
      time: new DynamicKeyframes(),
      number: new DynamicKeyframes(),
    };
    this.properties.position.definition = { objects: [] };
    this.properties.position.objects = [
      Object.assign(new DynamicKeyframes(), {
        definition: { value: [1, 2, 3] },
        defaultTween: 1,
      }),
    ];
    this.properties.time.definition = { value: 0 };
    this.properties.time.defaultTween = 1;
    this.properties.number.definition = { value: 0 };
    this.properties.number.defaultTween = 1;
  }
  Particle.prototype.load = function (data) {
    this.loadedData = data;
    return data;
  };

  const context = {
    PZ: {
      object3d: { particles: Particle },
      property: { dynamic: { group: DynamicGroup, keyframes: DynamicKeyframes } },
    },
  };
  context.window = context;
  vm.runInNewContext(readPatch("particle-defaults.js"), context);

  const particle = new Particle();
  particle.load();

  assert.deepEqual(JSON.parse(JSON.stringify(particle.loadedData.properties.color)), [
    { position: 0, color: "white" },
  ]);
  assert.deepEqual(
    JSON.parse(JSON.stringify(particle.loadedData.properties.position.objects[0].keyframes)),
    [
    { frame: 0, value: [1, 2, 3], tween: 1 },
    ],
  );
  assert.deepEqual(JSON.parse(JSON.stringify(particle.loadedData.properties.number.keyframes)), [
    { frame: 0, value: 0, tween: 1 },
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(particle.loadedData.properties.time)), {
    animated: true,
    expression: "time",
    keyframes: [{ frame: 0, value: 0, tween: 1 }],
  });

  const existing = { properties: { number: "saved" } };
  assert.equal(particle.load(existing), existing);
});
