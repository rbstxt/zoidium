"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createModel } = require("../plugins/shape-plus/model.js");
const { createAPI } = require("../plugins/expressions-plus/api.js");
const { PZ: host } = require("./shape-plus-host.js");

const clone = value => JSON.parse(JSON.stringify(value));
const key = (frame, value) => ({ frame, value, tween: 1 });
const record = (id = "p1", name = "Travel") => ({
  type: { type: 0, custom: true, dynamic: true, zoidiumShader: { kind: "slider" }, zoidiumShapeGroup: { id }, value: 0 },
  properties: { name },
  animated: true, keyframes: [key(0, 0), key(30, 120)],
});
const fixture = controls => ({
  id: "outer", kind: "group", future: true,
  properties: { name: "Motion", unknown: "retained" }, contents: [],
  ...(controls ? { zoidiumGroupProperties: controls } : {}),
});

function setup(data = fixture()) {
  class Property extends host.property {
    static create(definition) { return new Property(definition); }
    constructor(definition) {
      super(definition);
      if (definition.custom) this.properties = new PropertyList({ name: { value: "Property" } }, this);
    }
    load(data) { super.load(data); this.properties?.load(data?.properties); }
    get keyframes() { return this.data?.keyframes; }
    toJSON() {
      const value = super.toJSON();
      return this.properties ? { type: this.definition, properties: this.properties, ...value } : value;
    }
  }
  class PropertyList extends host.propertyList {
    add(name, property) { this.addAll({ [name]: property }); }
    addAll(properties) {
      for (const [name, property] of Object.entries(properties)) {
        this[name] = property instanceof PropertyList || property instanceof Property ? property : new Property(property);
        this[name].parent = this;
      }
    }
    remove(name) { delete this[name]; }
    removeAll() { for (const name of Object.keys(this)) this.remove(name); }
    *[Symbol.iterator]() {
      for (const property of Object.values(this)) {
        if (property instanceof PropertyList) yield* property;
        else yield property;
      }
    }
  }
  class Layer extends host.object {}
  class Clip extends host.object {}
  const PZ = { ...host, property: Property, propertyList: PropertyList, layer: Layer, clip: Clip };
  const { Content } = createModel(PZ);
  const group = new Content("group", data);
  group.load(data);
  return { PZ, Content, group, Layer, Clip };
}

test("Shape+ group controls round trip their native keyframes and stay out of geometry input", () => {
  const data = fixture([record()]), { group, Content } = setup(data);
  const [travel] = group.groupProperties;
  assert.equal(travel.get(15), 60);
  const saved = clone(group);
  assert.deepEqual(saved.zoidiumGroupProperties, data.zoidiumGroupProperties);
  assert.equal(saved.properties.zoidiumGroupProperties, undefined);
  const reopened = new Content("group", saved);
  reopened.load(saved);
  assert.equal(JSON.stringify(reopened), JSON.stringify(saved));
  const legacy = setup(fixture()).group;
  assert.equal(JSON.stringify(group.evaluate(15)), JSON.stringify(legacy.evaluate(15)));
  const legacySaved = JSON.stringify(legacy);
  legacy.load(JSON.parse(legacySaved));
  assert.equal(JSON.stringify(legacy), legacySaved);
  assert.equal(JSON.parse(legacySaved).zoidiumGroupProperties, undefined);
});

test("Expressions+ resolves nested Shape+ controls on the same layer and on another active layer", () => {
  const { PZ, Content, group, Layer, Clip } = setup(fixture([record()]));
  const layer = name => Object.assign(new Layer(), { type: "zoidium:shape-plus/shape-layer", properties: { name: { get: () => name } }, contents: new PZ.objectList(null, Content) });
  const a = layer("Artwork"), b = layer("Controller");
  a.contents = new PZ.objectList(a, Content);
  a.contents.push(group);
  const nested = new Content("group");
  nested.load({ ...fixture([record("p1", "Offset")]), id: "inner", properties: { name: "Nested" } });
  group.contents.push(nested);
  const target = new Content("rectangle");
  target.load({ properties: {} });
  group.contents.push(target);
  const clips = [Object.assign(new Clip(), { start: 20, length: 100, object: a }), Object.assign(new Clip(), { start: 30, length: 100, object: b })];
  a.parent = clips[0]; b.parent = clips[1];
  b.contents = new PZ.objectList(b, Content);
  const controller = new Content("group");
  controller.load(fixture([record()]));
  b.contents.push(controller);
  const sequence = { videoTracks: clips.map(clip => ({ clips: [clip] })) };
  const { api } = createAPI({ PZ, owner: target, frame: 25, base: 0, sequence, methods: {}, read: (p, frame) => p.get(frame) });
  assert.equal(api.thisLayer.content("Motion").param("Travel"), 100);
  assert.equal(api.thisLayer.content("Motion").content("Nested").property("Offset").numKeys, 2);
  assert.equal(api.layer("Controller").content("Motion").property("Travel").value, 60);
  assert.equal(api.thisLayer.content("Nested"), null);
});

test("Shape+ edits add, rename, reorder, and remove controls with undo and redo", () => {
  const { group } = setup();
  const { editGroupProperties } = require("../plugins/shape-plus/group-properties.js");
  const undo = [], redo = [];
  const history = {
    operation: null,
    startOperation() { this.operation = []; },
    pushCommand(fn, args) { this.operation.push(() => fn(args)); },
    finishOperation() { undo.push(this.operation); this.operation = null; },
    discardOperation() { this.operation = null; },
    replay(from, to) {
      this.startOperation();
      for (const command of from.pop().reverse()) command();
      to.push(this.operation); this.operation = null;
    },
  };
  const project = {}, editor = { history, project };
  const edit = change => editGroupProperties(editor, () => group, change);
  const names = () => [...(group.groupProperties || [])].map(p => p.properties.name.get());
  edit(items => items.push(record(), record("p2", "Mode")));
  edit(items => { items[0].properties.name = "Distance"; });
  edit(items => items.reverse());
  edit(items => items.splice(1, 1));
  assert.deepEqual(names(), ["Mode"]);
  assert.throws(() => edit(items => items.push(record("p3", "Mode"))), /unique/);
  assert.deepEqual(names(), ["Mode"]);
  for (const expected of [["Mode", "Distance"], ["Distance", "Mode"], ["Travel", "Mode"], []]) {
    history.replay(undo, redo);
    assert.deepEqual(names(), expected);
  }
  assert.equal(JSON.parse(JSON.stringify(group)).zoidiumGroupProperties, undefined);
  for (const expected of [["Travel", "Mode"], ["Distance", "Mode"], ["Mode", "Distance"], ["Mode"]]) {
    history.replay(redo, undo);
    assert.deepEqual(names(), expected);
  }
});
