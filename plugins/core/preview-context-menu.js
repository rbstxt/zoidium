(function installPreviewContextMenuPatch(global) {
  "use strict";

  var THREE = global && global.THREE;
  var PATCH_MARKER = "__zoidiumPreviewContextMenuPatch";
  if (!THREE || typeof THREE.EditorControls !== "function") return;

  var originalEditorControls = THREE.EditorControls;
  if (originalEditorControls[PATCH_MARKER]) return;

  function EditorControlsWithoutPreviewContextMenu(camera, domElement) {
    var target = domElement === undefined ? global.document : domElement;
    var addEventListener = target && target.addEventListener;
    if (typeof addEventListener !== "function") {
      return new originalEditorControls(camera, domElement);
    }

    // EditorControls installs its own contextmenu handler synchronously in
    // the constructor. Filter only that registration while it runs, leaving
    // the canvas and all other event handlers untouched.
    var filteredAddEventListener = function (type, listener, options) {
      if (type === "contextmenu") return;
      return addEventListener.call(this, type, listener, options);
    };
    var replaced = false;

    try {
      target.addEventListener = filteredAddEventListener;
      replaced = target.addEventListener === filteredAddEventListener;
    } catch (_error) {
      replaced = false;
    }

    if (!replaced) return new originalEditorControls(camera, domElement);

    try {
      var controls = new originalEditorControls(camera, domElement);

      // The preview lives inside a PZ.ui.window, whose bubbling contextmenu
      // handler also calls preventDefault(). Stop the event at the canvas so
      // that handler cannot cancel the browser menu. This listener does not
      // call preventDefault(), so the native menu remains enabled.
      addEventListener.call(target, "contextmenu", function (event) {
        if (event && typeof event.stopPropagation === "function") {
          event.stopPropagation();
        }
      });

      return controls;
    } finally {
      try {
        target.addEventListener = addEventListener;
      } catch (_error) {
        // The event target may have become immutable during construction.
      }
    }
  }

  EditorControlsWithoutPreviewContextMenu.prototype = originalEditorControls.prototype;
  Object.getOwnPropertyNames(originalEditorControls).forEach(function (key) {
    if (key === "length" || key === "name" || key === "prototype") return;
    try {
      Object.defineProperty(
        EditorControlsWithoutPreviewContextMenu,
        key,
        Object.getOwnPropertyDescriptor(originalEditorControls, key)
      );
    } catch (_error) {
      // Static properties are optional; the control prototype remains intact.
    }
  });
  Object.defineProperty(EditorControlsWithoutPreviewContextMenu, PATCH_MARKER, {
    configurable: false,
    enumerable: false,
    value: true,
    writable: false,
  });

  THREE.EditorControls = EditorControlsWithoutPreviewContextMenu;
})(window);
