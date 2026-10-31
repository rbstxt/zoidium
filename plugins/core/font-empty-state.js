(function (global) {
  "use strict";

  // Optional font properties (the Shape+ fallback font) show the "custom"
  // sprite row with "(none)" under it when they are empty, which reads as if
  // a custom file were set. Show a clear None label on the picker button
  // instead, following how the host file row renders an empty value
  // ("(none)" in ui-1.0.72.js generateFileInput). Picking a preset or a
  // custom file still works: only the button display changes, never the
  // stored value. Required fonts keep the host behaviour: the patch applies
  // only when the property default is empty (definition.value is null), and
  // it wraps pz_update, so dropdown selection and file upload are untouched.

  var PZ = global.PZ;
  var controls = PZ && PZ.ui && PZ.ui.controls;
  var original = controls && controls.generateFontInput;
  if (typeof original !== "function" || original.__zoidiumFontEmptyState) return;

  function allowsEmpty(property) {
    var definition = property && property.definition;
    if (!definition) return false;
    if (typeof definition.value === "function") return false;
    return definition.value === null || definition.value === undefined;
  }

  function isEmptyValue(value) {
    return value === null || value === undefined || value === "";
  }

  function findButtonSpan(buttonDiv) {
    var button = buttonDiv && buttonDiv.children && buttonDiv.children[0];
    var span = button && button.children && button.children[0];
    return span || null;
  }

  function wrapped(property) {
    var control = original.apply(this, arguments);
    if (!allowsEmpty(property)) return control;
    var parts = Array.isArray(control) ? control : [control];
    var buttonDiv = parts[0];
    if (!buttonDiv || typeof buttonDiv.pz_update !== "function") return control;
    var span = findButtonSpan(buttonDiv);
    if (!span || !span.classList) return control;
    var originalUpdate = buttonDiv.pz_update;
    buttonDiv.pz_update = function () {
      var result = originalUpdate.apply(this, arguments);
      var value = null;
      try {
        value = property.get();
      } catch (_error) {
        return result;
      }
      if (isEmptyValue(value)) {
        if (span.textContent !== "None") span.textContent = "None";
        if (!span.classList.contains("zoidium-font-none")) span.classList.add("zoidium-font-none");
      } else {
        if (span.classList.contains("zoidium-font-none")) span.classList.remove("zoidium-font-none");
        if (span.textContent !== "") span.textContent = "";
      }
      return result;
    };
    return control;
  }

  wrapped.__zoidiumFontEmptyState = true;
  controls.generateFontInput = wrapped;
})(globalThis);
