(function installPanelFullscreenShortcut(global) {
  "use strict";

  // CM3 toggles the focused panel to fill its window when PZ.ui.window sees
  // `event.code === "Backquote"`. That code names a key position of a US
  // layout, and a Mac keyboard does not always report it: on JIS layouts the
  // half-width/full-width key is consumed by the system input source before
  // the page sees a keydown, and the key that types "`" is the one labelled
  // "@".
  //
  // The helpers below follow the character instead of the position: whatever
  // combination types "`" in the active layout is the one that toggles, and
  // the remap replays the Backquote event CM3 already listens for. The
  // character comes from the layout the browser is typing with, so no
  // combination is hardcoded here.
  var TOGGLE_CODE = "Backquote";
  var TOGGLE_KEY = "`";
  // The position the backquote character sits on for a JIS keyboard.
  var JIS_BACKQUOTE_CODE = "BracketLeft";
  var DOCUMENT_MARKER = "__zoidiumPanelFullscreenShortcut";
  var WINDOW_MARKER = "__zoidiumPanelFullscreenShortcutWindow";

  // An input source that owns the key (an active IME, a dead key) reports a
  // key value that carries no character of its own, which leaves the position
  // as the only signal in the event.
  function hasTypedCharacter(key) {
    return typeof key === "string" && key !== "" &&
      key !== "Process" && key !== "Unidentified" && key !== "Dead";
  }

  function isToggleRequest(event) {
    if (!event || event.code === TOGGLE_CODE) return false;
    if (event.altKey || event.ctrlKey || event.metaKey) return false;
    if (event.key === TOGGLE_KEY) return true;
    // The event types nothing on its own, and the combination sits on the
    // position the backquote character occupies on a JIS keyboard.
    return event.shiftKey === true &&
      event.code === JIS_BACKQUOTE_CODE &&
      !hasTypedCharacter(event.key);
  }

  // PZ.ui.panel stores the panel on its own element, and PZ.ui.window only
  // toggles the panel that owns the focus.
  function findFocusedPanel(doc) {
    var active = doc && doc.activeElement;
    return (active && active.pz_panel) || null;
  }

  function toggleFocusedPanel(doc) {
    var panel = findFocusedPanel(doc);
    if (!panel || !panel.el || typeof panel.el.dispatchEvent !== "function") return false;

    var view = doc.defaultView || global;
    if (!view || typeof view.KeyboardEvent !== "function") return false;

    // The event bubbles to the pane container, which is where PZ.ui.window
    // registers the Backquote handler; the panel element carries the focus.
    panel.el.dispatchEvent(new view.KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      code: TOGGLE_CODE,
      key: TOGGLE_KEY,
    }));
    return true;
  }

  function handleKeyDown(doc, event) {
    if (!isToggleRequest(event)) return false;
    if (!toggleFocusedPanel(doc)) return false;
    event.preventDefault();
    return true;
  }

  function installShortcut(doc) {
    if (!doc || doc[DOCUMENT_MARKER]) return false;
    if (typeof doc.addEventListener !== "function") return false;

    doc[DOCUMENT_MARKER] = true;
    // Capture, so the key works wherever focus sits in the window. Outside a
    // focused panel nothing matches, and the key keeps its normal meaning.
    doc.addEventListener("keydown", function (event) {
      handleKeyDown(doc, event);
    }, true);
    return true;
  }

  // A secondary browser window hosts the same panel toggle, so every pane
  // container installs the shortcut for its own document.
  function installShortcutForWindows(PZ) {
    var PreviousWindow = PZ.ui.window;
    if (PreviousWindow[WINDOW_MARKER]) return false;

    function ShortcutWindow(editor, target) {
      var result = PreviousWindow.apply(this, arguments);
      var instance = result && typeof result === "object" ? result : this;
      if (instance && instance.window && instance.el) {
        installShortcut(instance.window.document);
      }
      return result;
    }

    ShortcutWindow.prototype = PreviousWindow.prototype;
    Object.defineProperty(ShortcutWindow, WINDOW_MARKER, { value: true });
    PZ.ui.window = ShortcutWindow;
    return true;
  }

  function install(scope) {
    var PZ = scope && scope.PZ;
    if (!PZ || !PZ.ui || typeof PZ.ui.window !== "function") return false;

    installShortcut(scope.document);
    installShortcutForWindows(PZ);
    return true;
  }

  if (typeof module === "object" && module.exports) {
    module.exports = {
      DOCUMENT_MARKER,
      WINDOW_MARKER,
      TOGGLE_CODE,
      TOGGLE_KEY,
      JIS_BACKQUOTE_CODE,
      isToggleRequest,
      installShortcut,
      installShortcutForWindows,
      install,
    };
    return;
  }

  install(global);
})(typeof window !== "undefined" ? window : null);
