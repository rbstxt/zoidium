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
