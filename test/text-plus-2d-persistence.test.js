"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { installText2D } = require("../zoidium/project-compatibility.js");

function harness() {
  class Text {
    load(data) { this.text = data?.text || "Native"; }
    toJSON() { return { type: 7, text: this.text }; }
  }
  const PZ = { layer: { shape: { text: Text } } };
  installText2D(PZ);
  installText2D(PZ);
  return Text;
}

test("native 2D Text JSON stays unchanged without character settings", () => {
  const Text = harness(), text = new Text();
  text.load();
  assert.deepEqual(text.toJSON(), { type: 7, text: "Native" });
});

test("missing Text+ retains independent copies of all native Text metadata", () => {
  const Text = harness(), text = new Text();
  const settings = { schemaVersion: 1, characterProperties: {
    mode: 1, transform: { charPosition: { animated: true,
      objects: [{ keyframes: [{ frame: 0, value: 0 }, { frame: 24, value: 80 }] }] } },
  }, future: { value: 3 } };
  const expected = structuredClone(settings);
  text.load({ text: "Saved", zoidiumTextPlus2D: settings });
  settings.future.value = 99;
  const saved = text.toJSON();
  assert.deepEqual(saved.zoidiumTextPlus2D, expected);
  saved.zoidiumTextPlus2D.future.value = 100;
  const pasted = new Text();
  pasted.load(JSON.parse(JSON.stringify(text)));
  assert.deepEqual(pasted.toJSON().zoidiumTextPlus2D, expected);
  assert.equal(pasted.text, "Saved");
  text.load({ text: "Replacement" });
  assert.equal(text.toJSON().zoidiumTextPlus2D, undefined);
});

test("the permanent serializer reads settings authored before plugin disposal", () => {
  const Text = harness(), text = new Text();
  text.load();
  let position = 20;
  Object.defineProperty(text, "zoidiumTextPlus2D", { configurable: true,
    get: () => ({ schemaVersion: 1, characterProperties: { position } }),
  });
  assert.equal(text.toJSON().zoidiumTextPlus2D.characterProperties.position, 20);
  position = 40;
  assert.equal(text.toJSON().zoidiumTextPlus2D.characterProperties.position, 40);
  text.load();
  assert.equal(text.toJSON().zoidiumTextPlus2D, undefined);
});
