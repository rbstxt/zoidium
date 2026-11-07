(function installPropertyHistory(global) {
  "use strict";

  const Properties = global.PZ?.ui?.properties;
  if (!Properties || Properties.getStoredValue) return;

  // set() writes a stored key, while get() can interpolate or evaluate an
  // expression. History must retain the value that set() actually replaces.
  function getStoredValue(property, frame) {
    if (property.objects) return Array.from(property.objects, child => getStoredValue(child, frame));
    if (property.keyframes && typeof property.getClosestKeyframeIndex === "function") {
      return JSON.parse(JSON.stringify(property.keyframes[property.getClosestKeyframeIndex(frame)].value));
    }
    return JSON.parse(JSON.stringify(property.get(frame)));
  }
  Properties.getStoredValue = getStoredValue;
  const setValue = Properties.prototype.setValue;
  Properties.prototype.setValue = function (command) {
    if (command.oldValue === undefined) {
      const property = this.editor.project.addressLookup(command.property);
      command = { ...command, oldValue: getStoredValue(property, command.frame) };
    }
    return setValue.call(this, command);
  };
})(typeof window !== "undefined" ? window : globalThis);
