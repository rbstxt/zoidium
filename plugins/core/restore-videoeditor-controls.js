(function restoreVideoEditorControls(global) {
  "use strict";

  var editor = global.VE;
  var ui = global.PZ && global.PZ.ui;
  if (
    global.ZOIDIUM_LAYOUT !== "videoeditor" ||
    !editor ||
    !ui ||
    typeof editor.setUpEditor !== "function" ||
    typeof ui.toolbar !== "function" ||
    typeof ui.viewport !== "function" ||
    editor.__zoidiumControlsRestored
  ) {
    return;
  }

  var originalSetUpEditor = editor.setUpEditor;
  // Later pre-init scripts (main-viewport.js among them) wrap ui.viewport and
  // ui.toolbar. Read the constructors when the editor is built, not now, so
  // the restored controls never bypass those wrappers.
  var originalToolbar = ui.toolbar;

  function copyStatics(toolbar, source) {
    Object.keys(source).forEach(function (key) {
      toolbar[key] = source[key];
    });
  }

  function isPlaybackToolbar(editorInstance, buttons) {
    return (
      editorInstance === editor &&
      Array.isArray(buttons) &&
      buttons.some(function (button) {
        return button && button.title === "start (home)";
      })
    );
  }

  function restoreButtons(buttons, viewport) {
    viewport.edit = true;
    editor.playback.loop = true;

    if (viewport.widget2d) {
      viewport.widget2d.edit = false;
    }

    var restored = buttons.map(function (button) {
      return button && typeof button === "object"
        ? Object.assign({}, button)
        : button;
    });
    var startIndex = restored.findIndex(function (button) {
      return button && button.title === "start (home)";
    });
    var loopButton = restored.find(function (button) {
      return button && button.title === "loop (ctrl-l)";
    });

    if (startIndex >= 0) {
      restored.splice(
        startIndex,
        0,
        {
          title: "editing camera (c)",
          icon: "camera",
          key: "c",
          observable: viewport.onEditChanged,
          update: function (button) {
            button.children[0].style.fill = viewport.edit
              ? "var(--zui-danger)"
              : "var(--zui-text-muted)";
          },
          fn: function () {
            viewport.edit = !viewport.edit;
          },
        },
        {
          title: "layer transform controls (t)",
          icon: "transform",
          key: "t",
          observable: viewport.widget2d
            ? viewport.widget2d.onEditChanged
            : undefined,
          update: function (button) {
            var widget2d = viewport.widget2d;
            button.children[0].style.fill = widget2d && widget2d.edit
              ? "var(--zui-danger)"
              : "var(--zui-text-muted)";
          },
          fn: function () {
            if (viewport.widget2d) {
              viewport.widget2d.edit = !viewport.widget2d.edit;
            }
          },
        },
        { separator: true }
      );
    }

    if (loopButton) {
      loopButton.icon = "loop";
      loopButton.observable = editor.playback.onLoopChanged;
      loopButton.update = function (button) {
        button.children[0].style.fill = this.editor.playback.loop
          ? "var(--zui-danger)"
          : "var(--zui-text-muted)";
      };
    }

    if (!restored.some(function (button) {
      return button && button.title === "graph";
    })) {
      restored.push({
        title: "graph",
        key: "g",
        icon: "interp_1",
        modifierMask: originalToolbar.CTRL,
        fn: function () {
          var graphWindow = editor.createWindow({ title: "Graph editor" });
          graphWindow.setPanel(new ui.graphEditor(graphWindow.editor));
          graphWindow.enabled = true;
        },
      });
    }

    return restored;
  }

  editor.setUpEditor = function setUpEditorWithRestoredControls(account) {
    var viewport = null;
    var currentViewport = ui.viewport;
    var currentToolbar = ui.toolbar;

    function ViewportProxy(editorInstance, options) {
      var instance = new currentViewport(editorInstance, options);
      if (editorInstance === editor) viewport = instance;
      return instance;
    }

    function ToolbarProxy(editorInstance, buttons) {
      var restoredButtons = isPlaybackToolbar(editorInstance, buttons)
        ? restoreButtons(buttons, viewport)
        : buttons;
      return new currentToolbar(editorInstance, restoredButtons);
    }

    ViewportProxy.prototype = currentViewport.prototype;
    ToolbarProxy.prototype = currentToolbar.prototype;
    copyStatics(ViewportProxy, currentViewport);
    copyStatics(ToolbarProxy, currentToolbar);
    ui.viewport = ViewportProxy;
    ui.toolbar = ToolbarProxy;

    try {
      return originalSetUpEditor.call(this, account);
    } finally {
      ui.viewport = currentViewport;
      ui.toolbar = currentToolbar;
    }
  };
  editor.__zoidiumControlsRestored = true;
})(window);
