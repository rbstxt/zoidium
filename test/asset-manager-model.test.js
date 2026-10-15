"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.join(__dirname, "..");

function loadModel() {
  const source = fs.readFileSync(path.join(root, "plugins/asset-manager/assets-model.js"), "utf8");
  const module = { exports: {} };
  vm.runInNewContext(`(function (module, exports) {${source}\n})`, {})(module, module.exports);
  return module.exports;
}

const model = loadModel();

function item(fields) {
  return Object.assign({
    id: fields.name,
    key: fields.name,
    kind: "image",
    source: "file",
    status: "ready",
    error: null,
    size: null,
    info: {},
    usages: [],
  }, fields);
}

const use = (path, extra) => Object.assign({ id: path.join("/"), path, kind: "property", revealable: true }, extra);

const items = [
  item({ name: "logo.png", size: 2048, info: { width: 512, height: 256 }, usages: [use(["V1 Logo", "Image"])] }),
  item({ name: "intro.mp4", kind: "video", size: 5 * 1024 * 1024, info: { duration: 75.5 } }),
  item({ name: "Brand.ttf", kind: "font", status: "missing", error: "The file is not in the project." }),
  item({
    name: "Roboto", kind: "font", source: "preset", status: "failed", error: "Network error",
    usages: [use(["V2 Title", "Text", "Font"]), use(["V3 Sub", "Text", "Font"], { kind: "keyframe", frame: 12 })],
  }),
  item({ name: "Unused fail", kind: "lut", status: "failed" }),
  item({ id: "comp:1", key: null, name: "Intro comp", kind: "composition", source: "composition", usages: [use(["V4 Intro comp"])] }),
];

test("problems follow the registry rule: failed while used, missing always", () => {
  assert.deepEqual(items.filter(model.isProblem).map((entry) => entry.name), ["Brand.ttf", "Roboto"]);
});

test("filters select used, unused, problems, kind and search words", () => {
  const names = (options) => [...model.filterItems(items, options).map((entry) => entry.name)];
  assert.deepEqual(names({ filter: "used" }), ["logo.png", "Roboto", "Intro comp"]);
  assert.deepEqual(names({ filter: "unused" }), ["intro.mp4", "Brand.ttf", "Unused fail"]);
  assert.deepEqual(names({ filter: "problems" }), ["Brand.ttf", "Roboto"]);
  assert.deepEqual(names({ kind: "font" }), ["Brand.ttf", "Roboto"]);
  assert.deepEqual(names({ query: "font missing" }), ["Brand.ttf"]);
  assert.deepEqual(names({ query: "512" }), ["logo.png"]);
  assert.deepEqual(names({ query: "built-in" }), ["Roboto"]);
});

test("sorting by uses, size and status keeps name as the tie breaker", () => {
  const order = (column, direction) => [...model.sortItems(items, { column, direction }).map((entry) => entry.name)];
  assert.deepEqual(order("uses", "desc").slice(0, 3), ["Roboto", "Intro comp", "logo.png"]);
  assert.deepEqual(order("size", "desc").slice(0, 2), ["intro.mp4", "logo.png"]);
  assert.deepEqual(order("status", "asc").slice(0, 3), ["Roboto", "Unused fail", "Brand.ttf"]);
  assert.deepEqual(order("name", "asc")[0], "Brand.ttf");
});

test("labels and text match the After Effects wording", () => {
  assert.equal(model.usageText(items[0]), "Used once");
  assert.equal(model.usageText(items[3]), "Used 2 times");
  assert.equal(model.usageText(items[1]), "Unused");
  assert.equal(model.detailText(items[0]), "512 × 256");
  assert.equal(model.detailText(items[1]), "1:15.50");
  assert.equal(model.formatSize(2048), "2.0 KB");
  assert.equal(model.formatSize(5 * 1024 * 1024), "5.0 MB");
  assert.equal(model.formatSize(null), "");
  assert.equal(model.usagePath(items[3].usages[1]), "V3 Sub › Text › Font (keyframe at frame 12)");
  assert.equal(model.kindLabel("geometry"), "3D Model");
  assert.equal(model.kindLabel("something-new"), "File");
});

test("summary counts unused project files with their size and problems", () => {
  assert.equal(model.summaryText(items), "6 items · 3 unused (5.0 MB) · 2 problems");
  assert.equal(model.summaryText(items, 2), "2 of 6 items · 3 unused (5.0 MB) · 2 problems");
  assert.equal(model.summaryText([]), "0 items");
  assert.deepEqual([...model.presentKinds(items)], ["composition", "video", "image", "font", "lut"]);
});
