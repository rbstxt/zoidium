"use strict";
// Small authored property host for pure model tests. Browser characterization
// separately exercises CM3's actual group/history/timeline implementations.
class ObjectNode {
  get parentObject() { return this.parent instanceof ObjectNode ? this.parent : this.parent?.parentObject; }
}
class ObjectList extends Array {
  constructor(parent, type) { super(); this.parent = parent; this.type = type; }
  get parentObject() { return this.parent; }
  push(...items) { for (const item of items) item.parent = this; return super.push(...items); }
  toJSON() { return Array.from(this); }
}
const copy = value => JSON.parse(JSON.stringify(value));
class Property extends ObjectNode {
  constructor(definition) {
    super(); this.definition = definition;
    if (definition.group) this.objects = definition.objects.map(d => new Property(d));
  }
  load(data) {
    if (this.objects) {
      this.objects.forEach((p, i) => p.load(data?.objects?.[i] || (data?.keyframes ? { animated: data.animated, keyframes: data.keyframes.map(k => ({ ...k, value: k.value[i] })) } : undefined)));
    } else if (this.definition.dynamic) this.data = copy(data || { animated: false, keyframes: [{ frame: 0, value: this.definition.value, tween: 1 }] });
    else this.value = data === undefined ? copy(this.definition.value) : copy(data);
  }
  get(frame = 0) {
    if (this.objects) return this.objects.map(p => p.get(frame));
    if (!this.definition.dynamic) return this.value;
    const keys = this.data.keyframes;
    let previous = keys[0];
    for (const next of keys.slice(1)) {
      if (frame <= next.frame) return next.tween === 0 ? previous.value : previous.value + (next.value - previous.value) * Math.max(0, (frame - previous.frame) / (next.frame - previous.frame));
      previous = next;
    }
    return previous.value;
  }
  toJSON() { return this.objects ? { objects: this.objects } : this.definition.dynamic ? this.data : this.value; }
}
Property.type = { NUMBER: 0, VECTOR2: 1, VECTOR3: 2, COLOR: 4, GRADIENT: 5, OPTION: 6, TEXT: 7, LIST: 9 };
class PropertyList {
  constructor(definitions, parent) {
    Object.defineProperty(this, "parent", { value: parent });
    for (const [key, definition] of Object.entries(definitions)) { this[key] = new Property(definition); this[key].parent = this; }
  }
  get parentObject() { return this.parent; }
  load(data) { for (const key of Object.keys(this)) this[key].load(data?.[key]); }
}
module.exports = { PZ: { object: ObjectNode, objectList: ObjectList, property: Property, propertyList: PropertyList } };
