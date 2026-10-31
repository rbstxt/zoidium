"use strict";
const { holdValue } = require("./text-properties.js");
const { definitions, titles } = require("./properties.js");
const clone = value => JSON.parse(JSON.stringify(value));
function validate(contents, depth = 0, state = { count: 0, ids: new Set() }) {
  if (!Array.isArray(contents) || depth > 16) throw Error("Invalid Shape+ contents depth");
  for (const item of contents) {
    if (++state.count > 512 || !item || !titles[item.kind] || typeof item.id !== "string" || state.ids.has(item.id)) throw Error("Invalid Shape+ contents item or duplicate id");
    state.ids.add(item.id);
    if (item.kind === "path" && (!Array.isArray(item.vertexIds) || item.vertexIds.length < 1 || item.vertexIds.length > 256 || new Set(item.vertexIds).size !== item.vertexIds.length || !item.vertexIds.every(id => typeof id === "string" && id.length > 0 && id.length <= 128))) throw Error("Invalid Shape+ path topology");
    if (item.kind === "group") validate(item.contents, depth + 1, state);
  }
  return contents;
}
function createModel(PZ, textService) {
  let sequence = 0;
  const ownedIds = new Set();
  function nextId() { let id; do { id = "s" + (++sequence).toString(36); } while (ownedIds.has(id)); ownedIds.add(id); return id; }
  class Content extends PZ.object {
    constructor(kind = "rectangle", data) {
      super();
      this.kind = kind; this.type = kind; this.id = data?.id || nextId(); ownedIds.add(this.id);
      this.vertexIds = data?.vertexIds?.slice() || ["v1", "v2", "v3", "v4"];
      this.vertexModes = clone(data?.vertexModes || {});
      this.properties = new PZ.propertyList(definitions(PZ, kind, this.vertexIds), this);
      this.children = [this.properties];
      if (kind === "group") { this.contents = new PZ.objectList(this, Content); this.contents.name = "Contents"; this.children.push(this.contents); }
      this.extra = {};
      if (kind === "text") {
        for (const key of ["sourceText", "font", "fallbackFont", "fontStyle", "caps", "alignment", "textMode"]) {
          const property = this.properties[key], get = property.get.bind(property);
          property.get = frame => {
            frame ??= this.textFrame || 0;
            return !property.expression && (property.keyframes?.length || property.data?.keyframes?.length)
              ? holdValue(property, frame) : get(frame);
          };
        }
        const name = this.properties.name, get = name.get.bind(name);
        const changed = () => name.onChanged?.update();
        this.properties.sourceText.onChanged?.watch(changed);
        this.properties.sourceText.onKeyframeChanged?.watch(changed);
        name.get = () => get() === "Text" ? String(holdValue(this.properties.sourceText, this.textFrame || 0)).split("\n")[0] || "Text" : get();
      }
    }
    load(data) {
      data = clone(data || {});
      if (data.id) {
        let root = this;
        for (let current = this; current; current = current.parent ? current.parentObject : null) if (current.contents) root = current;
        const collision = nodes => Array.from(nodes || []).some(node => node !== this && (node.id === data.id || collision(node.contents)));
        this.id = collision(root.contents) ? nextId() : data.id;
        ownedIds.add(this.id);
      }
      if (this.kind === "path" && data.vertexIds && JSON.stringify(data.vertexIds) !== JSON.stringify(this.vertexIds)) {
        this.vertexIds = data.vertexIds.slice();
        this.properties = new PZ.propertyList(definitions(PZ, this.kind, this.vertexIds), this);
        this.children[0] = this.properties;
      }
      this.vertexModes = clone(data.vertexModes || this.vertexModes);
      if (this.kind === "text" && data.properties) for (const key of ["sourceText", "font", "fallbackFont", "fontStyle", "caps", "alignment", "textMode"]) {
        const value = data.properties[key];
        if (value !== undefined && (value === null || typeof value !== "object"))
          data.properties[key] = { animated: false, keyframes: [{ frame: 0, value, tween: 0 }] };
      }
      this.hiddenAxes = clone(data.axisStore || {});
      this.extra = data;
      this.properties.load(data.properties);
      if (this.contents) {
        for (const child of this.contents) child.unload();
        this.contents.splice(0, this.contents.length);
        for (const item of data.contents || []) { const child = new Content(item.kind, item); this.contents.push(child); child.load(item); }
      }
    }
    toJSON() {
      const result = { ...this.extra, id: this.id, kind: this.kind, properties: { ...this.extra.properties, ...clone(this.properties) } };
      if (this.kind === "text" && Object.keys(this.hiddenAxes || {}).length) result.axisStore = clone(this.hiddenAxes);
      else if (this.kind === "text") delete result.axisStore;
      if (this.kind === "textAnimator" && Object.keys(this.hiddenAxes || {}).length) result.axisStore = clone(this.hiddenAxes);
      else if (this.kind === "textAnimator") delete result.axisStore;
      if (this.contents) result.contents = this.contents;
      if (this.kind === "path") Object.assign(result, { vertexIds: this.vertexIds, vertexModes: this.vertexModes });
      return result;
    }
    evaluate(frame, rate = 30) {
      if (this.kind === "text") this.textFrame = frame;
      const properties = {};
      for (const key of Object.keys(this.properties)) {
        const value = this.kind === "text" && this.properties[key].definition.dynamic && [PZ.property.type.TEXT, PZ.property.type.ASSET, PZ.property.type.LIST].includes(this.properties[key].definition.type) ? holdValue(this.properties[key], frame) : this.properties[key].get(frame);
        if (typeof value === "number" && !Number.isFinite(value) || Array.isArray(value) && key !== "stops" && !value.every(Number.isFinite)) throw Error("Shape+ property must be finite");
        properties[key] = Array.isArray(value) ? value.slice() : value;
      }
      if (["wigglePaths", "wiggleTransform", "textAnimator"].includes(this.kind)) properties.time = frame / rate;
      const textLayout = this.kind === "text" ? textService?.evaluate(this, properties, frame) || { glyphs: [], rows: [] } : null;
      const result = { id: this.id, kind: this.kind, vertexIds: this.vertexIds.slice(), properties, ...(this.contents ? { contents: Array.from(this.contents, child => child.evaluate(frame, rate)) } : {}) };
      if (textLayout) {
        Object.defineProperty(result, "textLayout", { value: textLayout });
        result.textLayoutKey = textLayout.cacheKey;
      }
      return result;
    }
    async prepare(frame = this.textFrame || 0) { if (this.kind === "text") await textService?.prepare(this, frame); else if (this.kind === "textAnimator") await textService?.prepareAnimator?.(this, frame); for (const child of this.contents || []) await child.prepare(frame); }
    unload() { if (this.kind === "text") textService?.release(this); for (const child of this.contents || []) child.unload(); }
    static create(kind) { return new Content(kind); }
  }
  Content.prototype.defaultName = "Content";
  return { Content, nextId };
}
// New layers start with the AE structure: a group that owns its path and the
// fill drawing it. Saved contents keep whatever structure they were saved with.
function defaults() {
  return [{ id: "group", kind: "group", properties: { name: "Rectangle 1" }, contents: [
    { id: "shape", kind: "rectangle", properties: {} }, { id: "fill", kind: "fill", properties: {} },
  ] }];
}
module.exports = { clone, validate, createModel, defaults };
