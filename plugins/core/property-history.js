(function installPropertyHistory(global) {
  "use strict";

  const Properties = global.PZ?.ui?.properties;
  if (Properties && !Properties.getStoredValue) {
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
  }

  // A property edit ends in editFinish, which writes the value and then closes
  // the history operation. If the write throws, that close never runs and the
  // open operation swallows every later edit, so undo and redo stop working.
  // Close it here and keep the failure out of the mouseup handler.
  const Controls = global.PZ?.ui?.controls;
  if (Controls && typeof Controls.editFinish === "function" && !Controls.editFinish.__zoidiumGuarded) {
    const editFinish = Controls.editFinish;
    const guarded = function guardedEditFinish(property, unchanged) {
      try {
        return editFinish.call(this, property, unchanged);
      } catch (error) {
        const history = this?.parentElement?.closest?.("ul")?.pz_controls?.editor?.history;
        if (history && history.operation !== null) {
          try {
            history.discardOperation();
          } catch (_discardError) {
            history.operation = null;
          }
        }
        // User-facing text stays English; this is a recovery diagnostic.
        console.error("[Zoidium] Property edit failed:", error);
        return undefined;
      }
    };
    guarded.__zoidiumGuarded = true;
    Controls.editFinish = guarded;
  }

  // The number input sets the body cursor to "move" on drag start and clears
  // it at the end of the same handler. Any throw above that line leaves the
  // cursor stuck, so the reset must always run.
  const Input = global.PZ?.ui?.input;
  if (Input?.prototype && typeof Input.prototype.dragEnd === "function" && !Input.prototype.dragEnd.__zoidiumGuarded) {
    const dragEnd = Input.prototype.dragEnd;
    const guarded = function guardedDragEnd(event) {
      try {
        return dragEnd.call(this, event);
      } finally {
        if (typeof document !== "undefined" && document.body?.style) document.body.style.cursor = "";
      }
    };
    guarded.__zoidiumGuarded = true;
    Input.prototype.dragEnd = guarded;
  }
})(typeof window !== "undefined" ? window : globalThis);
