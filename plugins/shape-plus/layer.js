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
      // The native Objects panel maps a selected clip to layer.objects.
      // This alias is transient; the saved format continues to use contents.
      Object.defineProperty(this, "objects", { get: () => this.contents });
      this.children.splice(1, 0, this.contents);
      this.engine = createRenderer(THREE);
      this.pass = { render: (renderer, destination) => {
        try {
        const width = Math.max(1, destination.viewport.z), height = Math.max(1, destination.viewport.w);
        const resolution = this.properties.resolution.get();
        const transform = this.takeCompositeTransform();
        const scale = transform ? [Math.hypot(transform[0], transform[1]), Math.hypot(transform[2], transform[3])] : this.properties.scale.get(this.frame);
        const pixelScale = Math.max(width / resolution[0], height / resolution[1]) * Math.max(Math.abs(scale[0]), Math.abs(scale[1]), 1);
        this.build(.125 / Math.max(pixelScale, 1e-6));
        this.engine.render(renderer, destination, transform);
        } catch (error) { require("./geometry-failure.js").report(this.type, error); }
      } };
      this.frame = 0; this.signature = null; this.extra = {}; this.buildCount = 0; this.bakedTransform = null;
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
      this.frame = frame; this.bakedTransform = null;
      const resolution = this.parentProject.sequence.properties.resolution.get(), current = this.properties.resolution.get();
      if (current[0] !== resolution[0] || current[1] !== resolution[1]) {
        this.properties.resolution.set(resolution.slice()); this.composite.quad.scale.set(...resolution, 1);
      }
      super.update(frame);
    }
    // CM3 composites the pass output through composite.group (written by
    // update() or Camera+ just before pass.render). Without effects, a pure 2D
    // group transform is baked into the vector rasterization and the group is
    // reset to identity for this composite, so scaled layers stay sharp.
    // Effects work in pre-transform layer space and keep the native path.
    takeCompositeTransform() {
      const group = this.composite.group, p = group.position, r = group.rotation, s = group.scale;
      if (this.effects.length || r.x !== 0 || r.y !== 0 || p.z !== 0) { this.bakedTransform = null; return null; }
      const identity = p.x === 0 && p.y === 0 && r.z === 0 && s.x === 1 && s.y === 1;
      // A repeated render without update() finds the identity reset; reuse.
      let transform = identity && this.bakedTransform;
      if (identity && !transform) return null;
      if (!transform) {
        const cos = Math.cos(r.z), sin = Math.sin(r.z);
        transform = [cos * s.x, sin * s.x, -sin * s.y, cos * s.y, p.x, p.y];
        const det = transform[0] * transform[3] - transform[1] * transform[2];
        if (!transform.every(Number.isFinite) || !(Math.abs(det) > 1e-12)) { this.bakedTransform = null; return null; }
      }
      p.set(0, 0, 0); r.z = 0; s.set(1, 1, s.z);
      this.bakedTransform = transform; return transform;
    }
    build(tolerance) {
      try {
      const contents = Array.from(this.contents, node => node.evaluate(this.frame, this.parentProject.sequence.properties.rate.get()));
      const resolution = this.properties.resolution.get(), signature = JSON.stringify([contents, tolerance, resolution]);
      if (signature === this.signature) return;
      const result = compile(contents, tolerance);
      this.engine.setCommands(result.commands, resolution);
      this.signature = signature; this.buildCount++;
      } catch (error) {
        require("./geometry-failure.js").report(this.type, error);
        this.engine.setCommands([], this.properties.resolution.get());
        this.signature = null;
      }
    }
    async prepare(frame, context) { await super.prepare(frame, context); }
    unload() {
      this.engine.dispose(); for (const child of this.contents) child.unload();
      super.unload(); this.composite.quad.geometry.dispose(); this.composite.quad.material.dispose();
    }
  };
}
module.exports = { TYPE, createLayerClass };
