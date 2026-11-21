"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { definitions } = require("../plugins/shape-plus/properties");
const { createModel } = require("../plugins/shape-plus/model");
const { PZ } = require("./shape-plus-host");
const names = ids => definitions(PZ, "path", ids).path.objects.map(item => item.zoidiumPathLabel);

test("path channel definitions name all six coordinates in vertex order", () => {
  assert.deepEqual(names(["sp-a", "sp-b"]), [
    "Point 1 - X", "Point 1 - Y", "Point 1 In - X", "Point 1 In - Y", "Point 1 Out - X", "Point 1 Out - Y",
    "Point 2 - X", "Point 2 - Y", "Point 2 In - X", "Point 2 In - Y", "Point 2 Out - X", "Point 2 Out - Y",
  ]);
});

test("topology reload renumbers labels without changing serialized channel data", () => {
  const { Content } = createModel(PZ);
  const item = new Content("path", { vertexIds: ["sp-a", "sp-b"] });
  item.load({ vertexIds: ["sp-a", "sp-b"] });
  const snapshot = JSON.parse(JSON.stringify(item));
  snapshot.properties.path.objects[0].expression = "keep-this-expression";
  const reordered = JSON.parse(JSON.stringify(snapshot));
  reordered.vertexIds.reverse();
  reordered.properties.path.objects = [...snapshot.properties.path.objects.slice(6), ...snapshot.properties.path.objects.slice(0, 6)];
  item.load(reordered);
  assert.deepEqual(item.properties.path.objects.map(channel => channel.definition.zoidiumPathLabel), names(reordered.vertexIds));
  assert.deepEqual(JSON.parse(JSON.stringify(item)).properties.path, reordered.properties.path);
  item.load(snapshot);
  assert.deepEqual(item.properties.path.objects.map(channel => channel.definition.zoidiumPathLabel), names(snapshot.vertexIds));
  assert.deepEqual(JSON.parse(JSON.stringify(item)).properties.path, snapshot.properties.path);
});

const { install } = require("../plugins/shape-plus/path-channel-labels");
test("panel and timeline labels leave native clipboard names unchanged", () => {
  const label = () => ({ textContent: "", title: "" });
  const PZ = { ui: { edit: function () {}, timeline: { keyframes: function () {} } } };
  PZ.ui.edit.prototype.generateListItem = function (_parent, object) { return { firstElementChild: { children: [Object.assign(label(), { tagName: "SPAN" })] }, object }; };
  PZ.ui.timeline.keyframes.prototype.createKeyframeTrack = function (_parent, object) { return { pz_label: label(), pz_object: object }; };
  const restore = install(PZ);
  const property = { definition: { name: "sp-a In X", zoidiumPathLabel: "Point 1 In - X" } };
  const row = new PZ.ui.edit().generateListItem(null, property);
  const track = new PZ.ui.timeline.keyframes().createKeyframeTrack(null, property);
  assert.equal(row.firstElementChild.children[0].textContent, "Point 1 In - X");
  assert.equal(track.pz_label.title, "Point 1 In - X");
  assert.equal(property.definition.name, "sp-a In X");
  restore();
});
