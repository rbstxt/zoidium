"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const test = require("node:test");

function setup() {
  class ObjectList extends Array {}
  class Singleton extends ObjectList {}
  class Property {}
  Property.dynamic = class {};
  const calls = [];
  const proto = {
    createKeyframeTrack(container, object) {
      if (object.static) return;
      const track = { container, object };
      // Mirror CM3's existing supported-list traversal.
      for (const child of (object.children || []).slice().reverse()) {
        if (child instanceof Singleton || child.type === Property || child.type === Property.dynamic) {
          this.createTrackList(track, child);
        }
      }
      return track;
    },
    createTrackList(track, list) { calls.push({ track, list }); },
  };
  const context = { PZ: { property: Property, objectList: ObjectList, objectSingleton: Singleton,
    ui: { timeline: { keyframes: { prototype: proto } } } } };
  vm.createContext(context);
  const source = fs.readFileSync(require.resolve("../zoidium/plugin-apis.js"), "utf8");
  const load = () => vm.runInContext(source, context);
  load();
  return { proto, calls, ObjectList, Singleton, Property, load };
}

test("plugin container lists reach native timeline builders without changing ownership", () => {
  const { proto, calls, ObjectList } = setup();
  class FormInstance {}
  const forms = new ObjectList();
  forms.type = FormInstance;
  forms.parent = {};
  const object = { children: [forms] };
  const children = object.children;
  const parent = forms.parent;
  const track = proto.createKeyframeTrack({}, object);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].list, forms);
  assert.equal(calls[0].track, track);
  assert.equal(object.children, children);
  assert.equal(forms.parent, parent);
});

test("stock property lists and singletons are visited once; installation is idempotent", () => {
  const { proto, calls, ObjectList, Singleton, Property, load } = setup();
  const lists = [new ObjectList(), new ObjectList(), new Singleton(), new ObjectList()];
  lists[0].type = Property;
  lists[1].type = Property.dynamic;
  lists[2].type = class PluginObject {};
  lists[3].type = class PluginObject {};
  const patched = proto.createKeyframeTrack;
  load();
  assert.equal(proto.createKeyframeTrack, patched);
  proto.createKeyframeTrack({}, { children: lists });
  for (const list of lists) assert.equal(calls.filter(call => call.list === list).length, 1);
  proto.createKeyframeTrack({}, { static: true, children: lists });
  assert.equal(calls.length, 4);
});
