"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const source = fs.readFileSync(require.resolve("../plugins/core/object-history.js"), "utf8");

function fixture() {
  class Object3d {
    constructor() { this.geometry = new Float32Array(1024); this.value = 7; }
    toJSON() { return { type: 0, properties: { value: this.value } }; }
    unload() { this.value = null; }
  }
  class Edit {
    deleteObject(params) {
      const object = this.editor.project.addressLookup()[params.oldIdx];
      object.unload();
      this.editor.history.operation.push({ params: { data: object } });
      return 42;
    }
  }
  const PZ = { object3d: Object3d, ui: { edit: Edit } };
  vm.runInNewContext(source, { PZ });
  const object = new Object3d();
  const editor = { project: { addressLookup: () => [object] }, history: { operation: [] } };
  const edit = new Edit(); edit.editor = editor;
  return { PZ, edit, object, operation: editor.history.operation };
}

test("3D deletion stores serialized state before unload without retaining geometry", () => {
  const { edit, object, operation } = fixture();
  assert.equal(edit.deleteObject({ oldIdx: 0 }), 42);
  const data = operation[0].params.data;
  assert.notEqual(data, object);
  assert.equal(data.properties.value, 7);
  assert.equal(object.value, null);
  assert.equal(data.geometry, undefined);
  assert.equal(JSON.stringify(data), '{"type":0,"properties":{"value":7}}');
});

test("history repair does not wrap itself twice", () => {
  const { PZ } = fixture();
  const original = PZ.ui.edit.prototype.deleteObject;
  vm.runInNewContext(source, { PZ });
  assert.equal(PZ.ui.edit.prototype.deleteObject, original);
});

test("non-3D deletion keeps native undo data", () => {
  const { edit, object, operation } = fixture();
  edit.editor.project.addressLookup = () => [{ unload() {}, token: object }];
  edit.deleteObject({ oldIdx: 0 });
  assert.equal(operation[0].params.data.token, object);
});

test("a 3D type without project JSON keeps native undo data and still deletes", () => {
  const { edit, object, operation } = fixture();
  object.toJSON = () => undefined;
  assert.equal(edit.deleteObject({ oldIdx: 0 }), 42);
  assert.equal(operation[0].params.data, object);
});

test("clip deletion clears r91 render lists after the native command", () => {
  const calls = [];
  const prototype = {
    deleteClip(params) { calls.push(params); return 42; },
  };
  const PZ = { ui: { timeline: { tracks: { prototype } } } };
  vm.runInNewContext(source, { PZ });
  const tracks = { timeline: { editor: { mainViewport: {
    renderer: { renderLists: { dispose() { calls.push("dispose"); } } },
  } } } };
  const params = { type: 0, oldTrackIdx: 0, oldIdx: 0 };
  assert.equal(prototype.deleteClip.call(tracks, params), 42);
  assert.deepEqual(calls, [params, "dispose"]);
  const installed = prototype.deleteClip;
  vm.runInNewContext(source, { PZ });
  assert.equal(prototype.deleteClip, installed);
  assert.equal(prototype.deleteClip.call({ timeline: { editor: {} } }, params), 42);
});

test("clip deletion releases private light state when the tracked viewport provides it", () => {
  const calls = [];
  const prototype = { deleteClip() { calls.push("delete"); return 42; } };
  const PZ = { ui: { timeline: { tracks: { prototype } } } };
  vm.runInNewContext(source, { PZ });
  const tracks = { timeline: { editor: { mainViewport: {
    __zoidiumReleaseRenderState() { calls.push("states"); },
    renderer: { renderLists: { dispose() { calls.push("lists"); } } },
  } } } };
  assert.equal(prototype.deleteClip.call(tracks), 42);
  assert.deepEqual(calls, ["delete", "states"]);
});
