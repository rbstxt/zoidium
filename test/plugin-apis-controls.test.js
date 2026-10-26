"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

let fallbackCalls = 0;
global.PZ = {
  property: {
    type: {
      NUMBER: 0,
      VECTOR2: 1,
      VECTOR3: 2,
      VECTOR4: 3,
      COLOR: 4,
      GRADIENT: 5,
      OPTION: 6,
      TEXT: 7,
      ASSET: 8,
      LIST: 9,
      CURVE: 10,
      SHADER: 11,
    },
  },
  ui: {
    controls: {
      generateTextInput(property) {
        fallbackCalls += 1;
        return { kind: "fallback", property };
      },
    },
  },
};

require("../zoidium/plugin-apis.js");
const apis = global.ZoidiumPluginApis;

test("custom property controls route opted-in properties and preserve the host fallback", () => {
  const unregister = apis.propertyControls.register("test/visual-editor", {
    type: PZ.property.type.TEXT,
    create(property, context) {
      return { kind: "custom", property, controls: context.controls };
    },
  });
  const matching = {
    definition: { type: PZ.property.type.TEXT, zoidiumControl: "test/visual-editor" },
  };
  const ordinary = { definition: { type: PZ.property.type.TEXT } };

  const customResult = PZ.ui.controls.generateTextInput(matching);
  assert.equal(customResult.kind, "custom");
  assert.equal(customResult.controls, PZ.ui.controls);
  assert.equal(fallbackCalls, 0);

  const fallbackResult = PZ.ui.controls.generateTextInput(ordinary);
  assert.equal(fallbackResult.kind, "fallback");
  assert.equal(fallbackCalls, 1);

  unregister();
  assert.equal(PZ.ui.controls.generateTextInput(matching).kind, "fallback");
  assert.equal(fallbackCalls, 2);
});

test("custom property controls reject unsupported registrations", () => {
  assert.throws(
    () => apis.propertyControls.register("", { type: PZ.property.type.TEXT, create() {} }),
    /requires an id/
  );
  assert.throws(
    () => apis.propertyControls.register("test/missing", { type: 99, create() {} }),
    /supported CM3 property type/
  );
});

test("a failing custom factory preserves native rows and logs once per property", () => {
  const warnings = [], warn = console.warn;
  console.warn = (...args) => warnings.push(args);
  const unregister = apis.propertyControls.register("test/broken-editor", {
    type: PZ.property.type.TEXT,
    create() { throw new Error("Custom editor unavailable"); },
  });
  const property = { definition: { type: PZ.property.type.TEXT, zoidiumControl: "test/broken-editor" } };
  try {
    const before = fallbackCalls;
    for (let i = 0; i < 2; i++) assert.equal(PZ.ui.controls.generateTextInput(property).kind, "fallback");
    assert.equal(fallbackCalls, before + 2);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0][0], /test\/broken-editor/);
    const other = { definition: { type: PZ.property.type.TEXT } };
    assert.equal(PZ.ui.controls.generateTextInput(other).kind, "fallback");
  } finally { unregister(); console.warn = warn; }
});

test("custom update errors cannot stop subsequent rows, and later updates can recover", () => {
  const warnings = [], warn = console.warn;
  console.warn = (...args) => warnings.push(args);
  let broken = true, calls = 0, otherUpdates = 0;
  const editbox = {
    classList: { contains: name => name === "editbox" },
    pz_update(frame) {
      assert.equal(this, editbox);
      assert.equal(frame, 42);
      calls++;
      if (broken) throw new Error("Update unavailable");
      return "updated";
    },
  };
  const unregister = apis.propertyControls.register("test/update-editor", {
    type: PZ.property.type.TEXT,
    create: () => ({ querySelector: () => editbox }),
  });
  const property = { definition: { type: PZ.property.type.TEXT, zoidiumControl: "test/update-editor" } };
  try {
    PZ.ui.controls.generateTextInput(property);
    const rows = [editbox, { pz_update() { otherUpdates++; } }];
    for (let i = 0; i < 2; i++) for (const row of rows) row.pz_update(42);
    assert.equal(otherUpdates, 2);
    assert.equal(calls, 2);
    assert.equal(warnings.length, 1);
    broken = false;
    assert.equal(editbox.pz_update(42), "updated");
  } finally { unregister(); console.warn = warn; }
});
