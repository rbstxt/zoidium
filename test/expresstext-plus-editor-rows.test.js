"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { installEditorRows, DELAY_HINT } = require("../plugins/expresstext-plus/expresstext-editor-rows.js");

function host() {
  const document = {activeElement: null};
  const controls = {
    generateTextInput(property) {
      const input = {ownerDocument: document, style: {}, value: "", setAttribute() {}};
      const element = {input, querySelector: () => input, pz_update(frame) {
        input.style.visibility = frame === 0 ? "visible" : "hidden";
        input.value = frame === 0 ? property.get(0) : "";
      }};
      return element;
    },
    generateInput: () => ({}),
  };
  return {PZ: {ui: {controls}}, document, controls};
}

test("Letters and Formula Expression show held values between text keyframes", () => {
  const {PZ, document, controls} = host();
  const original = controls.generateTextInput;
  const dispose = installEditorRows(PZ);
  try {
    for (const key of ["plainLetters", "shakeLetters", "formulaExpression", "delayLetters"]) {
      const property = {definition: {effectorKey: key, name: key}, get: frame => frame >= 10 ? "changed" : "1-3"};
      const element = controls.generateTextInput(property);
      element.pz_update(5);
      assert.equal(element.input.style.visibility, "visible");
      assert.equal(element.input.value, "1-3");
      element.pz_update(12);assert.equal(element.input.value, "changed");
      document.activeElement = element.input;element.input.value = "typing";
      element.pz_update(5);assert.equal(element.input.value, "typing");
      document.activeElement = null;
      property.animated = true;property.expression = {};
      element.pz_update(5);assert.equal(element.input.disabled, true);
    }
    const foreign = controls.generateTextInput({definition: {name: "Other"},get: () => "foreign"});
    foreign.pz_update(5);assert.equal(foreign.input.style.visibility, "hidden");
    const delay = controls.generateInput({definition: {effectorKey: "shakeDelay"}});
    assert.equal(delay.title, DELAY_HINT);
    assert.equal(controls.generateInput({definition: {name: "Other Delay"}}).title, undefined);
  } finally {dispose();}
  assert.equal(controls.generateTextInput, original);
});
