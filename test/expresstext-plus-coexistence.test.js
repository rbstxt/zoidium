"use strict";

// ExpressText+ coexistence: it steps aside when a Text+ container owns the
// text, and enabling/disabling the plugin leaves no registered classes or
// scoped dialog entries behind.

const assert = require("node:assert/strict");
const test = require("node:test");
const { T, mod, fakePZ } = require("./expresstext-plus-helpers.js");

function placed(name, position, parentObject) {
  return {
    name,
    parentObject: parentObject || null,
    font: { font3d: {} },
    properties: { text: name, position: { get: () => position } },
  };
}

test("a Text+ container above the text makes ExpressText+ step aside", () => {
  // Mirrors the current Text+ ownership marker: dev Text+ parent objects
  // and character materials carry zoidiumTextPlusObject on the prototype,
  // so instances read true through the chain.
  const textPlusContainer = {
    zoidiumTextPlusObject: true,
    parentObject: null,
    properties: { position: { get: () => [100, 0, 0] } },
  };
  const group = { parentObject: textPlusContainer, properties: { position: { get: () => [5, 0, 0] } } };
  const text = placed("A", [0, 0, 0], group);
  assert.deepEqual(
    T.collectExpressObjects(text),
    [],
    "Text+ ownership empties the ExpressText+ layer list"
  );
  // The world composition carries wrappers below the Text+ owner but stops
  // there: the owner's own offset never leaks into ExpressText+ letters.
  assert.deepEqual(
    T.textWorldOf(text, 0).position,
    [5, 0, 0],
    "group composes, Text+ owner excluded"
  );
});

test("container texts skip Text+-owned children", () => {
  const textPlusContainer = { zoidiumTextPlusObject: true, objects: [] };
  const free = placed("C", [0, 0, 0], null);
  const container = { objects: [textPlusContainer, free] };
  assert.deepEqual(T.containerTexts(container), [free], "marked children are not tracked");
});

function fakeContext(registered) {
  function TextObject() {}
  TextObject.prototype.update = function () {};
  const PZ = fakePZ();
  PZ.object3d = { ...PZ.object3d, group: function FakeGroup() {}, text: TextObject };
  PZ.propertyList = function FakePropertyList() {};
  PZ.objectList = function FakeList() {};
  return {
    PZ,
    editor: null,
    window: { THREE: { TextGeometry: function () {} } },
    object3d: {
      registerClass(def) {
        const entry = { def, unregistered: false };
        registered.push(entry);
        return () => {
          entry.unregistered = true;
        };
      },
    },
  };
}

test("disable removes the container class and the scoped dialog entries", () => {
  const registered = [];
  const context = fakeContext(registered);
  mod.activate(context);
  try {
    assert.equal(registered.length, 1, "only the container registers globally");
    assert.equal(registered[0].unregistered, false);
    const scoped = [...context.PZ.ui.objectTypes.keys()].filter(
      (key) => typeof key === "function"
    );
    assert.equal(scoped.length, 1, "one scoped customs entry while enabled");
    mod.deactivate();
    assert.equal(registered[0].unregistered, true, "container class unregistered");
    assert.equal(
      [...context.PZ.ui.objectTypes.keys()].filter((key) => typeof key === "function").length,
      0,
      "scoped entries removed"
    );
    // Re-enabling registers exactly once more and cleans up again.
    mod.activate(context);
    try {
      assert.equal(registered.length, 2, "re-enable registers fresh");
      assert.equal(registered[1].unregistered, false);
    } finally {
      mod.deactivate();
    }
    assert.equal(registered[1].unregistered, true, "second disable unregisters");
  } finally {
    mod.deactivate();
  }
});
