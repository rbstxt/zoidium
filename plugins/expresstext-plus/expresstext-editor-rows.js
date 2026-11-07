"use strict";

const { kindOfKey } = require("./expresstext-sections.js");

const DELAY_HINT = "Offsets each letter in time, in frames. Static Plain and Random values do not change. Animate their transform values, or use Random Noise or Turbulence with Animation speed. Shake needs a nonzero Position or Rotation amplitude, or Scale different from 1.";

function installEditorRows(PZ) {
  const controls = PZ.ui?.controls;
  if (!controls) return () => {};
  let disposed = false;
  const patches = [];
  function patch(name, wrap) {
    const original = controls[name];
    if (typeof original !== "function") return;
    const replacement = function (property) {
      const element = original.apply(this, arguments);
      if (!disposed) wrap(property, element);
      return element;
    };
    controls[name] = replacement;
    patches.push({name, original, replacement});
  }
  patch("generateTextInput", (property, element) => {
    const key = property.definition?.effectorKey;
    if (!kindOfKey(key) || !(/Letters$/.test(key) || key === "formulaExpression")) return;
    const input = element.querySelector("input");
    if (!input) return;
    // CM3's native updater hides dynamic text except at exact keyframes.
    // Keep its change handler and history, but show the evaluated text.
    element.pz_update = frame => {
      input.disabled = !!(property.definition.readOnly || property.animated && property.expression);
      input.style.visibility = "visible";
      if (input.ownerDocument.activeElement !== input) {
        input.value = property.get(frame) ?? property.definition.value ?? "";
      }
    };
    input.setAttribute("aria-label", property.definition.name);
  });
  patch("generateInput", (property, element) => {
    const key = property.definition?.effectorKey;
    if (kindOfKey(key) && /Delay$/.test(key)) element.title = DELAY_HINT;
  });
  return () => {
    disposed = true;
    for (const {name, original, replacement} of patches.reverse()) {
      if (controls[name] === replacement) controls[name] = original;
    }
  };
}

module.exports = { DELAY_HINT, installEditorRows };
