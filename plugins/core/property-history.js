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
  // Guard both editFinish and Input.prototype.dragEnd so inputs bound before
  // installation also discard the leaked operation and restore the body cursor.
  let lastEditHistory = null;
  function historyForControl(element) {
    return element?.parentElement?.closest?.("ul")?.pz_controls?.editor?.history || lastEditHistory;
  }
  function discardOpenHistory(element) {
    const history = historyForControl(element);
    lastEditHistory = null;
    if (!history || history.operation === null) return;
    try {
      history.discardOperation();
    } catch (_discardError) {
      // Force-clear as a last resort if discardOperation itself fails.
      history.operation = null;
    }
  }

  const Controls = global.PZ?.ui?.controls;
  if (Controls && typeof Controls.editStart === "function" && !Controls.editStart.__zoidiumGuarded) {
    const editStart = Controls.editStart;
    const guardedStart = function guardedEditStart(property, noLink) {
      lastEditHistory = this?.parentElement?.closest?.("ul")?.pz_controls?.editor?.history || null;
      return editStart.call(this, property, noLink);
    };
    guardedStart.__zoidiumGuarded = true;
    Controls.editStart = guardedStart;
  }
  if (Controls && typeof Controls.editFinish === "function" && !Controls.editFinish.__zoidiumGuarded) {
    const editFinish = Controls.editFinish;
    const guarded = function guardedEditFinish(property, unchanged) {
      try {
        const result = editFinish.call(this, property, unchanged);
        lastEditHistory = null;
        return result;
      } catch (error) {
        discardOpenHistory(this);
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
  // cursor stuck, and pre-bound editFinish copies bypass the static wrapper
  // above, so close any leaked operation and always reset the cursor here.
  const Input = global.PZ?.ui?.input;
  if (Input?.prototype && typeof Input.prototype.dragEnd === "function" && !Input.prototype.dragEnd.__zoidiumGuarded) {
    const dragEnd = Input.prototype.dragEnd;
    const guarded = function guardedDragEnd(event) {
      try {
        return dragEnd.call(this, event);
      } catch (error) {
        discardOpenHistory(this?.ctx?.el);
        throw error;
      } finally {
        if (typeof document !== "undefined" && document.body?.style) document.body.style.cursor = "";
      }
    };
    guarded.__zoidiumGuarded = true;
    Input.prototype.dragEnd = guarded;
  }
})(typeof window !== "undefined" ? window : globalThis);
