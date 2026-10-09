"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

// Minimal stand-in for CM3's Fuse 6.x: the constructor keeps a reference to
// the array it is given and reads it lazily, as the real one does.
function FakeFuse(list, options) {
  this.list = list;
  this.options = options || {};
}
FakeFuse.prototype.search = function (term) {
  return this.list.filter(function (item) {
    const text = typeof item === "string" ? item : String(item.title || item.name);
    return text.indexOf(term) !== -1;
  });
};
FakeFuse.version = "6.0.4";

const listeners = [];
global.Fuse = FakeFuse;
global.addEventListener = function (type, listener, capture) {
  listeners.push({ type: type, listener: listener, capture: capture });
};

require("../zoidium/plugin-apis.js");

test("Fuse searches a snapshot so later registry inserts do not reach the picker", () => {
  const registry = ["Blur", "Glow"];
  const picker = new global.Fuse(registry, { keys: ["name"] });
  registry.push("Native Flare");
  assert.deepEqual(picker.list, ["Blur", "Glow"]);
  assert.deepEqual(picker.search("Flare"), []);
  assert.notEqual(picker.list, registry);
});

test("Fuse instances built from an empty list still accept pushes into their own list", () => {
  const fuse = new global.Fuse([], { keys: ["title"] });
  fuse.list.push({ title: "Clip A" });
  assert.equal(fuse.list.length, 1);
  assert.equal(fuse.search("Clip").length, 1);
});

test("the wrapper keeps the original prototype, statics, and instanceof", () => {
  assert.equal(global.Fuse.__zoidiumSnapshot, true);
  assert.equal(global.Fuse.prototype, FakeFuse.prototype);
  assert.equal(global.Fuse.version, "6.0.4");
  const fuse = new global.Fuse(["a"]);
  assert.ok(fuse instanceof FakeFuse);
  assert.ok(fuse instanceof global.Fuse);
  assert.deepEqual(fuse.options, {});
});

test("loading the file again does not wrap Fuse twice", () => {
  const wrapped = global.Fuse;
  delete require.cache[require.resolve("../zoidium/plugin-apis.js")];
  require("../zoidium/plugin-apis.js");
  assert.equal(global.Fuse, wrapped);
});

test("arrow keys in a picker with no rows are stopped before CM3 reads null", () => {
  const guard = listeners.find((entry) => entry.type === "keydown" && entry.capture);
  assert.ok(guard, "a capture-phase keydown guard is installed");

  function picker(rowTags) {
    const list = { children: rowTags.map((tagName) => ({ tagName: tagName, classList: { contains: () => false } })) };
    const input = {
      classList: { contains: (name) => name === "pz-filterbox" },
      parentElement: {
        children: [
          { classList: { contains: () => false } },
          { classList: { contains: (name) => name === "pz-options" }, children: list.children },
          { classList: { contains: () => false } },
        ],
      },
    };
    return input;
  }

  function press(target, key) {
    let prevented = false;
    let stopped = false;
    guard.listener({
      key: key,
      target: target,
      preventDefault() { prevented = true; },
      stopPropagation() { stopped = true; },
    });
    return { prevented, stopped };
  }

  const empty = picker([]);
  assert.deepEqual(press(empty, "ArrowDown"), { prevented: true, stopped: true });
  assert.deepEqual(press(empty, "ArrowUp"), { prevented: true, stopped: true });

  // A category header alone is not a row the highlight can move to.
  assert.deepEqual(press(picker(["SPAN"]), "ArrowDown"), { prevented: true, stopped: true });

  const withRows = picker(["SPAN", "LI", "LI"]);
  assert.deepEqual(press(withRows, "ArrowDown"), { prevented: false, stopped: false });

  const otherInput = { classList: { contains: () => false } };
  assert.deepEqual(press(otherInput, "ArrowDown"), { prevented: false, stopped: false });
  assert.deepEqual(press(empty, "Enter"), { prevented: false, stopped: false });
});
