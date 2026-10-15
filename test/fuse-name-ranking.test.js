"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

// Stand-in for Fuse 6.0.4 with default options: search returns the matching
// items themselves (no {item} wrapper), in list order. Matches on `name`,
// `title`, or `desc`, as CM3's picker and media keys do.
function FakeFuse(list, options) {
  this.list = list;
  this.options = options || {};
}
FakeFuse.prototype.search = function (term) {
  const needle = String(term).trim().toLowerCase();
  return this.list.filter(function (item) {
    const label = String(item.name || item.title || "");
    return label.toLowerCase().indexOf(needle) !== -1 ||
      String(item.desc || "").toLowerCase().indexOf(needle) !== -1;
  });
};
FakeFuse.version = "6.0.4";

global.Fuse = FakeFuse;
global.addEventListener = function () {};

require("../zoidium/plugin-apis.js");

const picker = [
  { name: "Time Offset", desc: "Shifts time with a bevel-like delay." },
  { name: "Posterize Time", desc: "Steps time in bevel increments." },
  { name: "Bevel Alpha", desc: "Bevels the alpha edge." },
  { name: "Glow", desc: "Soft light." },
  { name: "Bevel", desc: "Exact name." },
];
const pickerKeys = [{ name: "name", weight: 0.6 }, { name: "desc", weight: 0.4 }];

function names(results) {
  return results.map(function (result) {
    return (result.item || result).name;
  });
}

test("exact and prefix name matches rank above description-only matches", () => {
  const fuse = new global.Fuse(picker, { keys: pickerKeys, threshold: 0.45 });
  assert.deepEqual(names(fuse.search("Bevel")), ["Bevel", "Bevel Alpha", "Time Offset", "Posterize Time"]);
});

test("name tiers are exact, prefix, substring, then Fuse order", () => {
  const items = [
    { name: "Mega Glow", desc: "" },
    { name: "Glow Fx", desc: "" },
    { name: "Glowing Sky", desc: "" },
    { name: "Glow", desc: "" },
    { name: "Dim Lamp", desc: "glow" },
    { name: "Light Glow Pro", desc: "" },
  ];
  const fuse = new global.Fuse(items, { keys: ["name"] });
  assert.deepEqual(names(fuse.search("glow")), [
    "Glow",
    "Glow Fx",
    "Glowing Sky",
    "Mega Glow",
    "Light Glow Pro",
    "Dim Lamp",
  ]);
});

test("the name comparison is case-insensitive and ignores surrounding spaces", () => {
  const fuse = new global.Fuse(picker, { keys: ["name"] });
  assert.deepEqual(names(fuse.search("  BEVEL  ")), ["Bevel", "Bevel Alpha", "Time Offset", "Posterize Time"]);
});

test("an empty query keeps Fuse's order", () => {
  const fuse = new global.Fuse(picker, { keys: ["name"] });
  assert.deepEqual(names(fuse.search("")), picker.map((item) => item.name));
});

test("re-ordering keeps every match and returns the same item objects", () => {
  const fuse = new global.Fuse(picker, { keys: ["name"] });
  const results = fuse.search("bevel");
  assert.ok(Array.isArray(results));
  assert.equal(results.length, 4);
  assert.ok(results.every((item) => picker.indexOf(item) !== -1));
});

test("wrapped {item} results are ranked by their item name and keep their shape", () => {
  const original = FakeFuse.prototype.search;
  FakeFuse.prototype.search = function (term) {
    return original.call(this, term).map((item) => ({ item: item, score: 0.1 }));
  };
  try {
    const fuse = new global.Fuse(picker, { keys: ["name"], include: ["score"] });
    const results = fuse.search("bevel");
    assert.deepEqual(names(results), ["Bevel", "Bevel Alpha", "Time Offset", "Posterize Time"]);
    assert.ok(results.every((result) => typeof result.score === "number" && result.item));
  } finally {
    FakeFuse.prototype.search = original;
  }
});

test("instances whose keys do not include name keep Fuse's own search", () => {
  const titles = [{ title: "Clip B" }, { title: "Clip A" }];
  const media = new global.Fuse(titles, { keys: ["title"] });
  assert.equal(Object.prototype.hasOwnProperty.call(media, "search"), false);
  assert.deepEqual(media.search("Clip").map((item) => item.title), ["Clip B", "Clip A"]);
  const bare = new global.Fuse(["Clip"]);
  assert.equal(Object.prototype.hasOwnProperty.call(bare, "search"), false);
});

test("name keys given as plain strings are recognized", () => {
  const fuse = new global.Fuse(picker, { keys: ["desc", "name"] });
  assert.equal(Object.prototype.hasOwnProperty.call(fuse, "search"), true);
  assert.deepEqual(names(fuse.search("Bevel")), ["Bevel", "Bevel Alpha", "Time Offset", "Posterize Time"]);
});

test("a prototype search patch installed after construction is still used", () => {
  const fuse = new global.Fuse(picker, { keys: ["name"] });
  const original = FakeFuse.prototype.search;
  FakeFuse.prototype.search = function (term) {
    return original.call(this, term).reverse();
  };
  try {
    assert.deepEqual(names(fuse.search("bevel")), ["Bevel", "Bevel Alpha", "Posterize Time", "Time Offset"]);
  } finally {
    FakeFuse.prototype.search = original;
  }
});

test("the snapshot wrapper still reports the original prototype", () => {
  assert.equal(global.Fuse.__zoidiumSnapshot, true);
  assert.equal(global.Fuse.prototype, FakeFuse.prototype);
  const fuse = new global.Fuse([], { keys: ["name"] });
  assert.ok(fuse instanceof FakeFuse);
});
