"use strict";
// Path input routing for the shared path controller (P1.5).
//
// Consumed contracts (already merged on `feat/mask-overhaul`, used directly):
// - P1.1 `path-controller.js`: `createPathController` owns `tool`
//   ("pen"/"select"), the active host/path, vertex selections keyed by host
//   and path, drawing, gesture, and focus ownership. Tool switches preserve
//   the active path and every stored selection; this module relies on that
//   for selection retention across Q/V.
// - P1.4 `path-selection.js`: `createCycleState`/`chooseCandidate`/
//   `resetCycle` for overlap cycling on click activation, and
//   `deletionDecision` for the Delete/Backspace focus gate.
//
// Provided: `isEditableTarget`, `isComposingEvent`, `createPathInput` with
// `handleKeyDown`, `handleKeyUp`, `handleBlur`, click-activation helpers
// (`activateAt`, `notifyExternalSelection`, `notifyFrameChanged`), and the
// `MODIFIED_PASSTHROUGH` / `NATIVE_TOOL_KEYS` shortcut lists.
//
// Shortcut behavior follows the "Compatibility and shortcuts" table in the
// shared design:
// - `Q` selects Pen without cycling (replacing the mask `Q` cycle in
//   `mask-overlay.js`, which steps off/pen/select). `P` stays a Pen alias
//   for existing Shape+ users. `V` selects point editing; with no active
//   path it yields to layer selection instead of consuming the key.
// - Holding `Ctrl`/`Cmd` in Pen temporarily selects points; releasing the
//   modifier restores Pen. Modified shortcuts (copy, paste, undo, redo,
//   select all, duplicate, reorder) are never consumed here: they keep
//   reaching the Shape+ clipboard handler (`workflow.js`, which owns
//   modified `C`/`X`/`V`) and the native handlers after it.
// - `Alt`/`Option` marks handle-break/convert intent for the gesture layer
//   (P2.6 owns the click itself); Alt-modified shortcuts outside the
//   viewport are never intercepted.
// - `Escape` cancels an active drag first, otherwise finishes drawing while
//   retaining the path and selection; a further `Escape` clears vertex
//   selection. `Enter` is an optional finish alias and is never required.
// - `Delete`/`Backspace` remove vertices only while path editing owns focus
//   on an unlocked path; otherwise the key defers to the focused panel. A
//   locked path reports `blocked-locked` with an English message.
// - `Space` always defers to viewport navigation and is never consumed in
//   text fields or during composition. `T`, `C`, `M` stay native; native
//   transform may own pointer input without erasing path selection.
// - Guards: shortcuts run only when the viewport or a path control owns
//   focus, no text field is editing, and composition is inactive. Graph+
//   owns its own `V` (`graph-plus/operations.js` stops propagation), so a
//   focused Graph+ editor keeps priority for `V`.
//
// Contract notes for the P1.7 integration package:
// - Mount order for modified keys: the Shape+ clipboard handler
//   (`workflow.js`) must see modified `C`/`X`/`V` before native fallback;
//   this module defers every `Ctrl`/`Cmd` combo without consuming it, so
//   installing the clipboard listener ahead of (or instead of) native paste
//   is enough. The path clipboard envelope itself is a later package.
// - Claim controller focus (`controller.claimFocus("path")`) when the
//   overlay canvas or a path control takes focus, and release it on blur;
//   otherwise Delete always defers to the panel.
// - Call `notifyFrameChanged()` on playback frame changes and
//   `notifyExternalSelection()` for any selection not made through
//   `activateAt`, so overlap cycling restarts (P1.4 rule).
// - `locked` arrives per event through the `context` argument; resolve it
//   from the host (`isLocked`) or P1.2 metadata in the caller.
const {
  createCycleState,
  samePoint,
  chooseCandidate,
  resetCycle,
  deletionDecision,
} = require("./path-selection.js");

// Modified shortcuts that must keep reaching the clipboard, history,
// selection, duplicate, and reorder handlers. Every other Ctrl/Cmd combo
// defers too; this list documents the ones the design calls out.
const MODIFIED_PASSTHROUGH = ["c", "x", "v", "z", "y", "a", "d", "g", "[", "]"];

// Unmodified single-letter commands that stay with the native viewport and
// panels while path editing is mounted.
const NATIVE_TOOL_KEYS = ["t", "c", "m"];

// True while the event target is a text field, menu, or option list: path
// shortcuts never fire from inside one.
function isEditableTarget(target) {
  if (!target || typeof target.closest !== "function") return false;
  try {
    return !!target.closest("input, textarea, select, .editbox, [contenteditable]:not([contenteditable='false'])");
  } catch (_error) {
    return false;
  }
}

// Composition (IME) state: `keyCode 229` covers browsers that set it without
// the `isComposing` flag.
function isComposingEvent(event) {
  return !!event && (event.isComposing === true || event.keyCode === 229);
}

function consume(event) {
  try {
    event?.preventDefault?.();
  } catch (_error) {
    // A bare fake without DOM methods still records the decision.
  }
  try {
    event?.stopImmediatePropagation?.();
  } catch (_error) {
    // Same: the returned `consumed` flag is the contract.
  }
}

function createPathInput(options = {}) {
  const controller = options.controller;
  if (!controller || typeof controller.setTool !== "function") {
    throw Error("Path input needs a path controller");
  }
  const state = {
    cycle: createCycleState(),
    frame: undefined,
    hostId: null,
    temporarySelect: false,
    altHeld: false,
  };

  function result(event, action, consumed, extra) {
    if (consumed) consume(event);
    return { action, consumed: !!consumed, ...(extra || {}) };
  }

  function pressModifier(event) {
    // Holding Ctrl/Cmd in Pen temporarily selects points. The modifier
    // alone is never consumed, so modified shortcuts still reach the
    // clipboard, history, and reorder handlers.
    if (controller.tool === "pen" && !state.temporarySelect) {
      state.temporarySelect = true;
      controller.setTool("select", { preserveDrawing: true });
      return result(event, "temporary-select", false, { tool: "select" });
    }
    return result(event, "ignore", false, { reason: "modifier" });
  }

  function releaseModifier(event) {
    if (!state.temporarySelect) return result(event, "ignore", false, { reason: "modifier" });
    state.temporarySelect = false;
    controller.setTool("pen", { preserveDrawing: true });
    return result(event, "restore-tool", false, { tool: "pen" });
  }

  function pressEscape(event) {
    // During a drag, cancel that drag first.
    if (controller.gesture) {
      const gesture = controller.endGesture(true);
      resetCycle(state.cycle);
      return result(event, "cancel-gesture", true, { gesture });
    }
    // Otherwise finish drawing and retain the path and selection.
    if (controller.drawing) {
      const drawing = controller.finishDrawing();
      return result(event, "finish-drawing", true, { drawing });
    }
    // A second Escape clears vertex selection.
    const selected = controller.getSelection();
    if (selected.length > 0) {
      controller.clearPathSelection();
      resetCycle(state.cycle);
      return result(event, "clear-selection", true, { cleared: selected.length });
    }
    return result(event, "defer-to-native", false, { reason: "nothing-to-cancel" });
  }

  function pressDelete(event, context) {
    const vertexCount = context.selectedAnchors ?? controller.getSelection().length;
    const decision = deletionDecision({
      ownsFocus: typeof controller.ownsFocus === "function" ? controller.ownsFocus() : false,
      vertexCount,
      locked: !!context.locked,
    });
    if (decision.action === "delete-vertices") {
      return result(event, "delete-vertices", true, { count: vertexCount });
    }
    if (decision.action === "blocked-locked") {
      return result(event, "blocked-locked", true, { message: decision.message });
    }
    return result(event, "defer-to-panel", false, {});
  }

  function handleKeyDown(event, context = {}) {
    const key = (event?.key || "").toLowerCase();
    if (context.composing || isComposingEvent(event)) return result(event, "ignore", false, { reason: "composing" });
    if (isEditableTarget(event?.target)) return result(event, "ignore", false, { reason: "typing" });
    if (context.graphFocused) return result(event, "defer-to-graph", false, {});
    if (context.viewportFocused !== true &&
        !(context.viewportFocused !== false && controller.ownsFocus?.("path"))) {
      if (key === "delete" || key === "backspace") return result(event, "defer-to-panel", false, { reason: "focus-elsewhere" });
      return result(event, "ignore", false, { reason: "focus-elsewhere" });
    }
    if (key === "control" || key === "meta") return pressModifier(event);
    if (key === "alt") {
      state.altHeld = true;
      return result(event, "alt-held", false, {});
    }
    if (key === "shift") return result(event, "ignore", false, { reason: "modifier" });
    // Modified shortcuts (copy, paste, undo, redo, select all, duplicate,
    // reorder, and everything else with Ctrl/Cmd) keep reaching their
    // handlers: never consume them here.
    if (event?.ctrlKey || event?.metaKey) {
      return result(event, "defer-to-native", false, { reason: "modified-shortcut", key });
    }
    // Alt-modified shortcuts outside the viewport belong to the operating
    // system or native menus.
    if (event?.altKey || event?.shiftKey) {
      return result(event, "defer-to-native", false, { reason: event.altKey ? "alt-shortcut" : "modified-shortcut", key });
    }
    if (key === "q" || key === "p") {
      // `Q` selects Pen without cycling; `P` stays a Pen alias.
      state.temporarySelect = false;
      if (controller.tool !== "pen") controller.setTool("pen");
      return result(event, "select-pen", true, { tool: "pen" });
    }
    if (key === "v") {
      // Outside an active path, yield to layer selection and transforms.
      if (context.activeHere === false || controller.activePathId == null) {
        return result(event, "defer-to-layer", false, {});
      }
      state.temporarySelect = false;
      if (controller.tool !== "select") controller.setTool("select");
      return result(event, "select-points", true, { tool: "select" });
    }
    if (context.activeHere === false && ["escape", "enter", "delete", "backspace"].includes(key))
      return result(event, "defer-to-native", false, {});
    if (key === "escape") return pressEscape(event);
    if (key === "enter") {
      // Optional finish alias; never required, never consumes otherwise.
      if (!controller.drawing) return result(event, "ignore", false, { reason: "nothing-to-finish" });
      const drawing = controller.finishDrawing();
      return result(event, "finish-drawing", true, { drawing });
    }
    if (key === "delete" || key === "backspace") return pressDelete(event, context);
    if (key === " ") return result(event, "defer-to-viewport", false, {});
    if (key === "spacebar") return result(event, "defer-to-viewport", false, {});
    if (NATIVE_TOOL_KEYS.includes(key)) {
      return result(event, "defer-to-native", false, { reason: "native-command", key });
    }
    return result(event, "ignore", false, { reason: "unhandled" });
  }

  function handleKeyUp(event) {
    const key = (event?.key || "").toLowerCase();
    if ((key === "control" || key === "meta") && !event.ctrlKey && !event.metaKey) return releaseModifier(event);
    if (key === "alt") {
      state.altHeld = false;
      return result(event, "alt-released", false, {});
    }
    return result(event, "ignore", false, { reason: "unhandled" });
  }

  function handleBlur() {
    state.altHeld = false;
    if (!state.temporarySelect) return { action: "blur", consumed: false, tool: controller.tool };
    state.temporarySelect = false;
    controller.setTool("pen", { preserveDrawing: true });
    return { action: "restore-tool", consumed: false, tool: "pen" };
  }

  // Click activation with overlap cycling: the first click takes the
  // frontmost candidate; repeated clicks at the same location cycle front
  // to back, including the active path. Returns the activated path ID, or
  // null when nothing is under the point.
  function activateAt(point, candidateIds, host, frame) {
    const target = host || controller.activeHost;
    if (!target) return null;
    if (state.frame !== frame || state.hostId !== target.id) {
      state.frame = frame;
      state.hostId = target.id;
      notifyFrameChanged();
    }
    const id = chooseCandidate(state.cycle, point, candidateIds);
    if (id === null) return null;
    if (controller.activeHost !== target || controller.activePathId !== id) controller.activate(target, id);
    return id;
  }

  // Selections not made through `activateAt` (panels, timeline, undo) and
  // playback frame changes restart the overlap cycle.
  function notifyExternalSelection() {
    resetCycle(state.cycle);
  }

  function trackPointer(point) {
    if (state.cycle.lastPoint && !samePoint(state.cycle.lastPoint, point)) resetCycle(state.cycle);
  }

  function notifyFrameChanged() {
    resetCycle(state.cycle);
  }

  return {
    handleKeyDown,
    handleKeyUp,
    handleBlur,
    activateAt,
    trackPointer,
    notifyExternalSelection,
    notifyFrameChanged,
    isTemporarySelect() {
      return state.temporarySelect;
    },
    isAltHeld() {
      return state.altHeld;
    },
  };
}

module.exports = {
  createPathInput,
  isEditableTarget,
  isComposingEvent,
  MODIFIED_PASSTHROUGH,
  NATIVE_TOOL_KEYS,
};
