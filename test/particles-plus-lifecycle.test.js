"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function setup() {
  class Observable {
    callbacks = new Set();
    watch(callback) { this.callbacks.add(callback); }
    unwatch(callback) { this.callbacks.delete(callback); }
  }
  class Particle {
    constructor(project) {
      this.parentProject = project;
      const property = { parentObject: this, parentProject: project, value: null,
        onChanged: new Observable(), get() { return this.value; } };
      this.properties = { texture: property };
    }
    unload() { this.unloaded = true; }
    toJSON() { return {}; }
  }
  Particle.propertyDefinitions = { texture: { items: [], changed() {} } };
  const editor = { project: null };
  const pickers = [];
  const controls = {
    generateTextureInput() {
      const select = { onchange() {} };
      const container = { pz_update() {}, querySelector: () => select };
      pickers.push({ container, select, original: select.onchange, update: container.pz_update });
      return [container, null];
    },
  };
  const PZ = { object3d: { particles: Particle }, ui: { controls } };
  const context = { module: { exports: {} }, WeakRef, console };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../plugins/particles-plus/particles-plus.js"), "utf8"), context);
  const plugin = context.module.exports;
  const disposers = [];
  const activation = {
    PZ, editor, window: {}, document: {}, plugin: { id: "particles-plus" },
    manifest: { resources: [{ id: "sprite-square", type: "image" }] },
    getAsset: () => "data:image/png;base64,AA==",
    lifecycle: { onDispose: callback => disposers.push(callback) },
  };
  function project() {
    const value = { particles: [], forEachItemOfType(Type, visit) { this.particles.forEach(visit); } };
    value.particles.push(new Particle(value));
    editor.project = value;
    return value;
  }
  return { plugin, activation, project, pickers, editor, controls, Particle, disposers };
}

test("twenty project unloads release particle property observers and picker patches", () => {
  const env = setup();
  env.plugin.activate(env.activation);
  for (let index = 0; index < 20; index++) {
    const particle = env.project().particles[0];
    const property = particle.properties.texture;
    env.plugin.isInUse();
    assert.equal(property.onChanged.callbacks.size, 1);
    env.controls.generateTextureInput(property);
    const picker = env.pickers.at(-1);
    assert.notEqual(picker.select.onchange, picker.original);
    particle.unload();
    assert.equal(property.onChanged.callbacks.size, 0);
    assert.equal(picker.select.onchange, picker.original);
    assert.equal(picker.container.pz_update, picker.update);
    assert.equal(particle.unloaded, true);
  }
  env.disposers[0]();
});

test("project replacement prunes watchers even when the old object was not unloaded", () => {
  const env = setup();
  const old = env.project().particles[0];
  env.plugin.activate(env.activation);
  assert.equal(old.properties.texture.onChanged.callbacks.size, 1);
  env.project();
  env.plugin.isInUse();
  assert.equal(old.properties.texture.onChanged.callbacks.size, 0);
  env.plugin.deactivate();
  assert.equal(env.editor.project.particles[0].properties.texture.onChanged.callbacks.size, 0);
});

test("activation failure rolls back prototype and texture definition patches", () => {
  const env = setup();
  const unload = env.Particle.prototype.unload;
  env.activation.getAsset = () => null;
  assert.throws(() => env.plugin.activate(env.activation), /sprite missing/);
  assert.equal(env.Particle.prototype.unload, unload);
  assert.deepEqual(env.Particle.propertyDefinitions.texture.items, []);
  env.disposers[0]();
});
