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
