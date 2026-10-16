"use strict";
const { clone, validate, defaults } = require("./model.js");
const { compile } = require("./compiler.js");
const { createRenderer } = require("./render.js");
const TYPE = "zoidium:shape-plus/shape-layer";
function createLayerClass(PZ, THREE, Content) {
  return class ShapePlusLayer extends PZ.layer {
    constructor() {
      super(); this.type = TYPE; this.defaultName = "Shape+";
      this.contents = new PZ.objectList(this, Content); this.contents.name = "Contents";
      this.children.splice(1, 0, this.contents);
      this.engine = createRenderer(THREE);
      this.pass = { render: (renderer, destination) => {
        const width = Math.max(1, destination.viewport.z), height = Math.max(1, destination.viewport.w);
        const resolution = this.properties.resolution.get();
        const scale = this.properties.scale.get(this.frame);
        const pixelScale = Math.max(width / resolution[0], height / resolution[1]) * Math.max(Math.abs(scale[0]), Math.abs(scale[1]), 1);
        this.build(.125 / Math.max(pixelScale, 1e-6));
        this.engine.render(renderer, destination);
      } };
      this.frame = 0; this.signature = null; this.extra = {}; this.buildCount = 0;
    }
    load(data) {
      data = clone(data || { type: TYPE, contents: defaults(), effects: [] });
      if ((data.schemaVersion || 1) !== 1 || (data.renderVersion || 1) !== 1) throw Error("Unsupported Shape+ format version");
      validate(data.contents || []);
      this.extra = data;
      super.load({ ...data, effects: data.effects || [] });
      this.properties.load(data.properties);
      const resolution = this.parentProject.sequence.properties.resolution.get();
      this.properties.resolution.set(resolution.slice()); this.composite.quad.scale.set(...resolution, 1);
      for (const child of this.contents) child.unload();
      this.contents.splice(0, this.contents.length);
      for (const item of data.contents || []) { const node = new Content(item.kind, item); this.contents.push(node); node.load(item); }
      this.signature = null;
    }
    toJSON() { return { ...this.extra, ...super.toJSON(), schemaVersion: 1, renderVersion: 1, contents: this.contents }; }
    update(frame) {
      this.frame = frame;
      const resolution = this.parentProject.sequence.properties.resolution.get(), current = this.properties.resolution.get();
      if (current[0] !== resolution[0] || current[1] !== resolution[1]) {
        this.properties.resolution.set(resolution.slice()); this.composite.quad.scale.set(...resolution, 1);
      }
      super.update(frame);
    }
    build(tolerance) {
      const contents = Array.from(this.contents, node => node.evaluate(this.frame));
      const resolution = this.properties.resolution.get(), signature = JSON.stringify([contents, tolerance, resolution]);
      if (signature === this.signature) return;
      const result = compile(contents, tolerance);
      this.engine.setCommands(result.commands, resolution);
      this.signature = signature; this.buildCount++;
    }
    async prepare(frame, context) { await super.prepare(frame, context); }
    unload() {
      this.engine.dispose(); for (const child of this.contents) child.unload();
      super.unload(); this.composite.quad.geometry.dispose(); this.composite.quad.material.dispose();
    }
  };
}
module.exports = { TYPE, createLayerClass };
